import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowRight, Database, FileWarning, RefreshCw, ScanSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeading } from "@/components/workspace/page-header";
import { requireAdmin } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";
import { getAdminHealth } from "@/src/services/admin";
import { getAdminProjectSummary } from "@/src/services/project-read-model";

export const metadata: Metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireAdmin("/admin");
  const db = await getDb();
  const [summary, health] = await Promise.all([
    getAdminProjectSummary(db, user.id),
    getAdminHealth(db),
  ]);
  const cards = [
    {
      label: "Pending reviews",
      value: summary.pendingReview,
      detail: `${summary.marketReviewRequired} occupancy-triggered market follow-ups`,
      href: "/admin/reviews",
      icon: ScanSearch,
    },
    {
      label: "Quarantined records",
      value: health.dataQuality.quarantinedRecords,
      detail: `${summary.unassignedPermits} permits waiting for project matching`,
      href: "/admin/health",
      icon: FileWarning,
    },
    {
      label: "Queued / running jobs",
      value: health.jobs.pending + health.jobs.running,
      detail: `${health.jobs.expiredLeases} expired worker leases`,
      href: "/admin/imports",
      icon: Database,
    },
    {
      label: "Application build",
      value: (process.env.APP_BUILD_SHA ?? "unknown").slice(0, 8),
      detail: "Check the public repository before running a guarded update",
      href: "/admin/updates",
      icon: RefreshCw,
    },
  ];

  return (
    <section>
      <PageHeading
        eyebrow="Protected administration"
        title="Operations centre"
        description={`Signed in as ${user.email}. Review data quality, queue durable work, correct classifications, and maintain the local installation.`}
        actions={
          <Badge tone={health.state === "ready" ? "green" : "copper"}>
            <Activity size={13} />{" "}
            {health.state === "ready" ? "Database state ready" : "Follow-up required"}
          </Badge>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, detail, href, icon: Icon }) => (
          <Link
            href={href}
            key={label}
            className="group rounded-xl border border-[var(--border)] bg-white p-5 text-inherit no-underline shadow-[0_1px_2px_rgba(20,48,51,0.04)] transition-transform hover:-translate-y-0.5"
          >
            <div className="mb-7 grid size-10 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]">
              <Icon size={18} />
            </div>
            <div className="text-xs font-semibold text-[var(--muted)]">{label}</div>
            <div className="mt-1 text-3xl font-bold tracking-[-0.04em] text-[var(--spruce)]">
              {value}
            </div>
            <p className="min-h-10 text-xs leading-5 text-[var(--muted)]">{detail}</p>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--teal)]">
              Open{" "}
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-5 rounded-xl border border-[var(--border)] bg-[#f8faf8] p-4 text-xs leading-5 text-[var(--muted)]">
        The web UI reports only state it can prove from PostgreSQL. Docker, disk, Caddy, and
        Tailscale remain host-level concerns and are checked with{" "}
        <code>./scripts/infill status</code>.
      </div>
    </section>
  );
}
