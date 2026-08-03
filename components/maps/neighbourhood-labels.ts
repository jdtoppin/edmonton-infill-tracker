import type {
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  MarkerOptions,
  StyleSpecification,
} from "maplibre-gl";
import { EDMONTON_CENTER, EDMONTON_COORDINATE_LIMITS } from "./map-style";

export const EDMONTON_CURRENT_NEIGHBOURHOODS_URL =
  "https://data.edmonton.ca/resource/3b6m-fezs.json?$select=number,name_mixed,latitude,longitude&$order=number%20ASC&$limit=750";

const MAX_RESPONSE_BYTES = 750_000;
const MINIMUM_EXPECTED_ROWS = 300;
const MAXIMUM_EXPECTED_ROWS = 750;
const AGGREGATE_PREFIX = "Greater ";
const LOW_ZOOM_CONTEXT_PATTERN = /(?:\bIndustrial\b|\bRavine\b|Transportation|Anthony Henday)/iu;

export type EdmontonNeighbourhoodLabel = {
  cityId: string;
  name: string;
  latitude: number;
  longitude: number;
};

type MarkerConstructor = new (options?: MarkerOptions) => MapLibreMarker;

let currentNeighbourhoodsRequest: Promise<readonly EdmontonNeighbourhoodLabel[]> | null = null;

function strictNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isSpecificNeighbourhoodName(name: string): boolean {
  return !name.trimStart().startsWith(AGGREGATE_PREFIX);
}

export function parseCurrentNeighbourhoodRows(
  value: unknown,
  { minimumRows = MINIMUM_EXPECTED_ROWS }: { minimumRows?: number } = {},
): readonly EdmontonNeighbourhoodLabel[] {
  if (!Array.isArray(value) || value.length < minimumRows || value.length > MAXIMUM_EXPECTED_ROWS) {
    throw new Error("The City neighbourhood label response had an unexpected row count.");
  }

  const seen = new Set<string>();
  const labels: EdmontonNeighbourhoodLabel[] = [];
  for (const rawRow of value) {
    if (!rawRow || typeof rawRow !== "object") {
      throw new Error("The City neighbourhood label response contained an invalid row.");
    }
    const row = rawRow as Record<string, unknown>;
    const cityId = String(row.number ?? "").trim();
    const name =
      typeof row.name_mixed === "string" ? row.name_mixed.trim().replace(/\s+/gu, " ") : "";
    const latitude = strictNumber(row.latitude);
    const longitude = strictNumber(row.longitude);
    if (
      !/^\d{1,10}$/u.test(cityId) ||
      seen.has(cityId) ||
      name.length < 1 ||
      name.length > 200 ||
      /[\u0000-\u001f\u007f]/u.test(name) ||
      latitude === null ||
      latitude < EDMONTON_COORDINATE_LIMITS.south ||
      latitude > EDMONTON_COORDINATE_LIMITS.north ||
      longitude === null ||
      longitude < EDMONTON_COORDINATE_LIMITS.west ||
      longitude > EDMONTON_COORDINATE_LIMITS.east
    ) {
      throw new Error("The City neighbourhood label response contained invalid data.");
    }
    seen.add(cityId);
    if (isSpecificNeighbourhoodName(name)) {
      labels.push({ cityId, name, latitude, longitude });
    }
  }

  return labels;
}

async function fetchCurrentEdmontonNeighbourhoods(): Promise<
  readonly EdmontonNeighbourhoodLabel[]
> {
  const response = await fetch(EDMONTON_CURRENT_NEIGHBOURHOODS_URL, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "force-cache",
    redirect: "error",
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")
  ) {
    await response.body?.cancel();
    throw new Error("The current City neighbourhood labels could not be loaded.");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("The City neighbourhood label response was unexpectedly large.");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("The City neighbourhood label response was unexpectedly large.");
  }
  return parseCurrentNeighbourhoodRows(JSON.parse(text) as unknown);
}

export function loadCurrentEdmontonNeighbourhoods(): Promise<
  readonly EdmontonNeighbourhoodLabel[]
> {
  if (!currentNeighbourhoodsRequest) {
    currentNeighbourhoodsRequest = fetchCurrentEdmontonNeighbourhoods().catch((error) => {
      currentNeighbourhoodsRequest = null;
      throw error;
    });
  }
  return currentNeighbourhoodsRequest;
}

function labelPriority(label: EdmontonNeighbourhoodLabel, zoom: number): number {
  const centralDistance = Math.hypot(
    (label.longitude - EDMONTON_CENTER[0]) * 0.65,
    label.latitude - EDMONTON_CENTER[1],
  );
  const contextualPenalty = zoom < 12.25 && LOW_ZOOM_CONTEXT_PATTERN.test(label.name) ? 1_000 : 0;
  return contextualPenalty + centralDistance * 1_000 + label.name.length;
}

type LabelMarker = {
  label: EdmontonNeighbourhoodLabel;
  marker: MapLibreMarker;
  element: HTMLSpanElement;
};

function updateLabelVisibility(map: MapLibreMap, markers: readonly LabelMarker[]) {
  const zoom = map.getZoom();
  const container = map.getContainer();
  const width = container.clientWidth;
  const height = container.clientHeight;
  const horizontalPadding = zoom < 9.7 ? 13 : zoom < 11.2 ? 9 : 6;
  const verticalPadding = zoom < 9.7 ? 9 : 6;
  const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];

  for (const marker of markers) marker.element.hidden = true;
  if (zoom < 8.85 || width <= 0 || height <= 0) return;

  const candidates = markers
    .map((marker) => ({
      marker,
      point: map.project([marker.label.longitude, marker.label.latitude]),
    }))
    .filter(
      ({ point }) =>
        point.x >= -80 && point.x <= width + 80 && point.y >= -24 && point.y <= height + 24,
    )
    .sort(
      (left, right) =>
        labelPriority(left.marker.label, zoom) - labelPriority(right.marker.label, zoom),
    );

  for (const { marker, point } of candidates) {
    if (zoom < 12.25 && LOW_ZOOM_CONTEXT_PATTERN.test(marker.label.name)) continue;
    const labelWidth = Math.min(
      150,
      Math.max(44, marker.label.name.length * (zoom < 10 ? 5.6 : 6.1)),
    );
    const labelHeight = zoom < 10 ? 15 : 17;
    const box = {
      left: point.x - labelWidth / 2 - horizontalPadding,
      right: point.x + labelWidth / 2 + horizontalPadding,
      top: point.y - labelHeight / 2 - verticalPadding,
      bottom: point.y + labelHeight / 2 + verticalPadding,
    };
    const collides = occupied.some(
      (prior) =>
        box.left < prior.right &&
        box.right > prior.left &&
        box.top < prior.bottom &&
        box.bottom > prior.top,
    );
    if (collides) continue;
    occupied.push(box);
    marker.element.hidden = false;
  }
}

export function addCurrentNeighbourhoodLabelOverlay({
  map,
  Marker,
  labels,
}: {
  map: MapLibreMap;
  Marker: MarkerConstructor;
  labels: readonly EdmontonNeighbourhoodLabel[];
}): () => void {
  const markers = labels.map((label): LabelMarker => {
    const element = document.createElement("span");
    element.className =
      "pointer-events-none select-none whitespace-nowrap rounded-sm bg-[#f8faf6]/80 px-1.5 py-0.5 text-[10px] font-semibold tracking-[-0.01em] text-[#496064] shadow-[0_1px_2px_rgba(23,48,51,0.12)] backdrop-blur-[1px]";
    element.dataset.mapNeighbourhoodLabel = label.cityId;
    element.textContent = label.name;
    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
    const marker = new Marker({ element, anchor: "center" })
      .setLngLat([label.longitude, label.latitude])
      .addTo(map);
    return { label, marker, element };
  });

  const update = () => updateLabelVisibility(map, markers);
  map.on("moveend", update);
  map.on("zoomend", update);
  map.on("resize", update);
  update();

  return () => {
    map.off("moveend", update);
    map.off("zoomend", update);
    map.off("resize", update);
    for (const { marker } of markers) marker.remove();
  };
}

function excludesAggregateNames(filter: unknown): boolean {
  return JSON.stringify(filter).includes(AGGREGATE_PREFIX);
}

export function suppressAggregateBasemapLabels(map: MapLibreMap): void {
  const style = map.getStyle() as StyleSpecification;
  for (const layer of style.layers ?? []) {
    if (layer.type !== "symbol" || excludesAggregateNames(layer.filter)) continue;
    const specificNameFilter = [
      "all",
      ["!=", ["slice", ["coalesce", ["get", "name"], ""], 0, 8], AGGREGATE_PREFIX],
      ["!=", ["slice", ["coalesce", ["get", "name_en"], ""], 0, 8], AGGREGATE_PREFIX],
    ] as const;
    try {
      map.setFilter(
        layer.id,
        layer.filter
          ? (["all", layer.filter, specificNameFilter] as never)
          : (specificNameFilter as never),
      );
    } catch {
      // Third-party styles can contain provider-specific filters. The app's
      // label-free default still guarantees aggregate labels are absent.
    }
  }
}
