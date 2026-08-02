import Link from "next/link";
import { Filter, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectFilterOptions, ProjectFilters } from "@/src/services/project-read-model";

const fieldClass =
  "mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal-soft)]";

export function ProjectFiltersForm({
  filters,
  options,
}: {
  filters: ProjectFilters;
  options: ProjectFilterOptions;
}) {
  const hasFilters = Boolean(
    filters.q ||
    filters.neighbourhoods.length ||
    filters.categories.length ||
    filters.stages.length ||
    filters.from ||
    filters.to ||
    filters.minConfidence !== undefined ||
    filters.minValue !== undefined ||
    filters.maxValue !== undefined ||
    filters.minUnits !== undefined ||
    filters.maxUnits !== undefined,
  );

  return (
    <form
      action="/projects"
      method="get"
      className="rounded-xl border border-[var(--border)] bg-white p-4"
    >
      <input type="hidden" name="view" value={filters.view} />
      <input type="hidden" name="sort" value={filters.sort} />
      <input type="hidden" name="direction" value={filters.direction} />
      <input type="hidden" name="pageSize" value={filters.pageSize} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-semibold text-[var(--ink)] md:col-span-2 xl:col-span-1">
          Address or permit
          <span className="relative mt-1 block">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--muted)]"
              size={16}
              aria-hidden="true"
            />
            <input
              name="q"
              defaultValue={filters.q}
              maxLength={200}
              className={`${fieldClass} mt-0 pl-9`}
              placeholder="10524 75 Avenue or permit #"
            />
          </span>
        </label>
        <label className="text-xs font-semibold text-[var(--ink)]">
          Neighbourhood
          <select
            name="neighbourhood"
            defaultValue={filters.neighbourhoods[0] ?? ""}
            className={fieldClass}
          >
            <option value="">All neighbourhoods</option>
            {options.neighbourhoods.map((option) => (
              <option key={option.cityId} value={option.cityId}>
                {option.name} ({option.projectCount})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-[var(--ink)]">
          Category
          <select name="category" defaultValue={filters.categories[0] ?? ""} className={fieldClass}>
            <option value="">All categories</option>
            {options.categories
              .filter((option) => option.projectCount > 0)
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.projectCount})
                </option>
              ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-[var(--ink)]">
          Stage
          <select name="stage" defaultValue={filters.stages[0] ?? ""} className={fieldClass}>
            <option value="">All stages</option>
            {options.stages
              .filter((option) => option.projectCount > 0)
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.projectCount})
                </option>
              ))}
          </select>
        </label>
      </div>

      <details
        className="mt-3 rounded-lg border border-[var(--border)] bg-[#fbfcfa] px-4 py-3"
        open={Boolean(
          filters.from ||
          filters.to ||
          filters.minConfidence !== undefined ||
          filters.minValue !== undefined ||
          filters.maxValue !== undefined ||
          filters.minUnits !== undefined ||
          filters.maxUnits !== undefined,
        )}
      >
        <summary className="cursor-pointer text-xs font-bold text-[var(--teal)]">
          Date, confidence, value, and unit filters
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-semibold">
            Activity from
            <input name="from" type="date" defaultValue={filters.from} className={fieldClass} />
          </label>
          <label className="text-xs font-semibold">
            Activity to
            <input name="to" type="date" defaultValue={filters.to} className={fieldClass} />
          </label>
          <label className="text-xs font-semibold">
            Minimum confidence
            <input
              name="minConfidence"
              type="number"
              min={0}
              max={100}
              defaultValue={filters.minConfidence}
              placeholder="0–100"
              className={fieldClass}
            />
          </label>
          <label className="text-xs font-semibold">
            Minimum value (CAD)
            <input
              name="minValue"
              type="number"
              min={0}
              step={1000}
              defaultValue={filters.minValue}
              className={fieldClass}
            />
          </label>
          <label className="text-xs font-semibold">
            Maximum value (CAD)
            <input
              name="maxValue"
              type="number"
              min={0}
              step={1000}
              defaultValue={filters.maxValue}
              className={fieldClass}
            />
          </label>
          <label className="text-xs font-semibold">
            Minimum units
            <input
              name="minUnits"
              type="number"
              min={-100000}
              max={100000}
              defaultValue={filters.minUnits}
              className={fieldClass}
            />
          </label>
          <label className="text-xs font-semibold">
            Maximum units
            <input
              name="maxUnits"
              type="number"
              min={-100000}
              max={100000}
              defaultValue={filters.maxUnits}
              className={fieldClass}
            />
          </label>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="submit">
          <Filter size={15} aria-hidden="true" /> Apply filters
        </Button>
        {hasFilters && (
          <Link
            href={`/projects?view=${filters.view}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-[var(--muted)] no-underline hover:bg-black/5"
          >
            <RotateCcw size={15} aria-hidden="true" /> Reset
          </Link>
        )}
      </div>
    </form>
  );
}
