import { randomUUID } from "node:crypto";

import type { JobRun, PrismaClient } from "../generated/prisma/client";
import { JobType, RunStatus } from "../generated/prisma/enums";

export type ClaimedJob = JobRun & { lockKey: string };

const recoveredJobData = {
  status: RunStatus.PENDING,
  lockKey: null,
  heartbeatAt: null,
  lockExpiresAt: null,
  startedAt: null,
  completedAt: null,
  processedCount: 0,
  successfulCount: 0,
  failedCount: 0,
  errorSummary: "Recovered after a worker lease expired; the job will be retried.",
} as const;

export async function recoverExpiredJobs(
  db: PrismaClient,
  now = new Date(),
): Promise<{ jobs: number; imports: number }> {
  return db.$transaction(async (transaction) => {
    // Fenced import transactions lock their JobRun first. Taking the same lock
    // here makes recovery a serialization boundary instead of relying on the
    // stale worker to notice its next heartbeat in time.
    const expiredJobs = await transaction.$queryRaw<
      Array<{ id: string; jobType: JobType; lockKey: string | null }>
    >`
      SELECT "id", "jobType", "lockKey"
      FROM "JobRun"
      WHERE "status" = ${RunStatus.RUNNING}::"RunStatus"
        AND ("lockExpiresAt" IS NULL OR "lockExpiresAt" < ${now})
      FOR UPDATE
    `;

    if (expiredJobs.length === 0) return { jobs: 0, imports: 0 };

    await transaction.jobRun.updateMany({
      where: { id: { in: expiredJobs.map(({ id }) => id) } },
      data: recoveredJobData,
    });

    let imports = 0;
    const expiredImportFences = expiredJobs.flatMap((job) =>
      job.jobType === JobType.INCREMENTAL_PERMIT_IMPORT && job.lockKey
        ? [{ jobRunId: job.id, leaseToken: job.lockKey }]
        : [],
    );
    if (expiredImportFences.length > 0) {
      const recoveredRuns = await transaction.importRun.updateMany({
        where: { status: RunStatus.RUNNING, OR: expiredImportFences },
        data: {
          status: RunStatus.FAILED,
          activeKey: null,
          completedAt: now,
          errorSummary: "The worker lease expired before this import completed.",
        },
      });
      imports = recoveredRuns.count;
    }

    return { jobs: expiredJobs.length, imports };
  });
}

export async function claimNextJob(
  db: PrismaClient,
  options: { leaseMs: number; workerName: string; now?: Date },
): Promise<ClaimedJob | null> {
  const pending = await db.jobRun.findFirst({
    where: { status: RunStatus.PENDING },
    orderBy: { createdAt: "asc" },
  });
  if (!pending) return null;

  const lockKey = `${options.workerName}:${randomUUID()}`;
  const now = options.now ?? new Date();
  const claimed = await db.jobRun.updateMany({
    where: { id: pending.id, status: RunStatus.PENDING, lockKey: null },
    data: {
      status: RunStatus.RUNNING,
      lockKey,
      startedAt: now,
      heartbeatAt: now,
      lockExpiresAt: new Date(now.getTime() + options.leaseMs),
    },
  });
  return claimed.count === 1 ? { ...pending, lockKey } : null;
}

export async function extendJobLease(
  db: PrismaClient,
  job: Pick<ClaimedJob, "id" | "lockKey">,
  leaseMs: number,
  now = new Date(),
): Promise<boolean> {
  const extended = await db.jobRun.updateMany({
    where: { id: job.id, status: RunStatus.RUNNING, lockKey: job.lockKey },
    data: {
      heartbeatAt: now,
      lockExpiresAt: new Date(now.getTime() + leaseMs),
    },
  });
  return extended.count === 1;
}
