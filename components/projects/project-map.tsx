"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LocateFixed, MapPinned, MapPinOff, TriangleAlert } from "lucide-react";
import type { Map as MapboxMap, Marker as MapboxMarker, Popup as MapboxPopup } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const EDMONTON_CENTER: [longitude: number, latitude: number] = [-113.4938, 53.5461];
const DEFAULT_MAP_STYLE = "mapbox://styles/mapbox/streets-v12";

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
  className?: string;
};

type MapStatus =
  "loading" | "ready" | "token-missing" | "coordinates-missing" | "unsupported" | "error";

type MappableProject = ProjectMapMarker & { latitude: number; longitude: number };

type MarkerEntry = {
  button: HTMLButtonElement;
  marker: MapboxMarker;
  popup: MapboxPopup;
  project: MappableProject;
  handleClick: () => void;
};

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

function setMarkerButtonState(button: HTMLButtonElement, selected: boolean) {
  button.setAttribute("aria-pressed", String(selected));
  button.style.backgroundColor = selected ? "#c8752a" : "#176473";
  button.style.boxShadow = selected
    ? "0 0 0 5px rgba(255,255,255,0.78), 0 8px 18px rgba(23,48,51,0.34)"
    : "0 4px 12px rgba(23,48,51,0.28)";
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
    "mt-3 inline-flex min-h-10 items-center rounded-lg bg-[var(--spruce)] px-3 text-[12px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2";
  link.href = projectHref(project.id);
  link.textContent = "View project timeline";
  article.append(link);

  return article;
}

function fallbackCopy(status: Exclude<MapStatus, "loading" | "ready">) {
  switch (status) {
    case "token-missing":
      return {
        icon: MapPinOff,
        title: "Map is not configured",
        detail: "The project list remains available while the public map token is unavailable.",
      };
    case "coordinates-missing":
      return {
        icon: MapPinOff,
        title: "No mapped projects",
        detail: "None of the projects in these results currently has usable map coordinates.",
      };
    case "unsupported":
      return {
        icon: MapPinOff,
        title: "Interactive map unavailable",
        detail: "This browser does not support the graphics required for the map. Use the list.",
      };
    case "error":
      return {
        icon: TriangleAlert,
        title: "Map could not be loaded",
        detail: "The project list is still available. Reload the page to try the map again.",
      };
  }
}

export function ProjectMap({
  markers,
  mapboxToken,
  mapStyleUrl,
  initialSelectedId,
  className,
}: ProjectMapProps) {
  const mappableProjects = useMemo(() => markers.filter(isMappable), [markers]);
  const initialSelection =
    markers.find((project) => project.id === initialSelectedId)?.id ??
    mappableProjects[0]?.id ??
    markers[0]?.id ??
    null;
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection);
  const [runtimeStatus, setRuntimeStatus] = useState<MapStatus>("loading");
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerEntriesRef = useRef(new Map<string, MarkerEntry>());
  const listItemsRef = useRef(new Map<string, HTMLLIElement>());
  const configuredToken = mapboxToken?.trim() ?? "";
  const prerequisiteStatus: MapStatus | null = !configuredToken
    ? "token-missing"
    : mappableProjects.length === 0
      ? "coordinates-missing"
      : null;
  const status = prerequisiteStatus ?? runtimeStatus;
  const effectiveSelectedId =
    selectedId && markers.some((project) => project.id === selectedId)
      ? selectedId
      : (mappableProjects[0]?.id ?? markers[0]?.id ?? null);

  const selectProject = useCallback(
    (projectId: string, moveMap: boolean, revealInList: boolean) => {
      setSelectedId(projectId);
      for (const [candidateId, candidate] of markerEntriesRef.current) {
        setMarkerButtonState(candidate.button, candidateId === projectId);
      }
      const entry = markerEntriesRef.current.get(projectId);
      const map = mapRef.current;

      if (entry && map) {
        for (const candidate of markerEntriesRef.current.values()) {
          if (candidate.project.id !== projectId) candidate.popup.remove();
        }

        if (moveMap) {
          const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          map.easeTo({
            center: [entry.project.longitude, entry.project.latitude],
            zoom: Math.max(map.getZoom(), 13),
            duration: reduceMotion ? 0 : 450,
          });
        }
        entry.popup.addTo(map);
      }

      if (revealInList) {
        window.requestAnimationFrame(() => {
          listItemsRef.current.get(projectId)?.scrollIntoView({ block: "nearest" });
        });
      }
    },
    [],
  );

  useEffect(() => {
    const container = mapContainerRef.current;

    if (prerequisiteStatus || !container || typeof window === "undefined") return;
    const mapContainer: HTMLDivElement = container;

    let cancelled = false;
    let map: MapboxMap | null = null;
    const entries = markerEntriesRef.current;
    const mapInitialSelection =
      mappableProjects.find((project) => project.id === initialSelectedId)?.id ??
      mappableProjects[0]?.id ??
      null;

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
        map = mapInstance;
        mapRef.current = mapInstance;
        mapInstance.addControl(new mapbox.NavigationControl({ showCompass: false }), "top-right");

        let loaded = false;
        const handleLoad = () => {
          loaded = true;
          if (!cancelled) setRuntimeStatus("ready");
        };
        const handleError = () => {
          if (!loaded && !cancelled) setRuntimeStatus("error");
        };
        mapInstance.on("load", handleLoad);
        mapInstance.on("error", handleError);

        const bounds = new mapbox.LngLatBounds();
        for (const project of mappableProjects) {
          const score = confidenceValue(project.confidence);
          const button = document.createElement("button");
          button.type = "button";
          button.className =
            "grid size-11 place-items-center rounded-full border-[3px] border-white text-[11px] font-extrabold text-white outline-none transition-[background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-[var(--spruce)] focus-visible:ring-offset-2";
          button.textContent = String(score);
          button.setAttribute(
            "aria-label",
            `Select ${project.address}, ${score} percent confidence`,
          );
          setMarkerButtonState(button, project.id === mapInitialSelection);

          const popup = new mapbox.Popup({ offset: 28, closeButton: true }).setDOMContent(
            popupContent(project),
          );
          const marker = new mapbox.Marker({ element: button, anchor: "bottom" })
            .setLngLat([project.longitude, project.latitude])
            .addTo(mapInstance);
          const handleClick = () => selectProject(project.id, false, true);
          button.addEventListener("click", handleClick);
          entries.set(project.id, {
            button,
            marker,
            popup,
            project,
            handleClick,
          });
          bounds.extend([project.longitude, project.latitude]);
        }

        if (mappableProjects.length === 1) {
          mapInstance.jumpTo({
            center: [mappableProjects[0].longitude, mappableProjects[0].latitude],
            zoom: 13,
          });
        } else {
          mapInstance.fitBounds(bounds, { padding: 54, maxZoom: 14, duration: 0 });
        }

        if (mapInitialSelection) {
          const selectedEntry = entries.get(mapInitialSelection);
          if (selectedEntry) selectedEntry.popup.addTo(mapInstance);
        }
      } catch {
        if (!cancelled) setRuntimeStatus("error");
      }
    }

    void initializeMap();

    return () => {
      cancelled = true;
      for (const entry of entries.values()) {
        entry.button.removeEventListener("click", entry.handleClick);
        entry.popup.remove();
        entry.marker.remove();
      }
      entries.clear();
      map?.remove();
      mapRef.current = null;
    };
  }, [
    configuredToken,
    initialSelectedId,
    mapStyleUrl,
    mappableProjects,
    prerequisiteStatus,
    selectProject,
  ]);

  const fallback = status === "loading" || status === "ready" ? null : fallbackCopy(status);

  return (
    <Card
      className={cn(
        "grid min-h-[430px] overflow-hidden lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.65fr)]",
        className,
      )}
    >
      <section className="relative min-h-[340px] bg-[#e8ebe6] lg:min-h-[430px]">
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

        {fallback && (
          <div className="absolute inset-0 grid place-items-center bg-[#e8ebe6] p-7 text-center">
            <div className="max-w-sm" role="status">
              <fallback.icon
                className="mx-auto mb-3 text-[var(--teal)]"
                size={30}
                aria-hidden="true"
              />
              <h2 className="m-0 text-base font-bold text-[var(--spruce)]">{fallback.title}</h2>
              <p className="mt-2 mb-0 text-xs leading-5 text-[var(--muted)]">{fallback.detail}</p>
            </div>
          </div>
        )}
      </section>

      <section
        className="flex min-h-0 flex-col border-t border-[var(--border-soft)] bg-white lg:border-t-0 lg:border-l"
        aria-labelledby="mapped-projects-title"
      >
        <div className="border-b border-[var(--border-soft)] px-4 py-4">
          <div className="flex items-center gap-2 text-[var(--teal)]">
            <MapPinned size={17} aria-hidden="true" />
            <h2 id="mapped-projects-title" className="m-0 text-sm font-bold text-[var(--spruce)]">
              Projects in view
            </h2>
          </div>
          <p className="mt-1 mb-0 text-xs text-[var(--muted)]">
            {markers.length} {markers.length === 1 ? "project" : "projects"}
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
          <ol className="m-0 flex-1 list-none overflow-y-auto p-2" aria-label="Mapped projects">
            {markers.map((project) => {
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
                        className="block truncate text-xs font-bold text-[var(--spruce)] outline-none hover:text-[var(--teal)] focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2"
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
                    <span className="font-semibold text-[var(--ink)]">{project.categoryLabel}</span>
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
          </ol>
        )}
      </section>
    </Card>
  );
}
