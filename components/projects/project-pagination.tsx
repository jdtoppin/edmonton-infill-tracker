import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  projectFiltersToSearchParams,
  type ProjectFilters,
} from "@/src/services/project-read-model";

function pageHref(filters: ProjectFilters, page: number) {
  const params = projectFiltersToSearchParams({ ...filters, page });
  return `/projects?${params.toString()}`;
}

export function ProjectPagination({
  filters,
  totalPages,
  total,
}: {
  filters: ProjectFilters;
  totalPages: number;
  total: number;
}) {
  if (totalPages <= 1)
    return (
      <p className="mt-4 text-xs text-[var(--muted)]">
        {total} {total === 1 ? "project" : "projects"}
      </p>
    );
  return (
    <nav
      className="mt-4 flex items-center justify-between gap-3"
      aria-label="Project results pages"
    >
      {filters.page > 1 ? (
        <Link
          href={pageHref(filters, filters.page - 1)}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] no-underline"
        >
          <ChevronLeft size={14} /> Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-xs text-[var(--muted)]">
        Page {filters.page} of {totalPages} · {total.toLocaleString("en-CA")} projects
      </span>
      {filters.page < totalPages ? (
        <Link
          href={pageHref(filters, filters.page + 1)}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] no-underline"
        >
          Next <ChevronRight size={14} />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
