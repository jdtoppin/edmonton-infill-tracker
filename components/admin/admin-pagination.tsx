import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

function pageHref(
  basePath: string,
  page: number,
  preservedParams: Readonly<Record<string, string | undefined>>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(preservedParams)) {
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function AdminPagination({
  basePath,
  page,
  pageSize,
  total,
  itemLabel,
  preservedParams = {},
}: {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  itemLabel: string;
  preservedParams?: Readonly<Record<string, string | undefined>>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white p-3"
      aria-label={`${itemLabel} pages`}
    >
      <span className="order-1 w-full text-center text-xs text-[var(--muted)] sm:order-2 sm:w-auto">
        {total === 0
          ? `No ${itemLabel.toLowerCase()}`
          : `${first.toLocaleString("en-CA")}–${last.toLocaleString("en-CA")} of ${total.toLocaleString("en-CA")} ${itemLabel.toLowerCase()}`}
      </span>
      {page > 1 ? (
        <Link
          href={pageHref(basePath, page - 1, preservedParams)}
          className="order-2 inline-flex min-h-10 items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] no-underline transition-colors outline-none hover:border-[var(--teal)] hover:bg-[var(--teal-soft)] hover:text-[var(--teal)] focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2 sm:order-1"
        >
          <ChevronLeft size={14} aria-hidden="true" /> Previous
        </Link>
      ) : (
        <span className="order-2 min-h-10 sm:order-1" aria-hidden="true" />
      )}
      {page < totalPages ? (
        <Link
          href={pageHref(basePath, page + 1, preservedParams)}
          className="order-3 inline-flex min-h-10 items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] no-underline transition-colors outline-none hover:border-[var(--teal)] hover:bg-[var(--teal-soft)] hover:text-[var(--teal)] focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2"
        >
          Next <ChevronRight size={14} aria-hidden="true" />
        </Link>
      ) : (
        <span className="order-3 min-h-10" aria-hidden="true" />
      )}
    </nav>
  );
}
