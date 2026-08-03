import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Braces } from "lucide-react";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { Badge } from "@/components/ui/badge";
import { PageHeading } from "@/components/workspace/page-header";
import { requireAdmin } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";

export const metadata: Metadata = { title: "Failed records" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

function requestedPage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function FailuresPage({
  searchParams,
}: {
  searchParams: Promise<{ failureId?: string; page?: string }>;
}) {
  await requireAdmin("/admin/failures");
  const incoming = await searchParams;
  const requested = incoming.failureId;
  const db = await getDb();
  const [total, selected] = await Promise.all([
    db.importFailure.count(),
    requested
      ? db.importFailure.findUnique({
          where: { id: requested },
          select: {
            id: true,
            sourceRecordIdentifier: true,
            errorCode: true,
            errorMessage: true,
            rawPayload: true,
            createdAt: true,
            importRun: { select: { sourceProvider: true, mode: true, status: true } },
          },
        })
      : null,
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage(incoming.page), totalPages);
  const failures = await db.importFailure.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      sourceRecordIdentifier: true,
      errorCode: true,
      errorMessage: true,
      createdAt: true,
      importRun: { select: { sourceProvider: true, mode: true, status: true } },
    },
  });
  return (
    <section className="space-y-6">
      <PageHeading
        eyebrow="Quarantined ingestion records"
        title="Failed-record review"
        description="Inspect isolated source rows without exposing them to ordinary users. The importer keeps processing healthy records; raw payloads below are rendered only as escaped administrator text."
        actions={
          <Badge tone={total > 0 ? "copper" : "green"}>{total.toLocaleString("en-CA")} total</Badge>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="min-w-0 space-y-3">
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
            {failures.map((failure) => (
              <Link
                key={failure.id}
                href={`/admin/failures?page=${page}&failureId=${encodeURIComponent(failure.id)}`}
                className="block border-b border-[var(--border)] p-4 text-inherit no-underline transition-colors last:border-0 hover:bg-[#fbfcfa]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block truncate text-sm text-[var(--spruce)]">
                      {failure.sourceRecordIdentifier}
                    </strong>
                    <span className="mt-1 block text-xs text-[var(--muted)]">
                      {failure.importRun.sourceProvider} ·{" "}
                      {failure.createdAt.toLocaleString("en-CA")}
                    </span>
                  </div>
                  <Badge tone="red">{failure.errorCode ?? "failed"}</Badge>
                </div>
                <p className="mt-2 mb-0 line-clamp-2 text-xs leading-5 text-[var(--muted)]">
                  {failure.errorMessage}
                </p>
              </Link>
            ))}
            {failures.length === 0 && (
              <div className="p-10 text-center">
                <h2 className="m-0 text-lg font-bold text-[var(--spruce)]">No failed records</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">The quarantine list is clear.</p>
              </div>
            )}
          </div>
          <AdminPagination
            basePath="/admin/failures"
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            itemLabel="Failed records"
          />
        </div>
        <article className="min-w-0 rounded-xl border border-[var(--border)] bg-white p-5">
          {selected ? (
            <>
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#fff1df] text-[var(--copper)]">
                  <Braces size={18} />
                </div>
                <div>
                  <div className="eyebrow">Selected failure</div>
                  <h2 className="mt-1 mb-0 text-lg font-bold break-all text-[var(--spruce)]">
                    {selected.sourceRecordIdentifier}
                  </h2>
                </div>
              </div>
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-[#fff7ec] p-3 text-xs leading-5 text-[#70491f]">
                <AlertTriangle className="mt-0.5 shrink-0" size={15} />
                <span>{selected.errorMessage}</span>
              </div>
              <pre
                className="mt-4 max-h-[58vh] overflow-auto rounded-lg bg-[#102f33] p-4 text-xs leading-6 whitespace-pre-wrap text-[#d9e7e5]"
                tabIndex={0}
              >
                {selected.rawPayload === null
                  ? "Raw payload was not retained for this failure."
                  : JSON.stringify(selected.rawPayload, null, 2)}
              </pre>
            </>
          ) : (
            <div className="grid min-h-64 place-items-center text-center">
              <div>
                <Braces className="mx-auto text-[var(--muted)]" size={26} />
                <h2 className="mt-3 mb-0 text-lg font-bold text-[var(--spruce)]">
                  Select a failed record
                </h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Its sanitized error and stored source payload will appear here.
                </p>
              </div>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
