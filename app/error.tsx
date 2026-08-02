"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("route.render.failed", { digest: error.digest });
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--limestone)] px-5 text-[var(--ink)]">
      <section className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-white p-8 shadow-[0_18px_60px_rgba(20,48,51,0.08)]">
        <div className="mb-5 grid size-11 place-items-center rounded-xl bg-[#fff3e8] text-[var(--copper)]">
          <TriangleAlert size={21} aria-hidden="true" />
        </div>
        <p className="mb-2 text-[10px] font-bold tracking-[0.12em] text-[var(--copper)] uppercase">
          Edmonton Infill Tracker
        </p>
        <h1 className="m-0 text-3xl font-bold tracking-[-0.035em] text-[var(--spruce)]">
          This view could not be loaded
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Your data has not been changed. Try the request again, or return later if the importer is
          temporarily unavailable.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--spruce)] px-4 text-sm font-semibold text-white"
        >
          <RotateCcw size={16} aria-hidden="true" /> Try again
        </button>
      </section>
    </main>
  );
}
