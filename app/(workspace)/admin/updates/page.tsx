import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { UpdateCommand } from "@/components/admin/update-command";
import { Badge } from "@/components/ui/badge";
import { PageHeading } from "@/components/workspace/page-header";
import { requireAdmin } from "@/src/lib/auth";
import { checkApplicationUpdate, UPDATE_REPOSITORY } from "@/src/services/admin";

export const metadata: Metadata = { title: "Application updates" };
export const dynamic = "force-dynamic";

function shortSha(value: string | null) {
  return value ? value.slice(0, 8) : "unknown";
}

export default async function UpdatesPage() {
  await requireAdmin("/admin/updates");
  const status = await checkApplicationUpdate();
  const available = status.state === "update-available";
  const currentSha = status.currentBuildSha;
  return (
    <section>
      <PageHeading
        eyebrow="Guarded local maintenance"
        title="Application updates"
        description="Compare this installed build with the fixed public repository, then hand off installation to the existing backup-first Mac mini command."
        actions={
          <Badge tone={status.state === "up-to-date" ? "green" : available ? "copper" : "neutral"}>
            <RefreshCw size={13} /> {status.state.replaceAll("-", " ")}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-xl border border-[var(--border)] bg-white p-5">
          <div className="flex items-start gap-3">
            <div
              className={`grid size-11 shrink-0 place-items-center rounded-xl ${status.state === "up-to-date" ? "bg-[#eaf6f0] text-[var(--positive)]" : "bg-[#fff1df] text-[var(--copper)]"}`}
            >
              {status.state === "up-to-date" ? <CheckCircle2 size={20} /> : <RefreshCw size={20} />}
            </div>
            <div>
              <div className="eyebrow">Repository comparison</div>
              <h2 className="mt-1 mb-0 text-xl font-bold text-[var(--spruce)]">
                {available
                  ? "An update is available"
                  : status.state === "up-to-date"
                    ? "This build matches main"
                    : status.state === "build-unknown"
                      ? "Installed build predates version tracking"
                      : "Update check unavailable"}
              </h2>
            </div>
          </div>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-[#f7f8f5] p-3">
              <dt className="text-xs text-[var(--muted)]">Installed commit</dt>
              <dd className="m-0 mt-1 font-mono text-sm font-bold text-[var(--spruce)]">
                {shortSha(currentSha)}
              </dd>
            </div>
            <div className="rounded-lg bg-[#f7f8f5] p-3">
              <dt className="text-xs text-[var(--muted)]">Latest main commit</dt>
              <dd className="m-0 mt-1 font-mono text-sm font-bold text-[var(--spruce)]">
                {status.state === "unavailable" ? "unavailable" : shortSha(status.latestBuildSha)}
              </dd>
            </div>
          </dl>
          {status.state !== "unavailable" && (
            <div className="mt-4 rounded-lg border border-[var(--border)] p-3">
              <strong className="block text-sm text-[var(--spruce)]">{status.summary}</strong>
              <span className="mt-1 block text-xs text-[var(--muted)]">
                Committed {new Date(status.latestCommittedAt).toLocaleString("en-CA")}
              </span>
              <a
                href={status.latestCommitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-[var(--teal)]"
              >
                Review commit on GitHub <ExternalLink size={13} />
              </a>
            </div>
          )}
          {status.state === "unavailable" && (
            <p className="mt-4 rounded-lg bg-[#fff7ec] p-3 text-sm text-[#70491f]">
              GitHub could not be checked safely ({status.reason}). No update target was accepted.
            </p>
          )}
          <a
            href="/admin/updates"
            className="mt-3 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-[var(--teal)]"
          >
            <RefreshCw size={14} /> Check again
          </a>
        </article>

        <article className="rounded-xl border border-[var(--border)] bg-white p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 text-[var(--positive)]" size={20} />
            <div>
              <h2 className="m-0 text-lg font-bold text-[var(--spruce)]">
                Install from the Mac mini
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Run the fixed operator command from the repository folder. It refuses dirty working
                trees or unsafe ports/Funnel state, creates and verifies a database backup,
                fast-forwards Git, rebuilds, migrates, restarts, and checks health.
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                Reviewed releases include CI-tested Node.js, npm, Caddy, and PostgreSQL updates;
                this command rebuilds and pulls those pinned versions without automatically
                deploying an unreviewed dependency change.
              </p>
            </div>
          </div>
          <div className="mt-5">
            <UpdateCommand />
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-[#fff7ec] p-3 text-xs leading-5 text-[#70491f]">
            <AlertTriangle className="mt-0.5 shrink-0" size={15} />
            <span>
              Expect brief downtime. If migration fails, application services stay stopped while
              PostgreSQL remains available for diagnosis and restore.
            </span>
          </div>
        </article>
      </div>

      <div className="mt-5 rounded-xl border border-[var(--border)] bg-[#f8faf8] p-4 text-xs leading-5 text-[var(--muted)]">
        Security boundary: this page checks only <strong>{UPDATE_REPOSITORY}</strong> and cannot run
        shell commands, choose a repository or ref, access Docker, or write to the host checkout.
      </div>
    </section>
  );
}
