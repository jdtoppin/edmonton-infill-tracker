"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Merge, RefreshCw, Save, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

type Option = { value: string; label: string };

export function ProjectReviewActions({
  projectId,
  expectedUpdatedAt,
  categories,
  stages,
  eventIds,
}: {
  projectId: string;
  expectedUpdatedAt: string;
  categories: Option[];
  stages: Option[];
  eventIds: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(action: string, values: Record<string, unknown>) {
    setPending(action);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/admin/projects/${encodeURIComponent(projectId)}/actions`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ action, expectedUpdatedAt, ...values }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The review action could not be saved.");
      setMessage("Review action saved and recorded in the audit trail.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The review action could not be saved.");
    } finally {
      setPending("");
    }
  }

  async function override(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const category = form.get("category");
    const stage = form.get("stage");
    await submit("override", {
      category: category === "automatic" ? null : category || undefined,
      stage: stage === "automatic" ? null : stage || undefined,
      reviewStatus: "CORRECTED",
      reason: form.get("reason"),
    });
  }

  async function markNotRelevant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!window.confirm("Mark this project not relevant? It will leave ordinary project results."))
      return;
    await submit("not-relevant", { reason: form.get("reason") });
  }

  async function mergeProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (
      !window.confirm("Merge this project into the target? Permit links will move to the target.")
    )
      return;
    await submit("merge", {
      targetProjectId: form.get("targetProjectId"),
      reason: form.get("reason"),
    });
  }

  async function reassignEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("reassign", {
      permitEventId: form.get("permitEventId"),
      targetProjectId: form.get("targetProjectId"),
      reason: form.get("reason"),
    });
  }

  const fieldClass =
    "mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]";

  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-white p-5"
      aria-labelledby="review-tools-title"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Administrator only</div>
          <h2 id="review-tools-title" className="mt-1 mb-0 text-xl font-bold text-[var(--spruce)]">
            Review tools
          </h2>
        </div>
        <RefreshCw size={18} className="text-[var(--teal)]" aria-hidden="true" />
      </div>

      <div className="space-y-3">
        <details className="rounded-lg border border-[var(--border)] p-4" open>
          <summary className="cursor-pointer text-sm font-bold text-[var(--spruce)]">
            Correct category or stage
          </summary>
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={override}>
            <label className="text-xs font-semibold">
              Category
              <select name="category" className={fieldClass} defaultValue="">
                <option value="">Keep current</option>
                <option value="automatic">Use automatic classification</option>
                {categories.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Stage
              <select name="stage" className={fieldClass} defaultValue="">
                <option value="">Keep current</option>
                <option value="automatic">Use automatic stage</option>
                {stages.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold sm:col-span-2">
              Reason
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                className={`${fieldClass} min-h-24 py-3`}
              />
            </label>
            <Button type="submit" disabled={Boolean(pending)}>
              {pending === "override" ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Save size={16} />
              )}
              Save correction
            </Button>
          </form>
        </details>

        <details className="rounded-lg border border-[var(--border)] p-4">
          <summary className="cursor-pointer text-sm font-bold text-[var(--spruce)]">
            Reassign a permit event
          </summary>
          <form className="mt-4 grid gap-3" onSubmit={reassignEvent}>
            <label className="text-xs font-semibold">
              Permit event
              <select name="permitEventId" required className={fieldClass}>
                {eventIds.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Target project ID
              <input name="targetProjectId" required maxLength={200} className={fieldClass} />
            </label>
            <label className="text-xs font-semibold">
              Reason
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                className={`${fieldClass} min-h-20 py-3`}
              />
            </label>
            <Button type="submit" variant="secondary" disabled={Boolean(pending)}>
              Reassign event
            </Button>
          </form>
        </details>

        <details className="rounded-lg border border-[var(--border)] p-4">
          <summary className="cursor-pointer text-sm font-bold text-[var(--spruce)]">
            Merge duplicate project
          </summary>
          <form className="mt-4 grid gap-3" onSubmit={mergeProject}>
            <label className="text-xs font-semibold">
              Target project ID
              <input name="targetProjectId" required maxLength={200} className={fieldClass} />
            </label>
            <label className="text-xs font-semibold">
              Reason
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                className={`${fieldClass} min-h-20 py-3`}
              />
            </label>
            <Button type="submit" variant="secondary" disabled={Boolean(pending)}>
              <Merge size={16} /> Merge into target
            </Button>
          </form>
        </details>

        <details className="rounded-lg border border-[#ecd2cf] bg-[#fffafa] p-4">
          <summary className="cursor-pointer text-sm font-bold text-[var(--critical)]">
            Mark not relevant
          </summary>
          <form className="mt-4 grid gap-3" onSubmit={markNotRelevant}>
            <label className="text-xs font-semibold">
              Reason
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                className={`${fieldClass} min-h-20 py-3`}
              />
            </label>
            <Button type="submit" variant="secondary" disabled={Boolean(pending)}>
              <ShieldX size={16} /> Mark not relevant
            </Button>
          </form>
        </details>
      </div>

      <div className="mt-4 min-h-5 text-sm" aria-live="polite">
        {message && <p className="m-0 text-[var(--positive)]">{message}</p>}
        {error && (
          <p className="m-0 text-[var(--critical)]" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
