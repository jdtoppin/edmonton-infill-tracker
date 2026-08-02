import type { PrismaClient } from "../generated/prisma/client";
import { JobType, RunStatus } from "../generated/prisma/enums";
import {
  dataQualityConflictKey,
  isUniqueConstraintError,
  permitImportConflictKey,
} from "./permit-import-job";

export const DEFAULT_SCHEDULER_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_SCHEDULER_CONFLICT_RETRY_MS = 60_000;
export const MINIMUM_SCHEDULER_INTERVAL_MS = 60 * 60 * 1_000;
export const MAXIMUM_SCHEDULER_INTERVAL_MS = 365 * 24 * 60 * 60 * 1_000;

const maximumTimerDelayMs = 2_147_483_647;
const schedulerAdvisoryLockName = "edmonton-infill-tracker:scheduler:permit-import";

export interface ScheduleRecurringJobsOptions {
  intervalMs?: number;
  conflictRetryMs?: number;
  now?: Date;
}

export type ScheduleRecurringJobsResult =
  | {
      status: "enqueued";
      nextRunAt: Date;
      permitImportJobId: string;
      dataQualityJobId: string;
    }
  | {
      status: "waiting";
      nextRunAt: Date;
    }
  | {
      status: "blocked";
      nextRunAt: Date;
    };

function validDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function requireTimerDelay(
  name: string,
  value: number,
  minimum: number,
  maximum = maximumTimerDelayMs,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a whole number from ${minimum} to ${maximum} milliseconds.`);
  }
  return value;
}

function retryAt(now: Date, conflictRetryMs: number): Date {
  return new Date(now.getTime() + conflictRetryMs);
}

/**
 * Atomically checks the durable scheduler history and enqueues one recurring
 * import/data-quality tick when it is due. The transaction-scoped advisory
 * lock serializes scheduler replicas; JobRun history preserves cadence across
 * scheduler and database restarts.
 */
export async function scheduleRecurringJobs(
  db: PrismaClient,
  options: ScheduleRecurringJobsOptions = {},
): Promise<ScheduleRecurringJobsResult> {
  const intervalMs = requireTimerDelay(
    "Scheduler interval",
    options.intervalMs ?? DEFAULT_SCHEDULER_INTERVAL_MS,
    MINIMUM_SCHEDULER_INTERVAL_MS,
    MAXIMUM_SCHEDULER_INTERVAL_MS,
  );
  const conflictRetryMs = requireTimerDelay(
    "Scheduler conflict retry",
    options.conflictRetryMs ?? DEFAULT_SCHEDULER_CONFLICT_RETRY_MS,
    1_000,
  );
  const now = options.now ?? new Date();
  if (!validDate(now)) throw new Error("Scheduler time must be a valid Date.");

  try {
    return await db.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_advisory_xact_lock(hashtext(${schedulerAdvisoryLockName})) IS NULL AS "acquired"
      `;

      const latestScheduledImport = await transaction.jobRun.findFirst({
        where: {
          jobType: JobType.INCREMENTAL_PERMIT_IMPORT,
          metadata: { path: ["source"], equals: "scheduler" },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      if (latestScheduledImport) {
        const persistedNextRunAt = new Date(latestScheduledImport.createdAt.getTime() + intervalMs);
        if (persistedNextRunAt.getTime() > now.getTime()) {
          return { status: "waiting", nextRunAt: persistedNextRunAt };
        }
      }

      const activeConflict = await transaction.jobRun.findFirst({
        where: {
          conflictKey: { in: [permitImportConflictKey, dataQualityConflictKey] },
        },
        select: { conflictKey: true },
      });
      if (activeConflict) {
        return {
          status: "blocked",
          nextRunAt: retryAt(now, conflictRetryMs),
        };
      }

      const permitImportJob = await transaction.jobRun.create({
        data: {
          jobType: JobType.INCREMENTAL_PERMIT_IMPORT,
          status: RunStatus.PENDING,
          conflictKey: permitImportConflictKey,
          metadata: {
            mode: "incremental",
            datasets: ["development", "building"],
            source: "scheduler",
          },
          createdAt: now,
        },
        select: { id: true },
      });
      const dataQualityJob = await transaction.jobRun.create({
        data: {
          jobType: JobType.DATA_QUALITY_CHECK,
          status: RunStatus.PENDING,
          conflictKey: dataQualityConflictKey,
          metadata: { source: "scheduler" },
          createdAt: now,
        },
        select: { id: true },
      });

      return {
        status: "enqueued",
        nextRunAt: new Date(now.getTime() + intervalMs),
        permitImportJobId: permitImportJob.id,
        dataQualityJobId: dataQualityJob.id,
      };
    });
  } catch (error) {
    // A CLI import or an older scheduler can race the advisory-lock-protected
    // check. The persistent unique conflict keys remain the final overlap
    // guard; retry later without turning that expected race into a crash loop.
    if (isUniqueConstraintError(error)) {
      return {
        status: "blocked",
        nextRunAt: retryAt(now, conflictRetryMs),
      };
    }
    throw error;
  }
}
