import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { ImportControls } from "@/components/admin/import-controls";
import { PageHeading } from "@/components/workspace/page-header";
import { requireAdmin } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";
import { getAdminHealth } from "@/src/services/admin";

export const metadata: Metadata = { title: "Permit imports" };
export const dynamic = "force-dynamic";

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-CA") : "Not completed";
}

export default async function ImportsPage() {
  await requireAdmin("/admin/imports");
  const health = await getAdminHealth(await getDb());
  return (
    <section>
      <PageHeading
        eyebrow="Durable background work"
        title="Permit imports"
        description="Run a City revision check or queue a historical date range. Requests return immediately; the isolated worker processes each stage with a persisted lease."
        actions={
          <Badge
            tone={health.jobs.running > 0 ? "teal" : health.jobs.pending > 0 ? "copper" : "green"}
          >
            {health.jobs.running} running · {health.jobs.pending} queued
          </Badge>
        }
      />
      <ImportControls />
      <div className="mt-6 overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
        <table className="w-full min-w-[900px] border-collapse text-left text-xs">
          <caption className="px-4 py-4 text-left text-base font-bold text-[var(--spruce)]">
            Recent import history
          </caption>
          <thead className="border-y border-[var(--border)] bg-[#f8faf8] text-[var(--muted)]">
            <tr>
              {[
                "Provider",
                "Mode",
                "Status",
                "Fetched",
                "Created",
                "Updated",
                "Skipped",
                "Failed",
                "Completed",
              ].map((heading) => (
                <th key={heading} className="px-4 py-3 font-semibold">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {health.imports.recent.map((run) => (
              <tr key={run.id}>
                <td className="max-w-52 truncate px-4 py-3 font-semibold text-[var(--spruce)]">
                  {run.sourceProvider}
                </td>
                <td className="px-4 py-3">{run.mode}</td>
                <td className="px-4 py-3">
                  <Badge
                    tone={
                      run.status === "SUCCEEDED"
                        ? "green"
                        : run.status === "FAILED"
                          ? "red"
                          : "copper"
                    }
                  >
                    {run.status.replaceAll("_", " ").toLowerCase()}
                  </Badge>
                </td>
                <td className="px-4 py-3">{run.recordsFetched}</td>
                <td className="px-4 py-3">{run.recordsCreated}</td>
                <td className="px-4 py-3">{run.recordsUpdated}</td>
                <td className="px-4 py-3">{run.recordsSkipped}</td>
                <td className="px-4 py-3">{run.recordsFailed}</td>
                <td className="px-4 py-3">{dateTime(run.completedAt)}</td>
              </tr>
            ))}
            {health.imports.recent.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                  No import runs are recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
