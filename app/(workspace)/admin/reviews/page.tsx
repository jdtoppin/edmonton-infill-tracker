import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PageHeading } from "@/components/workspace/page-header";
import type { Prisma } from "@/src/generated/prisma/client";
import { ReviewStatus } from "@/src/generated/prisma/enums";
import { requireAdmin } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";
import {
  getAdminProjectSummary,
  PROJECT_CATEGORY_LABELS,
  PROJECT_STAGE_LABELS,
  projectCategoryTone,
} from "@/src/services/project-read-model";

export const metadata: Metadata = { title: "Classification review" };
export const dynamic = "force-dynamic";

const tabs = [
  { value: "pending", label: "Pending" },
  { value: "market", label: "Market follow-up" },
  { value: "corrected", label: "Corrected" },
  { value: "all", label: "All active" },
] as const;
type Tab = (typeof tabs)[number]["value"];
const PAGE_SIZE = 25;

function requestedPage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; queue?: string }>;
}) {
  const user = await requireAdmin("/admin/reviews");
  const incoming = await searchParams;
  const requested = incoming.queue;
  const queue: Tab = tabs.some((tab) => tab.value === requested) ? (requested as Tab) : "pending";
  const where: Prisma.ProjectWhereInput = {
    mergedIntoId: null,
    ...(queue === "pending" ? { reviewStatus: ReviewStatus.PENDING } : {}),
    ...(queue === "market" ? { marketReviewRequired: true } : {}),
    ...(queue === "corrected" ? { reviewStatus: ReviewStatus.CORRECTED } : {}),
  };
  const db = await getDb();
  const [summary, total] = await Promise.all([
    getAdminProjectSummary(db, user.id),
    db.project.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage(incoming.page), totalPages);
  const projects = await db.project.findMany({
    where,
    orderBy: [
      { marketReviewRequired: "desc" },
      { infillConfidence: "asc" },
      { latestInfillActivityDate: { sort: "desc", nulls: "last" } },
      { id: "asc" },
    ],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      address: { select: { normalizedStreetAddress: true } },
      neighbourhood: { select: { name: true } },
      category: true,
      currentStage: true,
      infillConfidence: true,
      reviewStatus: true,
      marketReviewRequired: true,
      updatedAt: true,
    },
  });
  const counts: Record<Tab, number | null> = {
    pending: summary.pendingReview,
    market: summary.marketReviewRequired,
    corrected: summary.corrected,
    all: null,
  };

  return (
    <section className="space-y-6">
      <PageHeading
        eyebrow="Human-in-the-loop classification"
        title="Project review queue"
        description="Inspect computed evidence, correct category or stage, reassign permit events, merge duplicates, and exclude irrelevant projects. Every change is tied to your administrator account."
      />
      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Review queues">
        {tabs.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/reviews?queue=${tab.value}`}
            aria-current={queue === tab.value ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-semibold no-underline transition-[background-color,border-color,color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2",
              queue === tab.value
                ? "border-[#8bb9bf] bg-[var(--teal-soft)] text-[var(--teal)] shadow-sm"
                : "border-[var(--border)] bg-white text-[var(--muted)] hover:border-[#b5d5d9] hover:bg-[#f7f9f7] hover:text-[var(--ink)]",
            )}
          >
            <span>{tab.label}</span>
            {counts[tab.value] !== null && (
              <span className="rounded-full bg-white/60 px-1.5">{counts[tab.value]}</span>
            )}
          </Link>
        ))}
      </nav>
      <div className="rounded-xl border border-[#edd0b0] bg-[#fff7ec] p-4 text-xs leading-5 text-[#70491f]">
        <strong className="block text-sm text-[var(--spruce)]">What market follow-up means</strong>
        <p className="mt-1 mb-0">
          A project enters this queue after an occupancy milestone is recorded, so an administrator
          can later compare it with an authorized public real-estate listing source. It does not
          mean occupancy approval is missing or that the building has a safety problem.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
        <div className="divide-y divide-[var(--border)]">
          {projects.map((project) => (
            <Link
              href={`/projects/${encodeURIComponent(project.id)}`}
              key={project.id}
              className="grid gap-3 p-4 text-inherit no-underline transition-colors hover:bg-[#fbfcfa] md:grid-cols-[minmax(240px,1fr)_minmax(180px,0.8fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <strong className="block truncate text-sm text-[var(--spruce)]">
                  {project.address.normalizedStreetAddress}
                </strong>
                <span className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)]">
                  <MapPin size={12} /> {project.neighbourhood.name}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={projectCategoryTone(project.category)}>
                  {PROJECT_CATEGORY_LABELS[project.category]}
                </Badge>
                <Badge>{PROJECT_STAGE_LABELS[project.currentStage]}</Badge>
                {project.marketReviewRequired && <Badge tone="copper">Market follow-up</Badge>}
              </div>
              <div className="flex items-center justify-between gap-4 md:justify-end">
                <Badge tone={project.infillConfidence >= 80 ? "green" : "copper"}>
                  {project.infillConfidence}%
                </Badge>
                <ArrowRight size={15} className="text-[var(--teal)]" />
              </div>
            </Link>
          ))}
          {projects.length === 0 && (
            <div className="px-5 py-12 text-center">
              <h2 className="m-0 text-lg font-bold text-[var(--spruce)]">This queue is clear</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                No projects currently match this review status.
              </p>
            </div>
          )}
        </div>
      </div>
      <AdminPagination
        basePath="/admin/reviews"
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        itemLabel="Projects"
        preservedParams={{ queue }}
      />
    </section>
  );
}
