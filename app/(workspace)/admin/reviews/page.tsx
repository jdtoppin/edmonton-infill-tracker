import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PageHeading } from "@/components/workspace/page-header";
import { ReviewStatus, type Prisma } from "@/src/generated/prisma/client";
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

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string }>;
}) {
  const user = await requireAdmin("/admin/reviews");
  const requested = (await searchParams).queue;
  const queue: Tab = tabs.some((tab) => tab.value === requested) ? (requested as Tab) : "pending";
  const where: Prisma.ProjectWhereInput = {
    mergedIntoId: null,
    ...(queue === "pending" ? { reviewStatus: ReviewStatus.PENDING } : {}),
    ...(queue === "market" ? { marketReviewRequired: true } : {}),
    ...(queue === "corrected" ? { reviewStatus: ReviewStatus.CORRECTED } : {}),
  };
  const db = await getDb();
  const [summary, projects] = await Promise.all([
    getAdminProjectSummary(db, user.id),
    db.project.findMany({
      where,
      orderBy: [
        { marketReviewRequired: "desc" },
        { infillConfidence: "asc" },
        { latestEventDate: "desc" },
      ],
      take: 50,
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
    }),
  ]);
  const counts: Record<Tab, number | null> = {
    pending: summary.pendingReview,
    market: summary.marketReviewRequired,
    corrected: summary.corrected,
    all: null,
  };

  return (
    <section>
      <PageHeading
        eyebrow="Human-in-the-loop classification"
        title="Project review queue"
        description="Inspect computed evidence, correct category or stage, reassign permit events, merge duplicates, and exclude irrelevant projects. Every change is tied to your administrator account."
      />
      <nav className="mb-4 flex gap-2 overflow-x-auto" aria-label="Review queues">
        {tabs.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/reviews?queue=${tab.value}`}
            aria-current={queue === tab.value ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-semibold no-underline",
              queue === tab.value
                ? "border-[var(--spruce)] bg-[var(--spruce)] text-white"
                : "border-[var(--border)] bg-white text-[var(--muted)]",
            )}
          >
            <span>{tab.label}</span>
            {counts[tab.value] !== null && (
              <span className="rounded-full bg-white/15 px-1.5">{counts[tab.value]}</span>
            )}
          </Link>
        ))}
      </nav>
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
      {projects.length === 50 && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Showing the first 50 records. Work through this queue before loading more.
        </p>
      )}
    </section>
  );
}
