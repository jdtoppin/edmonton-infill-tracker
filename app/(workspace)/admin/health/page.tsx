import type { Metadata } from "next";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeading } from "@/components/workspace/page-header";
import { requireAdmin } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";
import { getAdminHealth } from "@/src/services/admin";

export const metadata: Metadata = { title: "System health" };
export const dynamic = "force-dynamic";

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("en-CA") : "Not recorded";
}

export default async function HealthPage() {
  await requireAdmin("/admin/health");
  const health = await getAdminHealth(await getDb());
  const checks = [
    {
      label: "Database",
      value: `${health.database.latencyMs} ms`,
      detail: "Connection query completed",
      attention: false,
      icon: Database,
    },
    {
      label: "Scheduler",
      value: health.scheduler.overdue ? "Overdue" : "On cadence",
      detail: `Next due ${dateTime(health.scheduler.nextRunAt)}`,
      attention: health.scheduler.overdue || !health.scheduler.configurationValid,
      icon: Clock3,
    },
    {
      label: "Worker leases",
      value: `${health.jobs.expiredLeases} expired`,
      detail: `${health.jobs.running} running · ${health.jobs.pending} queued`,
      attention: health.jobs.expiredLeases > 0,
      icon: ServerCog,
    },
    {
      label: "Data quality",
      value:
        health.dataQuality.quarantinedRecords === 0
          ? "No quarantine"
          : `${health.dataQuality.quarantinedRecords} quarantined`,
      detail: `${health.dataQuality.unmatchedPermitEvents} unmatched permits`,
      attention:
        health.dataQuality.quarantinedRecords > 0 || health.dataQuality.unmatchedPermitEvents > 0,
      icon: ShieldCheck,
    },
  ];
  return (
    <section>
      <PageHeading
        eyebrow={`Checked ${dateTime(health.checkedAt)}`}
        title="System health"
        description="Evidence-backed state from PostgreSQL: import freshness, durable jobs, leases, quarantine, and project-review counts. Host/container state is intentionally reported separately."
        actions={
          <Badge tone={health.state === "ready" ? "green" : "copper"}>
            <Activity size={13} /> {health.state}
          </Badge>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {checks.map(({ label, value, detail, attention, icon: Icon }) => (
          <article key={label} className="rounded-xl border border-[var(--border)] bg-white p-5">
            <div
              className={`mb-5 grid size-10 place-items-center rounded-lg ${attention ? "bg-[#fff1df] text-[var(--copper)]" : "bg-[#eaf6f0] text-[var(--positive)]"}`}
            >
              <Icon size={18} />
            </div>
            <div className="text-xs font-semibold text-[var(--muted)]">{label}</div>
            <strong className="mt-1 block text-2xl text-[var(--spruce)]">{value}</strong>
            <p className="mb-0 text-xs leading-5 text-[var(--muted)]">{detail}</p>
          </article>
        ))}
      </div>
      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[var(--border)] bg-white p-5">
          <div className="flex items-start gap-3">
            {health.dataQuality.pendingProjectReviews + health.dataQuality.marketReviewsRequired >
            0 ? (
              <AlertTriangle className="text-[var(--copper)]" size={19} />
            ) : (
              <CheckCircle2 className="text-[var(--positive)]" size={19} />
            )}
            <div>
              <h2 className="m-0 text-lg font-bold text-[var(--spruce)]">Review workload</h2>
              <p className="mt-2 mb-0 text-sm leading-6 text-[var(--muted)]">
                {health.dataQuality.pendingProjectReviews} pending classifications ·{" "}
                {health.dataQuality.marketReviewsRequired} occupancy-triggered market follow-ups.
              </p>
            </div>
          </div>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-white p-5">
          <h2 className="m-0 text-lg font-bold text-[var(--spruce)]">Host diagnostics</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            The browser cannot see Docker, Caddy, disk capacity, or Tailscale without an unsafe
            control channel. Run this read-only command on the Mac mini:
          </p>
          <code className="block rounded-lg bg-[var(--spruce)] px-4 py-3 text-sm text-white select-all">
            ./scripts/infill status
          </code>
        </article>
      </section>
    </section>
  );
}
