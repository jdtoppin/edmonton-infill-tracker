import type { Metadata } from "next";
import Link from "next/link";
import { Download, SlidersHorizontal } from "lucide-react";
import { ProjectFiltersForm } from "@/components/projects/project-filters";
import { ProjectMap, type ProjectMapMarker } from "@/components/projects/project-map";
import { ProjectPagination } from "@/components/projects/project-pagination";
import { ProjectResults } from "@/components/projects/project-results";
import { ProjectViewSwitcher } from "@/components/projects/project-view-switcher";
import { EmptyState, PreviewBanner, WarningNotice } from "@/components/workspace/data-state";
import { PageHeading, WorkspaceTopbar } from "@/components/workspace/page-header";
import { requireUser } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";
import {
  defaultProjectFilters,
  formatConstructionValue,
  getPreviewFilterOptions,
  getPreviewProjectMarkers,
  getPreviewProjectPage,
  getProjectFilterOptions,
  listProjectMarkers,
  listProjects,
  projectFiltersToSearchParams,
  safeParseProjectFilters,
  type ProjectFilters,
  type ProjectSearchParams,
} from "@/src/services/project-read-model";

export const metadata: Metadata = { title: "Explore projects" };
export const dynamic = "force-dynamic";

function mapMarkers(
  markers: Awaited<ReturnType<typeof listProjectMarkers>>["markers"],
): ProjectMapMarker[] {
  return markers.map((project) => ({
    id: project.id,
    address: project.address,
    neighbourhood: project.neighbourhood.name,
    categoryLabel: project.categoryLabel,
    stageLabel: project.stageLabel,
    confidence: project.confidence,
    latestEventLabel: project.latestEvent?.permitSubtype ?? project.latestEvent?.permitType ?? null,
    latestEventDate: project.latestEventDate,
    constructionValue:
      project.constructionValue === null
        ? null
        : formatConstructionValue(project.constructionValue),
    estimatedUnits: project.units,
    latitude: project.latitude,
    longitude: project.longitude,
  }));
}

function exportHref(filters: ProjectFilters): string {
  const params = projectFiltersToSearchParams({ ...filters, page: 1 });
  return `/api/projects/export?${params.toString()}`;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<ProjectSearchParams>;
}) {
  const incoming = await searchParams;
  const parsed = safeParseProjectFilters(incoming);
  const filters = parsed.success ? parsed.data : defaultProjectFilters();
  const needsMap = filters.view !== "list";
  const preview = !process.env.DATABASE_URL && process.env.AUTH_REQUIRED !== "true";
  if (!preview && process.env.AUTH_REQUIRED === "true") await requireUser("/projects");

  const [page, markerResult, options] = preview
    ? [
        getPreviewProjectPage(filters),
        needsMap
          ? getPreviewProjectMarkers(filters)
          : {
              dataMode: "preview" as const,
              markers: [],
              truncated: false,
              missingCoordinateCount: 0,
            },
        getPreviewFilterOptions(),
      ]
    : await (async () => {
        const db = await getDb();
        return Promise.all([
          listProjects(db, filters),
          needsMap
            ? listProjectMarkers(db, filters)
            : Promise.resolve({
                dataMode: "live" as const,
                markers: [],
                truncated: false,
                missingCoordinateCount: 0,
              }),
          getProjectFilterOptions(db),
        ]);
      })();
  const markers = mapMarkers(markerResult.markers);

  return (
    <>
      <WorkspaceTopbar
        status={
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
            <SlidersHorizontal size={15} aria-hidden="true" /> {page.total.toLocaleString("en-CA")}{" "}
            matching projects
          </span>
        }
      />
      <main className="content">
        {preview && <PreviewBanner />}
        <PageHeading
          eyebrow="Project explorer"
          title="Find infill signals across Edmonton."
          description="Filter live project evidence by place, stage, timing, confidence, value, and estimated units. Every result links back to its permit timeline."
          actions={
            <a
              href={exportHref(filters)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 text-xs font-semibold text-[var(--ink)] no-underline transition-[background-color,border-color,color,box-shadow] outline-none hover:border-[#9dc2c7] hover:bg-[var(--teal-soft)] hover:text-[var(--teal)] focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2"
            >
              <Download size={15} aria-hidden="true" /> Export filtered CSV
            </a>
          }
        />

        <div className="mt-7 space-y-4">
          {!parsed.success && (
            <WarningNotice>
              <strong className="block text-[var(--spruce)]">Some filters were not valid.</strong>
              <span>
                Safe defaults are shown. Apply the filters again using the controls below.
              </span>
            </WarningNotice>
          )}
          <ProjectFiltersForm filters={filters} options={options} />
        </div>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">Filtered results</div>
            <h2 className="mt-1 mb-0 text-xl font-bold text-[var(--spruce)]">
              {page.total.toLocaleString("en-CA")} {page.total === 1 ? "project" : "projects"}
            </h2>
            <p className="mt-1 mb-0 text-xs text-[var(--muted)]">
              Earliest permit means the first dated City permit milestone grouped into a project.
            </p>
          </div>
          <ProjectViewSwitcher filters={filters} />
        </div>

        {needsMap && markerResult.truncated && (
          <p className="mt-3 rounded-lg bg-[#fff7ec] px-3 py-2 text-xs text-[#70491f]">
            The map is showing the first 2,000 locations. Narrow the filters for a complete map.
          </p>
        )}
        {needsMap && markerResult.missingCoordinateCount > 0 && (
          <p className="mt-3 text-xs text-[var(--muted)]">
            {markerResult.missingCoordinateCount.toLocaleString("en-CA")} matching projects do not
            have map coordinates but remain available in List view.
          </p>
        )}

        {page.items.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              filtered
              title="No projects match these filters"
              description="Try widening the date or confidence range, or reset the filters to return to all active projects."
              action={
                <Link
                  href="/projects"
                  className="inline-flex min-h-10 items-center rounded-lg bg-[var(--spruce)] px-4 text-sm font-semibold text-white no-underline"
                >
                  Reset filters
                </Link>
              }
            />
          </div>
        ) : (
          <div className="mt-5">
            {filters.view === "list" && <ProjectResults items={page.items} filters={filters} />}
            {filters.view === "map" && (
              <ProjectMap
                markers={markers}
                mapStyleUrl={process.env.MAP_STYLE_URL}
                mapTileUrl={process.env.MAP_TILE_URL}
                accessibleListHref={`/projects?${projectFiltersToSearchParams({
                  ...filters,
                  view: "list",
                  page: 1,
                }).toString()}`}
                showList={false}
              />
            )}
            {filters.view === "split" && (
              <ProjectMap
                markers={markers}
                mapStyleUrl={process.env.MAP_STYLE_URL}
                mapTileUrl={process.env.MAP_TILE_URL}
                showList
              />
            )}
            {filters.view === "list" && (
              <ProjectPagination
                filters={filters}
                totalPages={page.totalPages}
                total={page.total}
              />
            )}
          </div>
        )}
      </main>
    </>
  );
}
