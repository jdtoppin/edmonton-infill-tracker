"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CircleCheck,
  Database,
  Hammer,
  MapPinned,
  MapPin,
  Search,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, PreviewBanner } from "@/components/workspace/data-state";
import { PageHeading, WorkspaceTopbar } from "@/components/workspace/page-header";
import type {
  DashboardOverview,
  DashboardPeriod,
  ProjectListItem,
} from "@/src/services/project-read-model";
import { formatConstructionValue } from "@/src/services/project-read-model";

function displayDate(value: string | null, includeTime = false): string {
  if (!value) return "Not recorded";
  const date = new Date(includeTime ? value : `${value}T12:00:00`);
  const timeZone = "America/Edmonton";
  const yearFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone });
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: yearFormatter.format(date) === yearFormatter.format(new Date()) ? undefined : "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone,
  }).format(date);
}

function Confidence({ value }: { value: number }) {
  return (
    <span
      className="inline-flex min-w-12 items-center justify-center rounded-full bg-[#eaf6f0] px-2 py-1 text-xs font-bold text-[#28654c]"
      aria-label={`${value} percent confidence`}
    >
      {value}%
    </span>
  );
}

function ProjectRows({ items, empty }: { items: ProjectListItem[]; empty: string }) {
  if (items.length === 0) {
    return <p className="my-6 text-sm text-[var(--muted)]">{empty}</p>;
  }
  return (
    <div className="divide-y divide-[var(--border)]">
      {items.map((project) => (
        <Link
          href={`/projects/${encodeURIComponent(project.id)}`}
          key={project.id}
          className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-inherit no-underline transition-colors hover:bg-[#fbfcfa]"
        >
          <div className="min-w-0">
            <strong className="block truncate text-sm text-[var(--spruce)]">
              {project.address}
            </strong>
            <span className="mt-1 flex items-center gap-1 truncate text-xs text-[var(--muted)]">
              <MapPin size={12} aria-hidden="true" /> {project.neighbourhood.name} ·{" "}
              {project.stageLabel}
            </span>
          </div>
          <Confidence value={project.confidence} />
        </Link>
      ))}
    </div>
  );
}

const OVERVIEW_MAP_BOUNDS = {
  west: -113.72,
  east: -113.27,
  north: 53.72,
  south: 53.38,
} as const;

type ActivityArea = DashboardOverview["neighbourhoodBreakdown"][number];

function mapPosition(area: ActivityArea): { left: number; top: number } | null {
  if (area.latitude === null || area.longitude === null) return null;
  const left =
    ((area.longitude - OVERVIEW_MAP_BOUNDS.west) /
      (OVERVIEW_MAP_BOUNDS.east - OVERVIEW_MAP_BOUNDS.west)) *
    100;
  const top =
    ((OVERVIEW_MAP_BOUNDS.north - area.latitude) /
      (OVERVIEW_MAP_BOUNDS.north - OVERVIEW_MAP_BOUNDS.south)) *
    100;
  return {
    left: Math.min(95, Math.max(5, left)),
    top: Math.min(94, Math.max(6, top)),
  };
}

function OverviewActivityMap({ areas }: { areas: ActivityArea[] }) {
  const visibleAreas = areas.slice(0, 10);
  const mappedAreas = visibleAreas.flatMap((area) => {
    const position = mapPosition(area);
    return position ? [{ area, position }] : [];
  });
  const [selectedId, setSelectedId] = useState<string | null>(
    mappedAreas[0]?.area.id ?? visibleAreas[0]?.id ?? null,
  );
  const selected = visibleAreas.find((area) => area.id === selectedId) ?? visibleAreas[0] ?? null;
  const maxCount = Math.max(1, ...visibleAreas.map((area) => area.count));

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-soft)] px-5 py-4">
        <div>
          <div className="eyebrow">Citywide distribution</div>
          <h2 className="m-0 text-base font-bold text-[var(--spruce)]">Project activity map</h2>
          <p className="mt-1 mb-0 text-xs leading-5 text-[var(--muted)]">
            Circles show active project counts at the average location of each leading
            neighbourhood.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-[var(--teal-soft)] px-3 py-1.5 text-[11px] font-semibold text-[var(--teal)]">
          <MapPinned size={14} aria-hidden="true" /> {mappedAreas.length} mapped areas
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.65fr)]">
        <section
          className="map-grid relative min-h-[380px] border-r border-[var(--border-soft)]"
          aria-label="Schematic map of project counts by Edmonton neighbourhood"
        >
          <div className="river river-one" aria-hidden="true" />
          <div className="river river-two" aria-hidden="true" />
          <div className="road road-a" aria-hidden="true" />
          <div className="road road-b" aria-hidden="true" />
          <div className="road road-c" aria-hidden="true" />
          <span className="map-label downtown" aria-hidden="true">
            Downtown
          </span>
          <span className="map-label strathcona" aria-hidden="true">
            Strathcona
          </span>
          <span className="map-label university" aria-hidden="true">
            University
          </span>

          {mappedAreas.map(({ area, position }) => {
            const selectedArea = area.id === selected?.id;
            const diameter = 40 + Math.round((area.count / maxCount) * 22);
            return (
              <button
                key={area.id}
                type="button"
                className={`absolute z-10 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-white text-xs font-extrabold text-white shadow-[0_5px_14px_rgba(23,48,51,0.28)] transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--spruce)] focus-visible:ring-offset-2 ${
                  selectedArea ? "bg-[var(--copper)] ring-4 ring-white/70" : "bg-[var(--teal)]"
                }`}
                style={{
                  left: `${position.left}%`,
                  top: `${position.top}%`,
                  width: diameter,
                  height: diameter,
                }}
                aria-label={`${area.name}: ${area.count} active ${area.count === 1 ? "project" : "projects"}`}
                aria-pressed={selectedArea}
                onClick={() => setSelectedId(area.id)}
              >
                {area.count}
              </button>
            );
          })}

          {mappedAreas.length === 0 && (
            <div className="absolute inset-0 grid place-items-center p-8 text-center">
              <p className="max-w-sm text-sm leading-6 text-[var(--muted)]">
                Neighbourhood totals are available, but their project coordinates have not been
                recorded yet.
              </p>
            </div>
          )}

          <div className="map-legend" aria-hidden="true">
            <span /> <strong>Project count</strong>
            <span /> <strong>Selected</strong>
          </div>
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
                    onClick={() => setSelectedId(area.id)}
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

export function OverviewDashboard({ data }: { data: DashboardOverview }) {
  const [period, setPeriod] = useState<DashboardPeriod>(7);
  const lifecycle = data.lifecycle[period];
  const maxNeighbourhood = Math.max(1, ...data.neighbourhoodBreakdown.map((item) => item.count));
  const maxCategory = Math.max(1, ...data.categoryBreakdown.map((item) => item.count));
  const latestSync = data.latestImport?.completedAt ?? data.generatedAt;

  return (
    <>
      <WorkspaceTopbar
        status={
          <span className="sync-state">
            <span />{" "}
            {data.dataMode === "live"
              ? `Data checked ${displayDate(latestSync, true)}`
              : "Demonstration data"}
          </span>
        }
      />
      <main className="content">
        {data.dataMode === "preview" && <PreviewBanner />}
        <PageHeading
          eyebrow={`Overview · ${displayDate(data.generatedAt, true)}`}
          title="Follow infill from first permit to occupancy."
          description="Live City-recorded permit milestones are grouped into projects and ranked by the strength of their evidence."
          actions={
            <Link
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--teal)] px-4 text-xs font-semibold text-white no-underline shadow-sm transition-[background-color,box-shadow,transform] outline-none hover:-translate-y-px hover:bg-[var(--spruce-soft)] hover:shadow-md focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2"
              href="/projects"
            >
              <Search size={15} aria-hidden="true" /> Explore projects
            </Link>
          }
        />

        <div className="period-control" role="group" aria-label="Reporting period">
          {([7, 30, 90] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={period === value ? "active" : ""}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {value} days
            </button>
          ))}
        </div>

        <section className="grid gap-4 lg:grid-cols-4" aria-label={`Past ${period} day summary`}>
          <Card className="p-5 lg:row-span-1">
            <div className="mb-5 grid size-10 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]">
              <TrendingUp size={19} aria-hidden="true" />
            </div>
            <div className="text-xs font-semibold text-[var(--muted)]">New projects detected</div>
            <strong className="mt-2 block text-4xl tracking-[-0.04em] text-[var(--spruce)]">
              {data.newProjects[period]}
            </strong>
            <p className="mb-0 text-xs leading-5 text-[var(--muted)]">
              First grouped by the tracker in the past {period} days.
            </p>
          </Card>
          {[
            {
              label: "Development permits",
              value: lifecycle.development,
              icon: MapPin,
              tone: "bg-[#e8f2f1] text-[var(--teal)]",
            },
            {
              label: "Building permits",
              value: lifecycle.building,
              icon: Building2,
              tone: "bg-[#fff1df] text-[var(--copper)]",
            },
            {
              label: "Occupancy reported",
              value: lifecycle.occupancy,
              icon: CircleCheck,
              tone: "bg-[#eaf6f0] text-[var(--positive)]",
            },
          ].map(({ label, value, icon: Icon, tone }) => (
            <Card className="p-5" key={label}>
              <div className={`mb-5 grid size-10 place-items-center rounded-lg ${tone}`}>
                <Icon size={19} aria-hidden="true" />
              </div>
              <div className="text-xs font-semibold text-[var(--muted)]">{label}</div>
              <strong className="mt-2 block text-4xl tracking-[-0.04em] text-[var(--spruce)]">
                {value}
              </strong>
              <p className="mb-0 text-xs leading-5 text-[var(--muted)]">
                City-recorded milestones linked to tracked infill projects.
              </p>
            </Card>
          ))}
        </section>

        <OverviewActivityMap areas={data.neighbourhoodBreakdown} />

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="p-5">
            <div className="section-head">
              <div>
                <div className="eyebrow">Evidence ranked</div>
                <h2>High-confidence projects</h2>
              </div>
              <Link
                href="/projects?minConfidence=80"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--teal)] no-underline"
              >
                View all <ArrowRight size={14} />
              </Link>
            </div>
            <ProjectRows
              items={data.highConfidenceProjects}
              empty="No projects currently meet the high-confidence threshold."
            />
          </Card>

          <Card className="p-5">
            <div className="section-head">
              <div>
                <div className="eyebrow">All active projects</div>
                <h2>Neighbourhood activity</h2>
              </div>
            </div>
            {data.neighbourhoodBreakdown.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Neighbourhood totals will appear after projects are grouped.
              </p>
            ) : (
              <div className="space-y-4">
                {data.neighbourhoodBreakdown.slice(0, 6).map((area) => (
                  <Link
                    key={area.id}
                    href={`/projects?neighbourhood=${encodeURIComponent(area.cityId)}`}
                    className="block text-inherit no-underline"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                      <strong className="text-[var(--spruce)]">{area.name}</strong>
                      <span className="text-[var(--muted)]">{area.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#e9edeb]">
                      <span
                        className="block h-full rounded-full bg-[var(--teal)]"
                        style={{ width: `${Math.max(4, (area.count / maxNeighbourhood) * 100)}%` }}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <Card className="p-5">
            <div className="section-head">
              <div>
                <div className="eyebrow">Portfolio mix</div>
                <h2>Project categories</h2>
              </div>
            </div>
            <div className="space-y-3">
              {data.categoryBreakdown.slice(0, 7).map((category) => (
                <div key={category.category}>
                  <div className="mb-1 flex justify-between gap-3 text-xs">
                    <span>{category.label}</span>
                    <strong>{category.count}</strong>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#e9edeb]">
                    <span
                      className="block h-full rounded-full bg-[var(--copper)]"
                      style={{ width: `${Math.max(4, (category.count / maxCategory) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="section-head">
              <div>
                <div className="eyebrow">Recent signal</div>
                <h2>Demolition activity</h2>
              </div>
              <Hammer size={17} className="text-[var(--copper)]" />
            </div>
            <ProjectRows
              items={data.recentDemolitions.slice(0, 4)}
              empty="No recent demolition signals were found."
            />
          </Card>

          <Card className="p-5">
            <div className="section-head">
              <div>
                <div className="eyebrow">Recent signal</div>
                <h2>Construction activity</h2>
              </div>
              <Building2 size={17} className="text-[var(--teal)]" />
            </div>
            <ProjectRows
              items={data.recentConstruction.slice(0, 4)}
              empty="No recent construction signals were found."
            />
          </Card>
        </div>

        <section
          className="mt-4 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]"
          aria-label="Data operations"
        >
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]">
                <Database size={18} />
              </div>
              <div>
                <div className="eyebrow">Latest City import</div>
                {data.latestImport ? (
                  <>
                    <h2 className="mt-1 mb-1 text-lg font-bold text-[var(--spruce)]">
                      {data.latestImport.statusLabel}
                    </h2>
                    <p className="m-0 text-xs leading-5 text-[var(--muted)]">
                      {data.latestImport.created} created · {data.latestImport.updated} updated ·{" "}
                      {data.latestImport.skipped} unchanged · {data.latestImport.failed} failed
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    No completed import is recorded yet.
                  </p>
                )}
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="section-head">
              <div>
                <div className="eyebrow">Data quality</div>
                <h2>Warnings and follow-up</h2>
              </div>
              <AlertTriangle size={17} className="text-[var(--copper)]" />
            </div>
            {data.warnings.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-[var(--positive)]">
                <CircleCheck size={17} /> No current read-model warnings.
              </div>
            ) : (
              <ul className="m-0 space-y-2 p-0">
                {data.warnings.map((warning) => (
                  <li
                    key={warning.code}
                    className="flex items-start justify-between gap-3 rounded-lg bg-[#faf8f3] px-3 py-2 text-xs text-[var(--ink)]"
                  >
                    <span>{warning.message}</span>
                    {warning.count !== null && (
                      <Badge tone={warning.severity === "error" ? "copper" : "neutral"}>
                        {warning.count}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        {data.highConfidenceProjects.length === 0 && data.categoryBreakdown.length === 0 && (
          <div className="mt-4">
            <EmptyState
              title="No projects are available yet"
              description="The importer can be healthy before the first permit pipeline has finished. An administrator can check imports and queue a historical backfill."
            />
          </div>
        )}
        <p className="mt-5 text-xs leading-5 text-[var(--muted)]">
          Occupancy is reported from City permit data. It indicates a recorded project milestone;
          Infill Tracker does not independently certify safety, habitability, or permitted use.
          Values such as {formatConstructionValue(null)} remain visibly unreported rather than
          inferred.
        </p>
      </main>
    </>
  );
}
