"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LocateFixed, MapPinned, MapPinOff, TriangleAlert } from "lucide-react";
import type { FeatureCollection, Point } from "geojson";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Popup as MapLibrePopup,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  EDMONTON_CENTER,
  EDMONTON_COORDINATE_LIMITS,
  resolveMapStyle,
} from "@/components/maps/map-style";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
  latestInfillActivityDate: string | null;
  constructionValue: string | null;
  estimatedUnits: number | null;
  latitude: number | null;
  longitude: number | null;
};

type ProjectMapProps = {
  markers: readonly ProjectMapMarker[];
  mapStyleUrl?: string | null;
  mapTileUrl?: string | null;
  initialSelectedId?: string | null;
  showList?: boolean;
  listBatchSize?: number;
  accessibleListHref?: string | null;
  className?: string;
};

type MapStatus = "loading" | "ready" | "coordinates-missing" | "unsupported" | "error";

type MappableProject = ProjectMapMarker & { latitude: number; longitude: number };
type ProjectFeatureProperties = { projectId: string; confidence: number };

function isMappable(project: ProjectMapMarker): project is MappableProject {
  return (
    typeof project.latitude === "number" &&
    Number.isFinite(project.latitude) &&
    project.latitude >= EDMONTON_COORDINATE_LIMITS.south &&
    project.latitude <= EDMONTON_COORDINATE_LIMITS.north &&
    typeof project.longitude === "number" &&
    Number.isFinite(project.longitude) &&
    project.longitude >= EDMONTON_COORDINATE_LIMITS.west &&
    project.longitude <= EDMONTON_COORDINATE_LIMITS.east
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
  appendPopupLine(article, "Latest infill milestone", project.latestInfillActivityDate);
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

function fallbackCopy(status: Exclude<MapStatus, "loading" | "ready">) {
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
        detail:
          "This browser cannot render the geographic street map. Project details remain available in the list.",
      };
    case "error":
      return {
        icon: TriangleAlert,
        title: "Street map unavailable",
        detail:
          "The geographic basemap could not be loaded. Check the internet connection or configured map provider and try again.",
      };
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function ProjectMap({
  markers,
  mapStyleUrl,
  mapTileUrl,
  initialSelectedId,
  showList = true,
  listBatchSize = DEFAULT_LIST_BATCH_SIZE,
  accessibleListHref,
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
  const markerSetKey = useMemo(() => markers.map((marker) => marker.id).join("\u0000"), [markers]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection);
  const [listWindow, setListWindow] = useState({ key: markerSetKey, count: safeBatchSize });
  const [runtimeStatus, setRuntimeStatus] = useState<MapStatus>("loading");
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<MapLibrePopup | null>(null);
  const listItemsRef = useRef(new Map<string, HTMLLIElement>());
  const prerequisiteStatus: MapStatus | null =
    mappableProjects.length === 0 ? "coordinates-missing" : null;
  const status = prerequisiteStatus ?? runtimeStatus;
  const effectiveSelectedId =
    selectedId && markers.some((project) => project.id === selectedId)
      ? selectedId
      : (mappableProjects[0]?.id ?? markers[0]?.id ?? null);
  const selectedProject =
    markers.find((project) => project.id === effectiveSelectedId) ?? markers[0] ?? null;
  const visibleListCount = listWindow.key === markerSetKey ? listWindow.count : safeBatchSize;
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
            zoom: Math.max(map.getZoom(), 15),
            duration: reduceMotion ? 0 : 450,
          });
        }
        popup
          ?.setLngLat([project.longitude, project.latitude])
          .setDOMContent(popupContent(project))
          .addTo(map);
      }

      if (revealInList) {
        const projectIndex = markers.findIndex((marker) => marker.id === projectId);
        if (projectIndex >= 0) {
          setListWindow((current) => ({
            key: markerSetKey,
            count: Math.max(
              current.key === markerSetKey ? current.count : safeBatchSize,
              Math.min(
                markers.length,
                (Math.floor(projectIndex / safeBatchSize) + 1) * safeBatchSize,
              ),
            ),
          }));
        }
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() => {
            listItemsRef.current.get(projectId)?.scrollIntoView({ block: "nearest" });
          }),
        );
      }
    },
    [markerSetKey, markers, projectsById, safeBatchSize],
  );

  useEffect(() => {
    const container = mapContainerRef.current;
    if (prerequisiteStatus || !container || typeof window === "undefined") return;
    const mapContainer: HTMLDivElement = container;

    let cancelled = false;
    let map: MapLibreMap | null = null;

    async function initializeMap() {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled) return;
        setRuntimeStatus("loading");
        if (!document.createElement("canvas").getContext("webgl2")) {
          setRuntimeStatus("unsupported");
          return;
        }

        const mapInstance = new maplibre.Map({
          container: mapContainer,
          style: resolveMapStyle({ mapStyleUrl, mapTileUrl }),
          center: EDMONTON_CENTER,
          zoom: 10,
        });
        const popup = new maplibre.Popup({
          offset: 18,
          closeButton: true,
          focusAfterOpen: false,
        });
        map = mapInstance;
        mapRef.current = mapInstance;
        popupRef.current = popup;
        mapInstance.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");

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
              },
              paint: { "text-color": "#ffffff" },
            });

            const bounds = new maplibre.LngLatBounds();
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
        const handleError = () => {
          if (!loaded && !cancelled) setRuntimeStatus("error");
        };
        const handleClusterClick = async (event: MapLayerMouseEvent) => {
          const feature = mapInstance.queryRenderedFeatures(event.point, {
            layers: [CLUSTER_LAYER_ID],
          })[0];
          const clusterId = Number(feature?.properties?.cluster_id);
          if (!feature || feature.geometry.type !== "Point" || !Number.isFinite(clusterId)) return;
          const coordinates = feature.geometry.coordinates as [number, number];
          const source = mapInstance.getSource(MAP_SOURCE_ID) as GeoJSONSource | undefined;
          if (!source) return;
          try {
            const zoom = await source.getClusterExpansionZoom(clusterId);
            mapInstance.easeTo({ center: coordinates, zoom });
          } catch {
            // A cluster may disappear while tiles refresh; leave the current view unchanged.
          }
        };
        const handleProjectClick = (event: MapLayerMouseEvent) => {
          const feature = mapInstance.queryRenderedFeatures(event.point, {
            layers: [PROJECT_LAYER_ID],
          })[0];
          const projectId = feature?.properties?.projectId;
          if (typeof projectId === "string") selectProject(projectId, false, showList);
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
    featureCollection,
    initialSelectedId,
    initialSelection,
    mapStyleUrl,
    mapTileUrl,
    mappableProjects,
    prerequisiteStatus,
    projectsById,
    selectProject,
    showList,
  ]);

  const genericFallback =
    status === "coordinates-missing" || status === "unsupported" || status === "error"
      ? fallbackCopy(status)
      : null;

  return (
    <Card
      className={cn(
        "overflow-hidden",
        showList &&
          "grid lg:h-[min(720px,calc(100vh-150px))] lg:min-h-[560px] lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.65fr)]",
        className,
      )}
      data-project-map
      data-map-state={status}
    >
      <section className="relative min-h-[430px] bg-[#e8ebe6] lg:min-h-[500px]">
        <div className="absolute inset-0">
          <div
            ref={mapContainerRef}
            className="h-full w-full"
            role="region"
            aria-label="Map of Edmonton infill projects"
            aria-busy={status === "loading"}
          />
        </div>

        {status === "loading" && (
          <div
            className="absolute inset-0 z-30 grid place-items-center bg-[#e8ebe6]/90 p-6 text-center"
            aria-live="polite"
            aria-busy="true"
          >
            <div>
              <div className="mx-auto mb-3 size-8 animate-pulse rounded-lg bg-[var(--teal)]" />
              <p className="m-0 text-xs font-semibold text-[var(--muted)]">Loading project map…</p>
            </div>
          </div>
        )}

        {genericFallback && (
          <div className="absolute inset-0 z-30 grid place-items-center bg-[#e8ebe6] p-7 text-center">
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

        {!showList && selectedProject && (
          <div
            className="absolute bottom-8 left-3 z-20 max-w-[min(360px,calc(100%-24px))] rounded-lg border border-[var(--border)] bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm"
            aria-live="polite"
          >
            <p className="m-0 truncate text-xs font-semibold text-[var(--ink)]">
              {selectedProject.address}
            </p>
            <Link
              href={projectHref(selectedProject.id)}
              className="mt-1 inline-flex min-h-10 items-center text-xs font-semibold text-[var(--teal)] no-underline hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2"
            >
              View project timeline
            </Link>
            {accessibleListHref && markers.length > 1 && (
              <Link
                href={accessibleListHref}
                className="ml-3 inline-flex min-h-10 items-center text-xs font-semibold text-[var(--teal)] no-underline hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2"
              >
                Browse all in List view
              </Link>
            )}
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
                      setListWindow((current) => ({
                        key: markerSetKey,
                        count: Math.min(
                          markers.length,
                          (current.key === markerSetKey ? current.count : safeBatchSize) +
                            safeBatchSize,
                        ),
                      }))
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
