import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Braces, ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";

export const metadata: Metadata = { title: "Raw permit record" };
export const dynamic = "force-dynamic";

export default async function RawPermitRecordPage({
  params,
}: {
  params: Promise<{ projectId: string; permitEventId: string }>;
}) {
  const { projectId, permitEventId } = await params;
  await requireAdmin(
    `/admin/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(permitEventId)}/raw`,
  );
  const db = await getDb();
  const record = await db.permitEvent.findFirst({
    where: { id: permitEventId, projectEvent: { projectId } },
    select: {
      permitNumber: true,
      sourceProvider: true,
      sourceRecordIdentifier: true,
      rawSourcePayload: true,
      importedAt: true,
    },
  });
  if (!record) notFound();

  return (
    <section>
      <Link
        href={`/projects/${encodeURIComponent(projectId)}`}
        className="mb-5 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-[var(--teal)] no-underline"
      >
        <ArrowLeft size={15} /> Back to project
      </Link>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Administrator source audit</div>
          <h1 className="mt-2 mb-0 text-3xl font-bold tracking-[-0.04em] text-[var(--spruce)]">
            Stored permit record
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {record.permitNumber ?? record.sourceRecordIdentifier} · imported{" "}
            {record.importedAt.toLocaleString("en-CA")}
          </p>
        </div>
        <div className="grid size-11 place-items-center rounded-xl bg-[var(--teal-soft)] text-[var(--teal)]">
          <Braces size={20} />
        </div>
      </div>
      <div className="mt-5 flex items-start gap-2 rounded-lg border border-[#d5e6df] bg-[#eef8f3] p-3 text-xs text-[#28654c]">
        <ShieldCheck className="mt-0.5 shrink-0" size={15} />
        <span>
          This raw source payload is visible only to administrators. It is rendered as escaped text
          and cannot execute markup or scripts.
        </span>
      </div>
      <dl className="mt-5 grid gap-3 rounded-xl border border-[var(--border)] bg-white p-4 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[var(--muted)]">Provider</dt>
          <dd className="m-0 mt-1 font-semibold">{record.sourceProvider}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Source identifier</dt>
          <dd className="m-0 mt-1 font-semibold break-all">{record.sourceRecordIdentifier}</dd>
        </div>
      </dl>
      <pre
        className="mt-4 max-h-[70vh] overflow-auto rounded-xl bg-[#102f33] p-5 text-xs leading-6 whitespace-pre-wrap text-[#d9e7e5]"
        tabIndex={0}
      >
        {JSON.stringify(record.rawSourcePayload, null, 2)}
      </pre>
    </section>
  );
}
