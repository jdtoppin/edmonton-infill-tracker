"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, MapPinned, MapPinOff, TriangleAlert } from "lucide-react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  EDMONTON_CENTER,
  EDMONTON_COORDINATE_LIMITS,
  resolveMapStyle,
} from "@/components/maps/map-style";
import { Card } from "@/components/ui/card";
import type { DashboardOverview } from "@/src/services/project-read-model";

type ActivityArea = DashboardOverview["neighbourhoodBreakdown"][number];
type MappableActivityArea = ActivityArea & { latitude: number; longitude: number };

type NeighbourhoodActivityMapProps = {
  areas: readonly ActivityArea[];
  mapStyleUrl?: string | null;
  mapTileUrl?: string | null;
};

type MapState = "loading" | "ready" | "empty" | "unsupported" | "error";

function isMappable(area: ActivityArea): area is MappableActivityArea {
  return (
    typeof area.latitude === "number" &&
    Number.isFinite(area.latitude) &&
    area.latitude >= EDMONTON_COORDINATE_LIMITS.south &&
    area.latitude <= EDMONTON_COORDINATE_LIMITS.north &&
    typeof area.longitude === "number" &&
    Number.isFinite(area.longitude) &&
    area.longitude >= EDMONTON_COORDINATE_LIMITS.west &&
    area.longitude <= EDMONTON_COORDINATE_LIMITS.east
  );
}

function markerDiameter(count: number, maximum: number): number {
  return 40 + Math.round((count / Math.max(1, maximum)) * 22);
}

function applyMarkerSelection(
  markers: ReadonlyMap<string, HTMLButtonElement>,
  selectedId: string | null,
) {
  for (const [areaId, marker] of markers) {
    const selected = areaId === selectedId;
    marker.setAttribute("aria-pressed", String(selected));
    marker.style.backgroundColor = selected ? "#c8752a" : "#176473";
    marker.style.boxShadow = selected
      ? "0 0 0 4px rgba(255,255,255,0.75), 0 5px 14px rgba(23,48,51,0.32)"
      : "0 5px 14px rgba(23,48,51,0.28)";
  }
}

function unavailableCopy(state: "empty" | "unsupported" | "error") {
  switch (state) {
    case "empty":
      return {
        icon: MapPinOff,
        title: "No mapped neighbourhood activity",
        detail:
          "Neighbourhood totals are available, but their projects do not yet have usable Edmonton coordinates.",
      };
    case "unsupported":
      return {
        icon: MapPinOff,
        title: "Geographic map unavailable",
        detail: "This browser cannot render the interactive geographic map.",
      };
    case "error":
      return {
        icon: TriangleAlert,
        title: "Geographic map unavailable",
        detail: "The basemap provider could not be reached. The neighbourhood list remains usable.",
      };
  }
}

export function NeighbourhoodActivityMap({
  areas,
  mapStyleUrl,
  mapTileUrl,
}: NeighbourhoodActivityMapProps) {
  const visibleAreas = useMemo(() => areas.slice(0, 10), [areas]);
  const mappedAreas = useMemo(() => visibleAreas.filter(isMappable), [visibleAreas]);
  const [selectedId, setSelectedId] = useState<string | null>(
    mappedAreas[0]?.id ?? visibleAreas[0]?.id ?? null,
  );
  const [mapState, setMapState] = useState<MapState>(mappedAreas.length > 0 ? "loading" : "empty");
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerElementsRef = useRef(new Map<string, HTMLButtonElement>());
  const effectiveSelectedId =
    selectedId && visibleAreas.some((area) => area.id === selectedId)
      ? selectedId
      : (mappedAreas[0]?.id ?? visibleAreas[0]?.id ?? null);
  const selected =
    visibleAreas.find((area) => area.id === effectiveSelectedId) ?? visibleAreas[0] ?? null;
  const selectedIdRef = useRef<string | null>(null);
  const maximumCount = Math.max(1, ...visibleAreas.map((area) => area.count));

  const selectArea = useCallback(
    (areaId: string, moveMap: boolean) => {
      setSelectedId(areaId);
      const area = mappedAreas.find((candidate) => candidate.id === areaId);
      const map = mapRef.current;
      if (moveMap && area && map) {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        map.easeTo({
          center: [area.longitude, area.latitude],
          zoom: Math.max(map.getZoom(), 12),
          duration: reduceMotion ? 0 : 450,
        });
      }
    },
    [mappedAreas],
  );

  useEffect(() => {
    selectedIdRef.current = effectiveSelectedId;
    applyMarkerSelection(markerElementsRef.current, effectiveSelectedId);
  }, [effectiveSelectedId]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mappedAreas.length === 0) {
      setMapState("empty");
      return;
    }
    const mapContainer = container;

    let cancelled = false;
    let map: MapLibreMap | null = null;
    let loaded = false;
    const mapMarkers: MapLibreMarker[] = [];
    const markerElements = new Map<string, HTMLButtonElement>();
    markerElementsRef.current = markerElements;
    setMapState("loading");

    async function initializeMap() {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled) return;
        if (!document.createElement("canvas").getContext("webgl2")) {
          setMapState("unsupported");
          return;
        }

        const mapInstance = new maplibre.Map({
          container: mapContainer,
          style: resolveMapStyle({ mapStyleUrl, mapTileUrl }),
          center: EDMONTON_CENTER,
          zoom: 10,
          attributionControl: {},
        });
        map = mapInstance;
        mapRef.current = mapInstance;
        mapInstance.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");

        const handleLoad = () => {
          if (cancelled) return;
          try {
            const bounds = new maplibre.LngLatBounds();
            for (const area of mappedAreas) {
              const markerButton = document.createElement("button");
              markerButton.type = "button";
              markerButton.className =
                "grid place-items-center rounded-full border-[3px] border-white text-xs font-extrabold text-white transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--spruce)] focus-visible:ring-offset-2";
              const diameter = markerDiameter(area.count, maximumCount);
              markerButton.style.width = `${diameter}px`;
              markerButton.style.height = `${diameter}px`;
              markerButton.textContent = String(area.count);
              markerButton.setAttribute(
                "aria-label",
                `${area.name}: ${area.count} active ${area.count === 1 ? "project" : "projects"} at the average mapped-project location`,
              );
              markerButton.addEventListener("click", () => selectArea(area.id, false));

              const marker = new maplibre.Marker({ element: markerButton, anchor: "center" })
                .setLngLat([area.longitude, area.latitude])
                .addTo(mapInstance);
              mapMarkers.push(marker);
              markerElements.set(area.id, markerButton);
              bounds.extend([area.longitude, area.latitude]);
            }

            applyMarkerSelection(markerElements, selectedIdRef.current);
            if (mappedAreas.length === 1) {
              mapInstance.jumpTo({
                center: [mappedAreas[0].longitude, mappedAreas[0].latitude],
                zoom: 12,
              });
            } else if (!bounds.isEmpty()) {
              mapInstance.fitBounds(bounds, { padding: 58, maxZoom: 12, duration: 0 });
            }

            loaded = true;
            setMapState("ready");
          } catch {
            if (!cancelled) setMapState("error");
          }
        };

        const handleError = () => {
          if (!loaded && !cancelled) setMapState("error");
        };

        mapInstance.on("load", handleLoad);
        mapInstance.on("error", handleError);
      } catch (error) {
        if (cancelled) return;
        setMapState(
          error instanceof Error && error.name === "GPUInitializationError"
            ? "unsupported"
            : "error",
        );
      }
    }

    void initializeMap();

    return () => {
      cancelled = true;
      for (const marker of mapMarkers) marker.remove();
      markerElements.clear();
      markerElementsRef.current = new Map();
      map?.remove();
      mapRef.current = null;
    };
  }, [mapStyleUrl, mapTileUrl, mappedAreas, maximumCount, selectArea]);

  const unavailable =
    mapState === "empty" || mapState === "unsupported" || mapState === "error"
      ? unavailableCopy(mapState)
      : null;

  return (
    <Card className="mt-4 overflow-hidden" data-overview-map data-map-state={mapState}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-soft)] px-5 py-4">
        <div>
          <div className="eyebrow">Leading neighbourhood distribution</div>
          <h2 className="m-0 text-base font-bold text-[var(--spruce)]">Project activity map</h2>
          <p className="mt-1 mb-0 text-xs leading-5 text-[var(--muted)]">
            Up to ten leading neighbourhoods are shown. Each circle is placed at the average
            mapped-project location; circles do not represent neighbourhood boundaries.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-[var(--teal-soft)] px-3 py-1.5 text-[11px] font-semibold text-[var(--teal)]">
          <MapPinned size={14} aria-hidden="true" /> {mappedAreas.length} leading mapped areas
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.65fr)]">
        <section className="relative min-h-[380px] border-r border-[var(--border-soft)] bg-[#e8ebe6]">
          <div
            ref={mapContainerRef}
            className="absolute inset-0"
            role="region"
            aria-label="Geographic map of project counts by Edmonton neighbourhood"
            aria-busy={mapState === "loading"}
          />

          {mapState === "loading" && (
            <div
              className="absolute inset-0 z-30 grid place-items-center bg-[#e8ebe6]/90 p-6 text-center"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <div>
                <div className="mx-auto mb-3 size-8 animate-pulse rounded-lg bg-[var(--teal)]" />
                <p className="m-0 text-xs font-semibold text-[var(--muted)]">
                  Loading geographic map…
                </p>
              </div>
            </div>
          )}

          {unavailable && (
            <div className="absolute inset-0 z-30 grid place-items-center bg-[#e8ebe6] p-7 text-center">
              <div className="max-w-sm" role="status">
                <unavailable.icon
                  className="mx-auto mb-3 text-[var(--teal)]"
                  size={30}
                  aria-hidden="true"
                />
                <strong className="block text-sm text-[var(--spruce)]">{unavailable.title}</strong>
                <p className="mt-2 mb-0 text-xs leading-5 text-[var(--muted)]">
                  {unavailable.detail}
                </p>
              </div>
            </div>
          )}
        </section>

        <aside className="flex flex-col bg-white p-5" aria-live="polite">
          <div className="eyebrow">Selected neighbourhood</div>
          {selected ? (
            <>
              <h3 className="mt-1 mb-0 text-xl font-bold text-[var(--spruce)]">{selected.name}</h3>
              <strong className="mt-3 block text-4xl tracking-[-0.04em] text-[var(--teal)]">
                {selected.count.toLocaleString("en-CA")}
              </strong>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Active {selected.count === 1 ? "project" : "projects"} currently grouped in this
                neighbourhood.
              </p>
              <Link
                href={`/projects?neighbourhood=${encodeURIComponent(selected.cityId)}`}
                className="mt-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--teal)] px-4 text-xs font-semibold text-white no-underline transition-colors hover:bg-[var(--spruce-soft)] focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2"
              >
                Explore this neighbourhood <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">No neighbourhood activity is available.</p>
          )}

          {visibleAreas.length > 1 && (
            <div className="mt-5 border-t border-[var(--border-soft)] pt-4">
              <div className="eyebrow">Leading areas</div>
              <div className="mt-2 grid gap-1">
                {visibleAreas.slice(0, 6).map((area) => (
                  <button
                    key={area.id}
                    type="button"
                    className={`flex min-h-10 items-center justify-between rounded-lg px-3 text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)] ${
                      area.id === selected?.id
                        ? "bg-[var(--teal-soft)] font-bold text-[var(--teal)]"
                        : "bg-transparent text-[var(--ink)] hover:bg-[#f7f8f5]"
                    }`}
                    aria-pressed={area.id === selected?.id}
                    onClick={() => selectArea(area.id, true)}
                  >
                    <span className="truncate">{area.name}</span>
                    <span className="ml-3 font-semibold">{area.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </Card>
  );
}
