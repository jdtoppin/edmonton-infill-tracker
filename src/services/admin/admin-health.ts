import type { PrismaClient } from "../../generated/prisma/client";
import { JobType, RawRecordStatus, ReviewStatus, RunStatus } from "../../generated/prisma/enums";
import {
  DEFAULT_SCHEDULER_INTERVAL_MS,
  MAXIMUM_SCHEDULER_INTERVAL_MS,
  MINIMUM_SCHEDULER_INTERVAL_MS,
} from "../../jobs/scheduled-jobs";

export type AdminHealthState = "ready" | "attention";

export interface AdminHealthSnapshot {
  state: AdminHealthState;
  checkedAt: string;
  database: { status: "ready"; latencyMs: number };
  scheduler: {
    configurationValid: boolean;
    intervalMs: number;
    lastScheduledAt: string | null;
    nextRunAt: string | null;
    overdue: boolean;
  };
  jobs: { pending: number; running: number; expiredLeases: number };
  imports: {
    lastCompletedAt: string | null;
    recent: Array<{
      id: string;
      sourceProvider: string;
      mode: string;
      status: string;
      recordsFetched: number;
      recordsCreated: number;
      recordsUpdated: number;
      recordsSkipped: number;
      recordsFailed: number;
      startedAt: string | null;
      completedAt: string | null;
    }>;
  };
  dataQuality: {
    quarantinedRecords: number;
    unmatchedPermitEvents: number;
    pendingProjectReviews: number;
    marketReviewsRequired: number;
  };
  visibility: {
    database: "observed";
    hostAndContainers: "not-observable-from-web";
  };
}

function schedulerConfiguration(value: string | undefined): {
  configurationValid: boolean;
  intervalMs: number;
} {
  if (value === undefined || value.trim() === "") {
    return { configurationValid: true, intervalMs: DEFAULT_SCHEDULER_INTERVAL_MS };
  }
  const parsed = Number(value);
  const valid =
    Number.isSafeInteger(parsed) &&
    parsed >= MINIMUM_SCHEDULER_INTERVAL_MS &&
    parsed <= MAXIMUM_SCHEDULER_INTERVAL_MS;
  return {
    configurationValid: valid,
    intervalMs: valid ? parsed : DEFAULT_SCHEDULER_INTERVAL_MS,
  };
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

/**
 * Reports only state the web process can prove from PostgreSQL. Docker, Caddy,
 * host disk and Tailscale health intentionally remain outside this boundary.
 */
export async function getAdminHealth(
  db: PrismaClient,
  options: {
    now?: Date;
    schedulerIntervalValue?: string;
    monotonicNow?: () => number;
  } = {},
): Promise<AdminHealthSnapshot> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error("Health-check time must be valid.");
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const databaseStartedAt = monotonicNow();
  await db.$queryRaw`SELECT 1`;
  const databaseLatencyMs = Math.max(0, Math.round(monotonicNow() - databaseStartedAt));
  const configured = schedulerConfiguration(
    options.schedulerIntervalValue ?? process.env.SCHEDULER_INTERVAL_MS,
  );

  const [
    pendingJobs,
    runningJobs,
    expiredLeases,
    latestScheduled,
    lastCompletedImport,
    recentImports,
    quarantinedRecords,
    unmatchedPermitEvents,
    pendingProjectReviews,
    marketReviewsRequired,
  ] = await Promise.all([
    db.jobRun.count({ where: { status: RunStatus.PENDING } }),
    db.jobRun.count({ where: { status: RunStatus.RUNNING } }),
    db.jobRun.count({
      where: {
        status: RunStatus.RUNNING,
        OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lte: now } }],
      },
    }),
    db.jobRun.findFirst({
      where: {
        jobType: JobType.INCREMENTAL_PERMIT_IMPORT,
        metadata: { path: ["source"], equals: "scheduler" },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    db.importRun.findFirst({
      where: {
        status: { in: [RunStatus.SUCCEEDED, RunStatus.PARTIALLY_SUCCEEDED] },
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
    db.importRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        sourceProvider: true,
        mode: true,
        status: true,
        recordsFetched: true,
        recordsCreated: true,
        recordsUpdated: true,
        recordsSkipped: true,
        recordsFailed: true,
        startedAt: true,
        completedAt: true,
      },
    }),
    db.rawPermitRecord.count({ where: { processingStatus: RawRecordStatus.FAILED } }),
    db.permitEvent.count({ where: { projectEvent: null } }),
    db.project.count({ where: { mergedIntoId: null, reviewStatus: ReviewStatus.PENDING } }),
    db.project.count({ where: { mergedIntoId: null, marketReviewRequired: true } }),
  ]);

  const nextRunAt = latestScheduled
    ? new Date(latestScheduled.createdAt.getTime() + configured.intervalMs)
    : null;
  const overdue = !nextRunAt || nextRunAt.getTime() <= now.getTime();
  const needsAttention =
    !configured.configurationValid ||
    overdue ||
    expiredLeases > 0 ||
    quarantinedRecords > 0 ||
    unmatchedPermitEvents > 0 ||
    pendingProjectReviews > 0 ||
    marketReviewsRequired > 0;

  return {
    state: needsAttention ? "attention" : "ready",
    checkedAt: now.toISOString(),
    database: { status: "ready", latencyMs: databaseLatencyMs },
    scheduler: {
      ...configured,
      lastScheduledAt: iso(latestScheduled?.createdAt ?? null),
      nextRunAt: iso(nextRunAt),
      overdue,
    },
    jobs: { pending: pendingJobs, running: runningJobs, expiredLeases },
    imports: {
      lastCompletedAt: iso(lastCompletedImport?.completedAt ?? null),
      recent: recentImports.map((run) => ({
        ...run,
        mode: String(run.mode),
        status: String(run.status),
        startedAt: iso(run.startedAt),
        completedAt: iso(run.completedAt),
      })),
    },
    dataQuality: {
      quarantinedRecords,
      unmatchedPermitEvents,
      pendingProjectReviews,
      marketReviewsRequired,
    },
    visibility: {
      database: "observed",
      hostAndContainers: "not-observable-from-web",
    },
  };
}
