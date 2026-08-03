import Link from "next/link";
import { ArrowDown, ArrowUp, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  formatConstructionValue,
  projectCategoryTone,
  projectFiltersToSearchParams,
  type ProjectFilters,
  type ProjectListItem,
  type ProjectSortField,
} from "@/src/services/project-read-model";

function dateLabel(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric" }).format(
        new Date(`${value}T12:00:00`),
      )
    : "Not recorded";
}

const columns: Array<{ label: string; sort: ProjectSortField; align?: "right" }> = [
  { label: "Address", sort: "address" },
  { label: "Neighbourhood", sort: "neighbourhood" },
  { label: "Category", sort: "category" },
  { label: "Stage", sort: "stage" },
  { label: "Earliest permit", sort: "earliestEventDate" },
  { label: "Latest event", sort: "latestEventDate" },
  { label: "Confidence", sort: "confidence", align: "right" },
  { label: "Units", sort: "units", align: "right" },
  { label: "Value", sort: "value", align: "right" },
  { label: "Review", sort: "reviewStatus" },
];

function sortHref(filters: ProjectFilters, sort: ProjectSortField): string {
  const same = filters.sort === sort;
  const params = projectFiltersToSearchParams({
    ...filters,
    sort,
    direction: same && filters.direction === "desc" ? "asc" : "desc",
    page: 1,
  });
  return `/projects?${params.toString()}`;
}

function ProjectCard({ project }: { project: ProjectListItem }) {
  return (
    <Link
      href={`/projects/${encodeURIComponent(project.id)}`}
      className="block rounded-xl border border-[var(--border)] bg-white p-4 text-inherit no-underline shadow-[0_1px_2px_rgba(20,48,51,0.04)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block text-sm text-[var(--spruce)]">{project.address}</strong>
          <span className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)]">
            <MapPin size={12} /> {project.neighbourhood.name}
          </span>
        </div>
        <Badge tone={project.confidence >= 80 ? "green" : "copper"}>{project.confidence}%</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={projectCategoryTone(project.category)}>{project.categoryLabel}</Badge>
        <Badge>{project.stageLabel}</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt
            className="text-[var(--muted)]"
            title="Earliest dated permit milestone grouped into this project"
          >
            Earliest permit
          </dt>
          <dd className="m-0 mt-1 font-semibold">{dateLabel(project.firstDetectedDate)}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Latest event</dt>
          <dd className="m-0 mt-1 font-semibold">{dateLabel(project.latestEventDate)}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Estimated units</dt>
          <dd className="m-0 mt-1 font-semibold">{project.units ?? "Not reported"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Estimated value</dt>
          <dd className="m-0 mt-1 font-semibold">
            {formatConstructionValue(project.constructionValue)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Review status</dt>
          <dd className="m-0 mt-1 font-semibold">{project.reviewStatusLabel}</dd>
        </div>
      </dl>
    </Link>
  );
}

export function ProjectResults({
  items,
  filters,
}: {
  items: ProjectListItem[];
  filters: ProjectFilters;
}) {
  return (
    <>
      <div className="grid gap-3 md:hidden">
        {items.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1320px] border-collapse text-left text-xs">
          <thead className="border-b border-[var(--border)] bg-[#f8faf8] text-[var(--muted)]">
            <tr>
              {columns.map((column) => {
                const active = filters.sort === column.sort;
                const Icon = filters.direction === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={column.sort}
                    scope="col"
                    className={cn(
                      "px-4 py-3 font-semibold",
                      column.align === "right" && "text-right",
                    )}
                  >
                    <Link
                      href={sortHref(filters, column.sort)}
                      className="inline-flex min-h-8 items-center gap-1 text-inherit no-underline"
                      aria-label={`Sort by ${column.label}${active ? `, currently ${filters.direction}ending` : ""}`}
                      title={
                        column.sort === "earliestEventDate"
                          ? "Earliest dated permit milestone grouped into this project"
                          : undefined
                      }
                    >
                      {column.label}
                      {active && <Icon size={12} aria-hidden="true" />}
                    </Link>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {items.map((project) => (
              <tr key={project.id} className="hover:bg-[#fbfcfa]">
                <td className="px-4 py-4">
                  <Link
                    href={`/projects/${encodeURIComponent(project.id)}`}
                    className="font-bold text-[var(--spruce)] no-underline hover:text-[var(--teal)]"
                  >
                    {project.address}
                  </Link>
                </td>
                <td className="px-4 py-4 font-semibold text-[var(--ink)]">
                  {project.neighbourhood.name}
                </td>
                <td className="px-4 py-4">
                  <Badge tone={projectCategoryTone(project.category)}>
                    {project.categoryLabel}
                  </Badge>
                </td>
                <td className="px-4 py-4">
                  <Badge>{project.stageLabel}</Badge>
                </td>
                <td className="px-4 py-4 font-semibold">{dateLabel(project.firstDetectedDate)}</td>
                <td className="px-4 py-4">
                  <strong className="block text-[var(--ink)]">
                    {project.latestEvent?.permitSubtype ??
                      project.latestEvent?.permitType ??
                      "No event"}
                  </strong>
                  <span className="mt-1 block text-[var(--muted)]">
                    {dateLabel(project.latestEventDate)}
                  </span>
                </td>
                <td className="px-4 py-4 text-right">
                  <Badge tone={project.confidence >= 80 ? "green" : "copper"}>
                    {project.confidence}%
                  </Badge>
                </td>
                <td className="px-4 py-4 text-right font-semibold">{project.units ?? "—"}</td>
                <td className="px-4 py-4 text-right font-semibold">
                  {formatConstructionValue(project.constructionValue)}
                </td>
                <td className="px-4 py-4">
                  <Badge tone={project.reviewStatus === "CONFIRMED" ? "green" : "neutral"}>
                    {project.reviewStatusLabel}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
