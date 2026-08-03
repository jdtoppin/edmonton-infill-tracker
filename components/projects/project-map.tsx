"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LocateFixed, MapPinned, MapPinOff, TriangleAlert } from "lucide-react";
import type { FeatureCollection, Point } from "geojson";
import type {
  GeoJSONSource,
  Map as MapboxMap,
  MapLayerMouseEvent,
  MapboxErrorEvent,
  Popup as MapboxPopup,
} from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const EDMONTON_CENTER: [longitude: number, latitude: number] = [-113.4938, 53.5461];
const EDMONTON_BOUNDS = {
  west: -113.72,
  east: -113.27,
  north: 53.72,
  south: 53.38,
} as const;
const DEFAULT_MAP_STYLE = "mapbox://styles/mapbox/streets-v12";
const MAP_SOURCE_ID = "infill-projects";
const CLUSTER_LAYER_ID = "infill-project-clusters";
const CLUSTER_COUNT_LAYER_ID = "infill-project-cluster-counts";
const PROJECT_LAYER_ID = "infill-project-points";
const PROJECT_LABEL_LAYER_ID = "infill-project-confidence";
const DEFAULT_LIST_BATCH_SIZE = 25;

export type ProjectMapMarker = {
  id: string;
  address: string;
  neighbourhood: string | null;
  categoryLabel: string;
  stageLabel: string;
  confidence: number;
  latestEventLabel: string | null;
  latestEventDate: string | null;
  constructionValue: string | null;
  estimatedUnits: number | null;
  latitude: number | null;
  longitude: number | null;
};

type ProjectMapProps = {
  markers: readonly ProjectMapMarker[];
  mapboxToken?: string | null;
  mapStyleUrl?: string | null;
  initialSelectedId?: string | null;
  showList?: boolean;
  listBatchSize?: number;
  className?: string;
};

type MapStatus =
  "loading" | "ready" | "token-missing" | "coordinates-missing" | "unsupported" | "error";

type MappableProject = ProjectMapMarker & { latitude: number; longitude: number };
type ProjectFeatureProperties = { projectId: string; confidence: number };

function isMappable(project: ProjectMapMarker): project is MappableProject {
  return (
    typeof project.latitude === "number" &&
    Number.isFinite(project.latitude) &&
    project.latitude >= -90 &&
    project.latitude <= 90 &&
    typeof project.longitude === "number" &&
    Number.isFinite(project.longitude) &&
    project.longitude >= -180 &&
    project.longitude <= 180
  );
}

function projectHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

function confidenceValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function appendPopupLine(container: HTMLElement, label: string, value: string | null) {
  if (!value) return;
  const row = document.createElement("p");
  row.className = "m-0 text-[12px] leading-5 text-[var(--muted)]";
  const prefix = document.createElement("strong");
  prefix.className = "font-semibold text-[var(--ink)]";
  prefix.textContent = `${label}: `;
  row.append(prefix, document.createTextNode(value));
  container.append(row);
}

function popupContent(project: ProjectMapMarker): HTMLElement {
  const article = document.createElement("article");
  article.className = "min-w-[220px] max-w-[280px] p-1 font-sans";

  const address = document.createElement("h3");
  address.className = "m-0 text-[14px] font-bold leading-5 text-[var(--spruce)]";
  address.textContent = project.address;
  article.append(address);

  if (project.neighbourhood) {
    const neighbourhood = document.createElement("p");
    neighbourhood.className = "mt-0.5 mb-2 text-[12px] text-[var(--muted)]";
    neighbourhood.textContent = project.neighbourhood;
    article.append(neighbourhood);
  }

  appendPopupLine(article, "Category", project.categoryLabel);
  appendPopupLine(article, "Stage", project.stageLabel);
  appendPopupLine(article, "Confidence", `${confidenceValue(project.confidence)}%`);
  appendPopupLine(article, "Latest event", project.latestEventLabel);
  appendPopupLine(article, "Event date", project.latestEventDate);
  appendPopupLine(article, "Construction value", project.constructionValue);
  appendPopupLine(
    article,
    "Estimated units",
    project.estimatedUnits === null ? null : String(project.estimatedUnits),
  );

  const link = document.createElement("a");
  link.className =
    "mt-3 inline-flex min-h-10 items-center rounded-lg bg-[var(--teal)] px-3 text-[12px] font-semibold text-white no-underline outline-none hover:bg-[var(--spruce-soft)] focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2";
  link.href = projectHref(project.id);
  link.textContent = "View project timeline";
  article.append(link);

  return article;
}

function fallbackCopy(status: Exclude<MapStatus, "loading" | "ready" | "token-missing">) {
  switch (status) {
    case "coordinates-missing":
      return {
        icon: MapPinOff,
        title: "No mapped projects",
        detail: "None of the projects in these results currently has usable map coordinates.",
      };
    case "unsupported":
      return {
        icon: MapPinOff,
        title: "Street map unavailable",
        detail: "This browser cannot render the street map, so a schematic project map is shown.",
      };
    case "error":
      return {
        icon: TriangleAlert,
        title: "Street map unavailable",
        detail: "The map provider could not be reached, so a schematic project map is shown.",
      };
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

type SchematicCluster = {
  key: string;
  projects: MappableProject[];
  left: number;
  top: number;
};

function schematicClusters(projects: readonly MappableProject[]): SchematicCluster[] {
  const cells = new Map<
    string,
    { projects: MappableProject[]; leftTotal: number; topTotal: number }
  >();

  for (const project of projects) {
    const left = clamp(
      ((project.longitude - EDMONTON_BOUNDS.west) / (EDMONTON_BOUNDS.east - EDMONTON_BOUNDS.west)) *
        100,
      3,
      97,
    );
    const top = clamp(
      ((EDMONTON_BOUNDS.north - project.latitude) /
        (EDMONTON_BOUNDS.north - EDMONTON_BOUNDS.south)) *
        100,
      3,
      97,
    );
    const key = `${Math.min(9, Math.floor(left / 10))}:${Math.min(7, Math.floor(top / 12.5))}`;
    const cell = cells.get(key) ?? { projects: [], leftTotal: 0, topTotal: 0 };
    cell.projects.push(project);
    cell.leftTotal += left;
    cell.topTotal += top;
    cells.set(key, cell);
  }

  return [...cells.entries()].map(([key, cell]) => ({
    key,
    projects: cell.projects,
    left: cell.leftTotal / cell.projects.length,
    top: cell.topTotal / cell.projects.length,
  }));
}

function SchematicProjectMap({
  projects,
  selectedId,
  status,
  onSelect,
}: {
  projects: readonly MappableProject[];
  selectedId: string | null;
  status: "token-missing" | "unsupported" | "error";
  onSelect: (projectId: string) => void;
}) {
  const clusters = useMemo(() => schematicClusters(projects), [projects]);
  const selected = projects.find((project) => project.id === selectedId) ?? projects[0] ?? null;
  const explanation =
    status === "token-missing"
      ? "Schematic view · add an optional public Mapbox token to show streets"
      : fallbackCopy(status).detail;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#e8ebe6]" data-map-mode="schematic">
      <div
        className="map-grid"
        style={{ position: "absolute", inset: 0, minHeight: 0, border: 0 }}
        aria-hidden="true"
      >
        <div className="river river-one" />
        <div className="river river-two" />
        <div className="road road-a" />
        <div className="road road-b" />
        <div className="road road-c" />
        <span className="map-label downtown">Downtown</span>
        <span className="map-label strathcona">Strathcona</span>
        <span className="map-label university">University</span>
      </div>

      {clusters.map((cluster) => {
        const containsSelected = cluster.projects.some((project) => project.id === selected?.id);
        const diameter = clamp(35 + Math.log2(cluster.projects.length + 1) * 7, 40, 68);
        const first = cluster.projects[0];
        return (
          <button
            key={cluster.key}
            type="button"
            className={cn(
              "absolute z-10 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-white bg-[var(--teal)] text-xs font-extrabold text-white shadow-[0_5px_14px_rgba(23,48,51,0.28)] transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--spruce)] focus-visible:ring-offset-2",
              containsSelected && "bg-[var(--copper)] ring-4 ring-white/70",
            )}
            style={{
              left: `${cluster.left}%`,
              top: `${cluster.top}%`,
              width: diameter,
              height: diameter,
            }}
            onClick={() => onSelect(first.id)}
            aria-label={`Select ${cluster.projects.length} ${cluster.projects.length === 1 ? "project" : "projects"} near ${first.neighbourhood ?? first.address}`}
          >
            {cluster.projects.length}
          </button>
        );
      })}

      <p className="absolute bottom-3 left-3 z-20 m-0 max-w-[45%] rounded-lg border border-[var(--border)] bg-white/95 px-3 py-2 text-[10px] leading-4 font-semibold text-[var(--muted)] shadow-sm">
        {explanation}
      </p>
      {selected && (
        <Link
          href={projectHref(selected.id)}
          className="absolute right-3 bottom-3 z-20 max-w-[46%] truncate rounded-lg bg-[var(--spruce)] px-3 py-2 text-[11px] font-semibold text-white no-underline shadow-md hover:bg-[var(--teal)] focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2"
        >
          {selected.address} · View timeline
        </Link>
      )}
    </div>
  );
}

export function ProjectMap({
  markers,
  mapboxToken,
  mapStyleUrl,
  initialSelectedId,
  showList = true,
  listBatchSize = DEFAULT_LIST_BATCH_SIZE,
  className,
}: ProjectMapProps) {
  const mappableProjects = useMemo(() => markers.filter(isMappable), [markers]);
  const projectsById = useMemo(
    () => new Map(mappableProjects.map((project) => [project.id, project])),
    [mappableProjects],
  );
  const featureCollection = useMemo<FeatureCollection<Point, ProjectFeatureProperties>>(
    () => ({
      type: "FeatureCollection",
      features: mappableProjects.map((project) => ({
        type: "Feature",
        id: project.id,
        geometry: { type: "Point", coordinates: [project.longitude, project.latitude] },
        properties: {
          projectId: project.id,
          confidence: confidenceValue(project.confidence),
        },
      })),
    }),
    [mappableProjects],
  );
  const initialSelection =
    markers.find((project) => project.id === initialSelectedId)?.id ??
    mappableProjects[0]?.id ??
    markers[0]?.id ??
    null;
  const safeBatchSize = Number.isSafeInteger(listBatchSize)
    ? clamp(listBatchSize, 10, 100)
    : DEFAULT_LIST_BATCH_SIZE;
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection);
  const [visibleListCount, setVisibleListCount] = useState(safeBatchSize);
  const [runtimeStatus, setRuntimeStatus] = useState<MapStatus>("loading");
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const popupRef = useRef<MapboxPopup | null>(null);
  const listItemsRef = useRef(new Map<string, HTMLLIElement>());
  const configuredToken = mapboxToken?.trim() ?? "";
  const prerequisiteStatus: MapStatus | null =
    mappableProjects.length === 0
      ? "coordinates-missing"
      : !configuredToken
        ? "token-missing"
        : null;
  const status = prerequisiteStatus ?? runtimeStatus;
  const effectiveSelectedId =
    selectedId && markers.some((project) => project.id === selectedId)
      ? selectedId
      : (mappableProjects[0]?.id ?? markers[0]?.id ?? null);
  const visibleMarkers = markers.slice(0, visibleListCount);
  const remainingMarkers = Math.max(0, markers.length - visibleMarkers.length);

  const selectProject = useCallback(
    (projectId: string, moveMap: boolean, revealInList: boolean) => {
      setSelectedId(projectId);
      const project = projectsById.get(projectId);
      const map = mapRef.current;
      const popup = popupRef.current;

      if (project && map?.getLayer(PROJECT_LAYER_ID)) {
        map.setPaintProperty(PROJECT_LAYER_ID, "circle-color", [
          "case",
          ["==", ["get", "projectId"], projectId],
          "#c8752a",
          "#176473",
        ]);
        if (moveMap) {
          const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          map.easeTo({
            center: [project.longitude, project.latitude],
            zoom: Math.max(map.getZoom(), 13),
            duration: reduceMotion ? 0 : 450,
          });
        }
        popup
          ?.setLngLat([project.longitude, project.latitude])
          .setDOMContent(popupContent(project))
          .addTo(map);
      }

      if (revealInList) {
        window.requestAnimationFrame(() => {
          listItemsRef.current.get(projectId)?.scrollIntoView({ block: "nearest" });
        });
      }
    },
    [projectsById],
  );

  useEffect(() => {
    const container = mapContainerRef.current;
    if (prerequisiteStatus || !container || typeof window === "undefined") return;
    const mapContainer: HTMLDivElement = container;

    let cancelled = false;
    let map: MapboxMap | null = null;

    async function initializeMap() {
      try {
        const mapbox = (await import("mapbox-gl")).default;
        if (cancelled) return;
        setRuntimeStatus("loading");
        if (!mapbox.supported()) {
          setRuntimeStatus("unsupported");
          return;
        }

        const mapInstance = new mapbox.Map({
          accessToken: configuredToken,
          container: mapContainer,
          style: mapStyleUrl?.trim() || DEFAULT_MAP_STYLE,
          center: EDMONTON_CENTER,
          zoom: 10,
        });
        const popup = new mapbox.Popup({ offset: 18, closeButton: true });
        map = mapInstance;
        mapRef.current = mapInstance;
        popupRef.current = popup;
        mapInstance.addControl(new mapbox.NavigationControl({ showCompass: false }), "top-right");

        let loaded = false;
        const handleLoad = () => {
          if (cancelled) return;
          try {
            mapInstance.addSource(MAP_SOURCE_ID, {
              type: "geojson",
              data: featureCollection,
              cluster: true,
              clusterMaxZoom: 14,
              clusterRadius: 48,
            });
            mapInstance.addLayer({
              id: CLUSTER_LAYER_ID,
              type: "circle",
              source: MAP_SOURCE_ID,
              filter: ["has", "point_count"],
              paint: {
                "circle-color": [
                  "step",
                  ["get", "point_count"],
                  "#176473",
                  25,
                  "#c8752a",
                  100,
                  "#173033",
                ],
                "circle-radius": ["step", ["get", "point_count"], 20, 25, 26, 100, 34],
                "circle-stroke-width": 3,
                "circle-stroke-color": "#ffffff",
                "circle-opacity": 0.94,
              },
            });
            mapInstance.addLayer({
              id: CLUSTER_COUNT_LAYER_ID,
              type: "symbol",
              source: MAP_SOURCE_ID,
              filter: ["has", "point_count"],
              layout: {
                "text-field": ["get", "point_count_abbreviated"],
                "text-size": 12,
                "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
              },
              paint: { "text-color": "#ffffff" },
            });
            mapInstance.addLayer({
              id: PROJECT_LAYER_ID,
              type: "circle",
              source: MAP_SOURCE_ID,
              filter: ["!", ["has", "point_count"]],
              paint: {
                "circle-color": [
                  "case",
                  ["==", ["get", "projectId"], initialSelection ?? ""],
                  "#c8752a",
                  "#176473",
                ],
                "circle-radius": 14,
                "circle-stroke-width": 3,
                "circle-stroke-color": "#ffffff",
              },
            });
            mapInstance.addLayer({
              id: PROJECT_LABEL_LAYER_ID,
              type: "symbol",
              source: MAP_SOURCE_ID,
              filter: ["!", ["has", "point_count"]],
              layout: {
                "text-field": ["to-string", ["get", "confidence"]],
                "text-size": 10,
                "text-font": ["DIN Offc Pro Bold", "Arial Unicode MS Bold"],
              },
              paint: { "text-color": "#ffffff" },
            });

            const bounds = new mapbox.LngLatBounds();
            for (const project of mappableProjects) {
              bounds.extend([project.longitude, project.latitude]);
            }
            if (mappableProjects.length === 1) {
              mapInstance.jumpTo({
                center: [mappableProjects[0].longitude, mappableProjects[0].latitude],
                zoom: 13,
              });
            } else if (!bounds.isEmpty()) {
              mapInstance.fitBounds(bounds, { padding: 54, maxZoom: 14, duration: 0 });
            }

            loaded = true;
            setRuntimeStatus("ready");
            if (initialSelectedId && projectsById.has(initialSelectedId)) {
              selectProject(initialSelectedId, false, false);
            }
          } catch {
            if (!cancelled) setRuntimeStatus("error");
          }
        };
        const handleError = (event: MapboxErrorEvent) => {
          const statusCode = (event.error as Error & { status?: number }).status;
          if (!loaded || statusCode === 401 || statusCode === 403) {
            if (!cancelled) setRuntimeStatus("error");
          }
        };
        const handleClusterClick = (event: MapLayerMouseEvent) => {
          const feature = mapInstance.queryRenderedFeatures(event.point, {
            layers: [CLUSTER_LAYER_ID],
          })[0];
          const clusterId = Number(feature?.properties?.cluster_id);
          if (!feature || feature.geometry.type !== "Point" || !Number.isFinite(clusterId)) return;
          const coordinates = feature.geometry.coordinates as [number, number];
          const source = mapInstance.getSource(MAP_SOURCE_ID) as GeoJSONSource | undefined;
          source?.getClusterExpansionZoom(clusterId, (error, zoom) => {
            if (error || zoom === null || zoom === undefined) return;
            mapInstance.easeTo({ center: coordinates, zoom });
          });
        };
        const handleProjectClick = (event: MapLayerMouseEvent) => {
          const feature = mapInstance.queryRenderedFeatures(event.point, {
            layers: [PROJECT_LAYER_ID],
          })[0];
          const projectId = feature?.properties?.projectId;
          if (typeof projectId === "string") selectProject(projectId, false, false);
        };
        const handlePointerEnter = () => {
          mapInstance.getCanvas().style.cursor = "pointer";
        };
        const handlePointerLeave = () => {
          mapInstance.getCanvas().style.cursor = "";
        };

        mapInstance.on("load", handleLoad);
        mapInstance.on("error", handleError);
        mapInstance.on("click", CLUSTER_LAYER_ID, handleClusterClick);
        mapInstance.on("click", PROJECT_LAYER_ID, handleProjectClick);
        mapInstance.on("mouseenter", CLUSTER_LAYER_ID, handlePointerEnter);
        mapInstance.on("mouseenter", PROJECT_LAYER_ID, handlePointerEnter);
        mapInstance.on("mouseleave", CLUSTER_LAYER_ID, handlePointerLeave);
        mapInstance.on("mouseleave", PROJECT_LAYER_ID, handlePointerLeave);
      } catch {
        if (!cancelled) setRuntimeStatus("error");
      }
    }

    void initializeMap();

    return () => {
      cancelled = true;
      popupRef.current?.remove();
      popupRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, [
    configuredToken,
    featureCollection,
    initialSelectedId,
    initialSelection,
    mapStyleUrl,
    mappableProjects,
    prerequisiteStatus,
    projectsById,
    selectProject,
  ]);

  const genericFallback =
    status === "coordinates-missing" ? fallbackCopy("coordinates-missing") : null;
  const schematicStatus =
    status === "token-missing" || status === "unsupported" || status === "error" ? status : null;

  return (
    <Card
      className={cn(
        "overflow-hidden",
        showList &&
          "grid lg:h-[min(720px,calc(100vh-150px))] lg:min-h-[560px] lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.65fr)]",
        className,
      )}
      data-project-map
    >
      <section className="relative min-h-[430px] bg-[#e8ebe6] lg:min-h-[500px]">
        <div
          ref={mapContainerRef}
          className="absolute inset-0"
          role="region"
          aria-label="Map of Edmonton infill projects"
        />

        {status === "loading" && (
          <div
            className="absolute inset-0 grid place-items-center bg-[#e8ebe6]/90 p-6 text-center"
            aria-live="polite"
            aria-busy="true"
          >
            <div>
              <div className="mx-auto mb-3 size-8 animate-pulse rounded-lg bg-[var(--teal)]" />
              <p className="m-0 text-xs font-semibold text-[var(--muted)]">Loading project map…</p>
            </div>
          </div>
        )}

        {schematicStatus && mappableProjects.length > 0 && (
          <SchematicProjectMap
            projects={mappableProjects}
            selectedId={effectiveSelectedId}
            status={schematicStatus}
            onSelect={(projectId) => selectProject(projectId, false, true)}
          />
        )}

        {genericFallback && (
          <div className="absolute inset-0 grid place-items-center bg-[#e8ebe6] p-7 text-center">
            <div className="max-w-sm" role="status">
              <genericFallback.icon
                className="mx-auto mb-3 text-[var(--teal)]"
                size={30}
                aria-hidden="true"
              />
              <h2 className="m-0 text-base font-bold text-[var(--spruce)]">
                {genericFallback.title}
              </h2>
              <p className="mt-2 mb-0 text-xs leading-5 text-[var(--muted)]">
                {genericFallback.detail}
              </p>
            </div>
          </div>
        )}
      </section>

      {showList && (
        <section
          className="flex max-h-[560px] min-h-0 flex-col border-t border-[var(--border-soft)] bg-white lg:max-h-none lg:border-t-0 lg:border-l"
          aria-labelledby="mapped-projects-title"
          data-project-map-list
        >
          <div className="border-b border-[var(--border-soft)] px-4 py-4">
            <div className="flex items-center gap-2 text-[var(--teal)]">
              <MapPinned size={17} aria-hidden="true" />
              <h2 id="mapped-projects-title" className="m-0 text-sm font-bold text-[var(--spruce)]">
                Projects in view
              </h2>
            </div>
            <p className="mt-1 mb-0 text-xs text-[var(--muted)]">
              Showing {visibleMarkers.length.toLocaleString("en-CA")} of{" "}
              {markers.length.toLocaleString("en-CA")}
            </p>
          </div>

          {markers.length === 0 ? (
            <div className="grid flex-1 place-items-center p-7 text-center">
              <div>
                <MapPinOff
                  className="mx-auto mb-3 text-[var(--muted)]"
                  size={28}
                  aria-hidden="true"
                />
                <h3 className="m-0 text-sm font-bold text-[var(--spruce)]">No projects found</h3>
                <p className="mt-1 mb-0 text-xs leading-5 text-[var(--muted)]">
                  Adjust the filters to widen these results.
                </p>
              </div>
            </div>
          ) : (
            <ol
              className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-2"
              aria-label="Mapped projects"
            >
              {visibleMarkers.map((project) => {
                const selected = project.id === effectiveSelectedId;
                return (
                  <li
                    ref={(element) => {
                      if (element) listItemsRef.current.set(project.id, element);
                      else listItemsRef.current.delete(project.id);
                    }}
                    className={cn(
                      "rounded-lg border border-transparent p-3",
                      selected && "border-[#b5d5d9] bg-[var(--teal-soft)]",
                    )}
                    key={project.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={projectHref(project.id)}
                          className="block truncate text-xs font-bold text-[var(--spruce)] no-underline outline-none hover:text-[var(--teal)] focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2"
                          onFocus={() => selectProject(project.id, false, false)}
                        >
                          {project.address}
                          {selected && <span className="sr-only"> (selected on map)</span>}
                        </Link>
                        <p className="mt-1 mb-0 truncate text-[11px] text-[var(--muted)]">
                          {project.neighbourhood ?? "Neighbourhood unavailable"}
                        </p>
                      </div>
                      <Badge tone={confidenceValue(project.confidence) >= 80 ? "green" : "copper"}>
                        {confidenceValue(project.confidence)}%
                      </Badge>
                    </div>
                    <p className="mt-2 mb-0 text-[11px] leading-4 text-[var(--muted)]">
                      <span className="font-semibold text-[var(--ink)]">
                        {project.categoryLabel}
                      </span>
                      <span aria-hidden="true"> · </span>
                      {project.stageLabel}
                    </p>
                    {isMappable(project) ? (
                      <button
                        type="button"
                        className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-[var(--teal)] outline-none hover:bg-white/70 focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2"
                        onClick={() => selectProject(project.id, true, false)}
                        aria-pressed={selected}
                      >
                        <LocateFixed size={14} aria-hidden="true" /> Show on map
                      </button>
                    ) : (
                      <p className="mt-2 mb-0 text-[11px] text-[var(--muted-soft)]">
                        Map location unavailable
                      </p>
                    )}
                  </li>
                );
              })}
              {remainingMarkers > 0 && (
                <li className="sticky bottom-0 border-t border-[var(--border-soft)] bg-white/95 p-3 backdrop-blur-sm">
                  <button
                    type="button"
                    className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-[var(--teal)] bg-white px-3 text-xs font-semibold text-[var(--teal)] transition-colors hover:bg-[var(--teal-soft)] focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2"
                    onClick={() =>
                      setVisibleListCount((current) =>
                        Math.min(markers.length, current + safeBatchSize),
                      )
                    }
                  >
                    Load {Math.min(safeBatchSize, remainingMarkers)} more
                  </button>
                </li>
              )}
            </ol>
          )}
        </section>
      )}
    </Card>
  );
}
