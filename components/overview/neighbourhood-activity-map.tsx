"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, MapPinned, MapPinOff, TriangleAlert } from "lucide-react";
import type { FeatureCollection, Point } from "geojson";
import type {
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Marker as MapLibreMarker,
  Popup as MapLibrePopup,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  EDMONTON_CENTER,
  EDMONTON_COORDINATE_LIMITS,
  resolveMapStyle,
} from "@/components/maps/map-style";
import {
  addCurrentNeighbourhoodLabelOverlay,
  loadCurrentEdmontonNeighbourhoods,
  suppressAggregateBasemapLabels,
} from "@/components/maps/neighbourhood-labels";
import { Card } from "@/components/ui/card";
import type { DashboardOverview } from "@/src/services/project-read-model";

type ActivityArea = DashboardOverview["neighbourhoodBreakdown"][number];
type MappableActivityArea = ActivityArea & { latitude: number; longitude: number };
type ActivityProject = DashboardOverview["mapProjects"][number];
type MappableActivityProject = ActivityProject & { latitude: number; longitude: number };

const ACTIVITY_PROJECT_SOURCE_ID = "overview-activity-projects";
const ACTIVITY_PROJECT_LAYER_ID = "overview-activity-project-points";
const PROJECT_DETAIL_ZOOM = 11.75;
const MAX_VISIBLE_DOM_PROJECT_MARKERS = 250;

type NeighbourhoodActivityMapProps = {
  areas: readonly ActivityArea[];
  mapStyleUrl?: string | null;
  mapTileUrl?: string | null;
  projects: readonly ActivityProject[];
  range: DashboardOverview["range"];
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

function isMappableProject(project: ActivityProject): project is MappableActivityProject {
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

function markerDiameter(count: number, maximum: number): number {
  return 40 + Math.round((count / Math.max(1, maximum)) * 22);
}

function projectHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

function projectPopupContent(project: ActivityProject): HTMLElement {
  const article = document.createElement("article");
  article.className = "min-w-[210px] max-w-[280px] p-1 font-sans";
  const address = document.createElement("h3");
  address.className = "m-0 text-[13px] font-bold leading-5 text-[var(--spruce)]";
  address.textContent = project.address;
  const confidence = document.createElement("p");
  confidence.className = "mt-1 mb-0 text-[11px] text-[var(--muted)]";
  confidence.textContent = `${Math.max(0, Math.min(100, Math.round(project.confidence)))}% infill confidence`;
  const link = document.createElement("a");
  link.className =
    "mt-3 inline-flex min-h-10 items-center rounded-lg bg-[var(--teal)] px-3 text-[12px] font-semibold text-white no-underline outline-none hover:bg-[var(--spruce-soft)] focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2";
  link.href = projectHref(project.id);
  link.textContent = "View project timeline";
  article.append(address, confidence, link);
  return article;
}

function applyMarkerSelection(
  markers: ReadonlyMap<string, HTMLButtonElement>,
  selectedId: string | null,
) {
  for (const [areaId, marker] of markers) {
    const selected = areaId === selectedId;
    const wrapper = marker.closest<HTMLElement>("[data-neighbourhood-marker]");
    const label = wrapper?.querySelector<HTMLElement>("[data-neighbourhood-marker-label]");
    marker.setAttribute("aria-pressed", String(selected));
    marker.style.backgroundColor = selected ? "#c8752a" : "#176473";
    marker.style.boxShadow = selected
      ? "0 0 0 4px rgba(255,255,255,0.75), 0 5px 14px rgba(23,48,51,0.32)"
      : "0 5px 14px rgba(23,48,51,0.28)";
    if (wrapper) {
      wrapper.dataset.selected = String(selected);
      wrapper.style.zIndex = selected ? "2" : "1";
    }
    if (label) label.style.opacity = selected ? "1" : "";
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
  projects,
  range,
}: NeighbourhoodActivityMapProps) {
  const periodPhrase =
    range.period === "all"
      ? "all City-dated history"
      : `the last ${range.label.toLocaleLowerCase("en-CA")}`;
  const visibleAreas = useMemo(() => areas.slice(0, 10), [areas]);
  const mappedAreas = useMemo(() => visibleAreas.filter(isMappable), [visibleAreas]);
  const visibleAreaIds = useMemo(
    () => new Set(visibleAreas.map((area) => area.id)),
    [visibleAreas],
  );
  const mappedProjects = useMemo(
    () =>
      projects
        .filter(isMappableProject)
        .filter((project) => visibleAreaIds.has(project.neighbourhoodId)),
    [projects, visibleAreaIds],
  );
  const projectsById = useMemo(
    () => new Map(mappedProjects.map((project) => [project.id, project])),
    [mappedProjects],
  );
  const projectFeatureCollection = useMemo<
    FeatureCollection<Point, { projectId: string; neighbourhoodId: string }>
  >(
    () => ({
      type: "FeatureCollection",
      features: mappedProjects.map((project) => ({
        type: "Feature",
        id: project.id,
        geometry: { type: "Point", coordinates: [project.longitude, project.latitude] },
        properties: { projectId: project.id, neighbourhoodId: project.neighbourhoodId },
      })),
    }),
    [mappedProjects],
  );
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
        const areaProjects = mappedProjects.filter((project) => project.neighbourhoodId === areaId);
        if (areaProjects.length > 1) {
          const west = Math.min(...areaProjects.map((project) => project.longitude));
          const east = Math.max(...areaProjects.map((project) => project.longitude));
          const south = Math.min(...areaProjects.map((project) => project.latitude));
          const north = Math.max(...areaProjects.map((project) => project.latitude));
          const camera = map.cameraForBounds(
            [
              [west, south],
              [east, north],
            ],
            { padding: 72, maxZoom: 15 },
          );
          map.easeTo({
            ...(camera ?? { center: [area.longitude, area.latitude] }),
            zoom: Math.max(camera?.zoom ?? PROJECT_DETAIL_ZOOM, PROJECT_DETAIL_ZOOM),
            duration: reduceMotion ? 0 : 500,
          });
        } else {
          const project = areaProjects[0];
          map.easeTo({
            center: project
              ? [project.longitude, project.latitude]
              : [area.longitude, area.latitude],
            zoom: Math.max(map.getZoom(), project ? 14.5 : PROJECT_DETAIL_ZOOM),
            duration: reduceMotion ? 0 : 450,
          });
        }
      }
    },
    [mappedAreas, mappedProjects],
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
    let popup: MapLibrePopup | null = null;
    let removeNeighbourhoodLabels: (() => void) | null = null;
    const mapMarkers: MapLibreMarker[] = [];
    const projectMapMarkers = new Map<string, MapLibreMarker>();
    const markerElements = new Map<string, HTMLButtonElement>();
    const markerWrappers = new Map<string, HTMLElement>();
    const markerVisuals = new Map<string, HTMLElement>();
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
        popup = new maplibre.Popup({ offset: 14, closeButton: true, focusAfterOpen: false });
        mapInstance.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        mapContainer.dataset.mapProjectCount = String(mappedProjects.length);

        const openProject = (project: MappableActivityProject) => {
          selectArea(project.neighbourhoodId, false);
          if (mapInstance.getLayer(ACTIVITY_PROJECT_LAYER_ID)) {
            mapInstance.setPaintProperty(ACTIVITY_PROJECT_LAYER_ID, "circle-color", [
              "case",
              ["==", ["get", "projectId"], project.id],
              "#c8752a",
              "#176473",
            ]);
          }
          popup
            ?.setLngLat([project.longitude, project.latitude])
            .setDOMContent(projectPopupContent(project))
            .addTo(mapInstance);
        };

        const syncVisibleProjectMarkers = () => {
          const showingProjects = mapInstance.getZoom() >= PROJECT_DETAIL_ZOOM;
          const center = mapInstance.getCenter();
          const bounds = mapInstance.getBounds();
          const visibleProjects = showingProjects
            ? mappedProjects
                .filter((project) => bounds.contains([project.longitude, project.latitude]))
                .sort((left, right) => {
                  const leftDistance =
                    (left.longitude - center.lng) ** 2 + (left.latitude - center.lat) ** 2;
                  const rightDistance =
                    (right.longitude - center.lng) ** 2 + (right.latitude - center.lat) ** 2;
                  return right.confidence - left.confidence || leftDistance - rightDistance;
                })
                .slice(0, MAX_VISIBLE_DOM_PROJECT_MARKERS)
            : [];
          const visibleIds = new Set(visibleProjects.map(({ id }) => id));

          for (const [projectId, marker] of projectMapMarkers) {
            if (visibleIds.has(projectId)) continue;
            marker.remove();
            projectMapMarkers.delete(projectId);
          }

          for (const project of visibleProjects) {
            if (projectMapMarkers.has(project.id)) continue;
            const markerButton = document.createElement("button");
            markerButton.type = "button";
            markerButton.className =
              "size-6 rounded-full border-[3px] border-white bg-[var(--teal)] shadow-[0_3px_10px_rgba(23,48,51,0.34)] outline-none transition-[background-color,box-shadow,transform] hover:scale-110 hover:bg-[var(--copper)] focus-visible:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--spruce)] focus-visible:ring-offset-2";
            markerButton.dataset.overviewProjectMarker = project.id;
            markerButton.setAttribute(
              "aria-label",
              `${project.address}: ${Math.max(0, Math.min(100, Math.round(project.confidence)))}% infill confidence; open project details`,
            );
            markerButton.title = project.address;
            markerButton.addEventListener("click", (event) => {
              event.stopPropagation();
              openProject(project);
            });
            const marker = new maplibre.Marker({ element: markerButton, anchor: "center" })
              .setLngLat([project.longitude, project.latitude])
              .addTo(mapInstance);
            projectMapMarkers.set(project.id, marker);
          }

          mapContainer.dataset.visibleProjectMarkers = String(projectMapMarkers.size);
        };

        const handleStyleLoad = () => {
          if (cancelled || loaded) return;
          try {
            suppressAggregateBasemapLabels(mapInstance);
            mapInstance.addSource(ACTIVITY_PROJECT_SOURCE_ID, {
              type: "geojson",
              data: projectFeatureCollection,
            });
            mapInstance.addLayer({
              id: ACTIVITY_PROJECT_LAYER_ID,
              type: "circle",
              source: ACTIVITY_PROJECT_SOURCE_ID,
              minzoom: PROJECT_DETAIL_ZOOM,
              paint: {
                "circle-color": "#176473",
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  PROJECT_DETAIL_ZOOM,
                  5,
                  15,
                  8,
                ],
                "circle-stroke-width": 2,
                "circle-stroke-color": "#ffffff",
                "circle-opacity": 0.96,
              },
            });

            const bounds = new maplibre.LngLatBounds();
            for (const area of mappedAreas) {
              const markerWrapper = document.createElement("div");
              markerWrapper.className = "group relative grid place-items-center";
              markerWrapper.dataset.neighbourhoodMarker = area.id;

              // MapLibre owns the marker root's opacity and may overwrite it
              // while updating projected positions. Keep the zoom transition on
              // an inner element that remains entirely under app control.
              const markerVisual = document.createElement("div");
              markerVisual.className = "relative grid place-items-center";
              markerVisual.dataset.neighbourhoodMarkerVisual = "";
              markerVisual.style.transition = "opacity 140ms ease";

              const markerButton = document.createElement("button");
              markerButton.type = "button";
              markerButton.className =
                "grid place-items-center rounded-full border-[3px] border-white text-xs font-extrabold text-white transition-[background-color,box-shadow,filter] outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--spruce)] focus-visible:ring-offset-2";
              const diameter = markerDiameter(area.count, maximumCount);
              markerButton.style.width = `${diameter}px`;
              markerButton.style.height = `${diameter}px`;
              markerButton.textContent = String(area.count);
              markerButton.setAttribute(
                "aria-label",
                `${area.name}: ${area.count} ${area.count === 1 ? "project" : "projects"} with qualifying activity in ${periodPhrase}; select to zoom to individual project locations`,
              );
              markerButton.addEventListener("click", (event) => {
                selectArea(area.id, true);
                if (event.detail === 0) {
                  mapContainer.focus({ preventScroll: true });
                }
              });

              const markerLabel = document.createElement("span");
              markerLabel.className =
                "pointer-events-none absolute top-[calc(100%+6px)] max-w-44 whitespace-nowrap rounded-md border border-white/80 bg-white/95 px-2 py-1 text-[11px] font-bold text-[var(--spruce)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";
              markerLabel.dataset.neighbourhoodMarkerLabel = "";
              markerLabel.textContent = area.name;
              markerVisual.append(markerButton, markerLabel);
              markerWrapper.append(markerVisual);

              const marker = new maplibre.Marker({ element: markerWrapper, anchor: "center" })
                .setLngLat([area.longitude, area.latitude])
                .addTo(mapInstance);
              mapMarkers.push(marker);
              markerElements.set(area.id, markerButton);
              markerWrappers.set(area.id, markerWrapper);
              markerVisuals.set(area.id, markerVisual);
              bounds.extend([area.longitude, area.latitude]);
            }

            applyMarkerSelection(markerElements, selectedIdRef.current);
            if (mappedAreas.length === 1) {
              mapInstance.jumpTo({
                center: [mappedAreas[0].longitude, mappedAreas[0].latitude],
                zoom: 11,
              });
            } else if (!bounds.isEmpty()) {
              mapInstance.fitBounds(bounds, { padding: 58, maxZoom: 11, duration: 0 });
            }

            loaded = true;
            handleZoom();
            syncVisibleProjectMarkers();
            setMapState("ready");
            const labelsRequest = loadCurrentEdmontonNeighbourhoods();
            void labelsRequest
              .then((labels) => {
                if (cancelled) return;
                removeNeighbourhoodLabels = addCurrentNeighbourhoodLabelOverlay({
                  map: mapInstance,
                  Marker: maplibre.Marker,
                  labels,
                });
              })
              .catch(() => {
                // The authoritative labels are contextual. Project data and the
                // map remain usable if the City endpoint is temporarily offline.
              });
          } catch {
            if (!cancelled) setMapState("error");
          }
        };

        const handleError = () => {
          if (!loaded && !cancelled) setMapState("error");
        };
        const handleZoom = () => {
          const showingProjects = mapInstance.getZoom() >= PROJECT_DETAIL_ZOOM;
          mapContainer.dataset.mapDetail = showingProjects ? "projects" : "neighbourhoods";
          for (const [areaId, visual] of markerVisuals) {
            visual.style.opacity = showingProjects ? "0" : "1";
            visual.style.pointerEvents = showingProjects ? "none" : "auto";
            visual.setAttribute("aria-hidden", String(showingProjects));
            const wrapper = markerWrappers.get(areaId);
            if (wrapper) wrapper.style.pointerEvents = showingProjects ? "none" : "auto";
            const button = markerElements.get(areaId);
            if (button) button.tabIndex = showingProjects ? -1 : 0;
          }
        };
        const handleProjectClick = (event: MapLayerMouseEvent) => {
          const feature = mapInstance.queryRenderedFeatures(event.point, {
            layers: [ACTIVITY_PROJECT_LAYER_ID],
          })[0];
          const projectId = feature?.properties?.projectId;
          if (typeof projectId !== "string") return;
          const project = projectsById.get(projectId);
          if (!project) return;
          openProject(project);
        };
        const handlePointerEnter = () => {
          mapInstance.getCanvas().style.cursor = "pointer";
        };
        const handlePointerLeave = () => {
          mapInstance.getCanvas().style.cursor = "";
        };

        mapInstance.on("style.load", handleStyleLoad);
        mapInstance.on("error", handleError);
        mapInstance.on("zoom", handleZoom);
        mapInstance.on("moveend", syncVisibleProjectMarkers);
        mapInstance.on("click", ACTIVITY_PROJECT_LAYER_ID, handleProjectClick);
        mapInstance.on("mouseenter", ACTIVITY_PROJECT_LAYER_ID, handlePointerEnter);
        mapInstance.on("mouseleave", ACTIVITY_PROJECT_LAYER_ID, handlePointerLeave);
        if (mapInstance.isStyleLoaded()) handleStyleLoad();
        handleZoom();
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
      removeNeighbourhoodLabels?.();
      popup?.remove();
      for (const marker of mapMarkers) marker.remove();
      for (const marker of projectMapMarkers.values()) marker.remove();
      projectMapMarkers.clear();
      markerElements.clear();
      markerWrappers.clear();
      markerVisuals.clear();
      markerElementsRef.current = new Map();
      map?.remove();
      mapRef.current = null;
    };
  }, [
    mapStyleUrl,
    mapTileUrl,
    mappedAreas,
    mappedProjects,
    maximumCount,
    periodPhrase,
    projectFeatureCollection,
    projectsById,
    selectArea,
  ]);

  const selectedProjectHref = selected
    ? (() => {
        const params = new URLSearchParams({
          neighbourhood: selected.cityId,
          view: "split",
          scope: "core",
        });
        if (range.from) {
          params.set("from", range.from);
        }
        params.set("to", range.through);
        return `/projects?${params.toString()}`;
      })()
    : "/projects";

  const unavailable =
    mapState === "empty" || mapState === "unsupported" || mapState === "error"
      ? unavailableCopy(mapState)
      : null;

  return (
    <Card className="mt-4 overflow-hidden" data-overview-map data-map-state={mapState}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-soft)] px-5 py-4">
        <div>
          <div className="eyebrow">{range.windowLabel} · Core infill area</div>
          <h2 className="m-0 text-base font-bold text-[var(--spruce)]">Project activity map</h2>
          <p className="mt-1 mb-0 text-xs leading-5 text-[var(--muted)]">
            Up to ten leading neighbourhoods inside Anthony Henday and between Yellowhead Trail and
            Whitemud Drive are shown. Select a count bubble or zoom in to reveal individual projects
            at their recorded City coordinates. Neighbourhood labels come from the City&apos;s
            current centroid dataset; aggregate Greater-area labels are omitted.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-[var(--teal-soft)] px-3 py-1.5 text-[11px] font-semibold text-[var(--teal)]">
          <MapPinned size={14} aria-hidden="true" /> {mappedAreas.length} leading mapped areas
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.65fr)]">
        <section className="relative min-h-[380px] border-r border-[var(--border-soft)] bg-[#e8ebe6]">
          <div className="absolute inset-0">
            <div
              ref={mapContainerRef}
              className="h-full w-full"
              role="region"
              tabIndex={-1}
              aria-label="Geographic map of project counts by Edmonton neighbourhood"
              aria-busy={mapState === "loading"}
            />
          </div>

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
                {selected.count === 1 ? "Project" : "Projects"} with a qualifying City permit
                milestone in {periodPhrase}.
              </p>
              <Link
                href={selectedProjectHref}
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
