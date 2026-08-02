"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type ImportMode = "incremental" | "backfill";

export function ImportControls() {
  const router = useRouter();
  const [pending, setPending] = useState<ImportMode | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function queue(payload: Record<string, unknown>, mode: ImportMode) {
    setPending(mode);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/imports", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        jobId?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "The import could not be queued.");
      setMessage(
        `Queued safely${body.jobId ? ` as ${body.jobId.slice(0, 8)}` : ""}. The worker will process it in the background.`,
      );
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The import could not be queued.");
    } finally {
      setPending(null);
    }
  }

  async function checkNow() {
    await queue({ mode: "incremental", datasets: ["development", "building"] }, "incremental");
  }

  async function backfill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await queue(
      {
        mode: "backfill",
        datasets:
          form.get("dataset") === "all"
            ? ["development", "building"]
            : [String(form.get("dataset") ?? "development")],
        from: String(form.get("from") ?? ""),
        to: String(form.get("to") ?? ""),
      },
      "backfill",
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-[var(--border)] bg-white p-5">
        <div className="mb-4 grid size-10 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]">
          <RefreshCw size={18} aria-hidden="true" />
        </div>
        <h2 className="m-0 text-lg font-bold text-[var(--spruce)]">Check City data now</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Queue one revision check for both permit datasets. If the City snapshot is unchanged, no
          project records are rewritten.
        </p>
        <Button onClick={checkNow} disabled={pending !== null}>
          {pending === "incremental" ? (
            <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />
          ) : (
            <RefreshCw size={16} aria-hidden="true" />
          )}
          Queue data check
        </Button>
      </section>

      <form className="rounded-xl border border-[var(--border)] bg-white p-5" onSubmit={backfill}>
        <div className="mb-4 grid size-10 place-items-center rounded-lg bg-[#fff1df] text-[var(--copper)]">
          <CalendarRange size={18} aria-hidden="true" />
        </div>
        <h2 className="m-0 text-lg font-bold text-[var(--spruce)]">Historical backfill</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Queue a bounded date range through the same durable worker. Only one permit pipeline can
          run at a time.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-[var(--ink)]">
            Dataset
            <select
              name="dataset"
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
            >
              <option value="all">Both</option>
              <option value="development">Development</option>
              <option value="building">Building</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--ink)]">
            From
            <input
              name="from"
              type="date"
              required
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-[var(--ink)]">
            To
            <input
              name="to"
              type="date"
              required
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
            />
          </label>
        </div>
        <Button type="submit" variant="secondary" className="mt-4" disabled={pending !== null}>
          {pending === "backfill" && (
            <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />
          )}
          Queue backfill
        </Button>
      </form>

      <div className="min-h-5 text-sm lg:col-span-2" aria-live="polite">
        {message && <p className="m-0 text-[var(--positive)]">{message}</p>}
        {error && (
          <p className="m-0 text-[var(--critical)]" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
