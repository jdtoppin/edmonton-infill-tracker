"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Activity, RotateCcw, TriangleAlert } from "lucide-react";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("workspace.route.failed", { digest: error.digest });
  }, [error]);
  return (
    <main className="content grid min-h-[70vh] place-items-center">
      <section className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-white p-8 shadow-[0_18px_60px_rgba(20,48,51,0.08)]">
        <div className="mb-5 grid size-11 place-items-center rounded-xl bg-[#fff3e8] text-[var(--copper)]">
          <TriangleAlert size={21} />
        </div>
        <div className="eyebrow">Safe fallback</div>
        <h1 className="mt-2 mb-0 text-3xl font-bold tracking-[-0.035em] text-[var(--spruce)]">
          This view could not be loaded
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Your data has not been changed. Retry the read, or open system health if the database or
          importer is temporarily unavailable.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--spruce)] px-4 text-sm font-semibold text-white"
          >
            <RotateCcw size={16} /> Try again
          </button>
          <Link
            href="/api/health"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold text-[var(--ink)] no-underline"
          >
            <Activity size={16} /> System health
          </Link>
        </div>
      </section>
    </main>
  );
}
