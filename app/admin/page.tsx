import type { Metadata } from "next";
import { Activity, ArrowLeft, Database, FileWarning, Gauge, UploadCloud } from "lucide-react";
import { requireAdmin } from "@/src/lib/auth";

export const metadata: Metadata = { title: "Operations" };

const operations = [
  {
    label: "Permit imports",
    value: "Implemented",
    detail: "Hourly snapshot checks and backfill queue",
    icon: UploadCloud,
  },
  {
    label: "Database",
    value: "PostGIS",
    detail: "Connection checked by health route",
    icon: Database,
  },
  {
    label: "Classification",
    value: "Rule engine",
    detail: "Configurable evidence scoring",
    icon: Gauge,
  },
  {
    label: "Failed records",
    value: "Quarantined",
    detail: "Bad source rows are isolated for review",
    icon: FileWarning,
  },
];

export default async function AdminPage() {
  const user = await requireAdmin("/admin");

  return (
    <main className="min-h-screen bg-[var(--limestone)] px-5 py-8 text-[var(--ink)] md:px-10">
      <div className="mx-auto max-w-5xl">
        <a
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-xs font-semibold text-[var(--teal)]"
        >
          <ArrowLeft size={15} /> Back to overview
        </a>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="mb-2 text-[10px] font-bold tracking-[0.12em] text-[var(--copper)] uppercase">
              Protected administration
            </div>
            <h1 className="m-0 text-3xl font-bold tracking-[-0.035em] text-[var(--spruce)]">
              Operations centre
            </h1>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Signed in as {user.email}. Imports now run through the durable job queue; interactive
              controls and review screens arrive with the live UI milestone.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-[#b9dccb] bg-[#eaf6f0] px-3 py-2 text-[10px] font-bold text-[#28654c]">
            <Activity size={14} /> Foundation healthy
          </div>
        </div>
        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          {operations.map(({ label, value, detail, icon: Icon }) => (
            <article
              key={label}
              className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[0_1px_2px_rgba(20,48,51,0.04)]"
            >
              <div className="mb-7 grid size-9 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]">
                <Icon size={18} />
              </div>
              <div className="text-[10px] font-semibold text-[var(--muted)]">{label}</div>
              <div className="mt-1 text-2xl font-bold tracking-[-0.03em] text-[var(--spruce)]">
                {value}
              </div>
              <p className="mb-0 text-[10px] text-[var(--muted)]">{detail}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
