import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { JobType, RunStatus } from "../../src/generated/prisma/enums";
import { getDb } from "../../src/lib/db";
import {
  DEFAULT_SCHEDULER_INTERVAL_MS,
  scheduleRecurringJobs,
  type ScheduleRecurringJobsResult,
} from "../../src/jobs/scheduled-jobs";

const hasTestDatabase =
  Boolean(process.env.DATABASE_URL) && process.env.ALLOW_DATABASE_INTEGRATION_TESTS === "true";

function isEnqueued(
  result: ScheduleRecurringJobsResult,
): result is Extract<ScheduleRecurringJobsResult, { status: "enqueued" }> {
  return result.status === "enqueued";
}

describe.skipIf(!hasTestDatabase)("durable scheduler persistence", () => {
  const migrationJobId = "migration-00000000000005-infill-activity-dates";
  let db: PrismaClient;
  let migrationJobState: {
    status: RunStatus;
    conflictKey: string | null;
    completedAt: Date | null;
  } | null = null;
  const previousRunAt = new Date("2100-01-01T00:00:00.000Z");
  const dueAt = new Date("2100-01-02T00:00:00.000Z");

  async function removeTestRows() {
    await db.jobRun.deleteMany({
      where: {
        createdAt: { in: [previousRunAt, dueAt] },
        metadata: { path: ["source"], equals: "scheduler" },
      },
    });
  }

  beforeAll(async () => {
    db = await getDb();
    await removeTestRows();
    migrationJobState = await db.jobRun.findUnique({
      where: { id: migrationJobId },
      select: { status: true, conflictKey: true, completedAt: true },
    });
    if (migrationJobState?.conflictKey) {
      await db.jobRun.update({
        where: { id: migrationJobId },
        data: { status: RunStatus.SUCCEEDED, conflictKey: null, completedAt: new Date() },
      });
    }
  });

  afterAll(async () => {
    await removeTestRows();
    if (migrationJobState) {
      await db.jobRun.update({
        where: { id: migrationJobId },
        data: migrationJobState,
      });
    }
  });

  it("serializes concurrent due callers into exactly one recurring tick", async () => {
    try {
      await db.jobRun.create({
        data: {
          jobType: JobType.INCREMENTAL_PERMIT_IMPORT,
          status: RunStatus.SUCCEEDED,
          metadata: {
            mode: "incremental",
            datasets: ["development", "building"],
            source: "scheduler",
          },
          createdAt: previousRunAt,
          completedAt: previousRunAt,
        },
      });

      const outcomes = await Promise.allSettled([
        scheduleRecurringJobs(db, { intervalMs: DEFAULT_SCHEDULER_INTERVAL_MS, now: dueAt }),
        scheduleRecurringJobs(db, { intervalMs: DEFAULT_SCHEDULER_INTERVAL_MS, now: dueAt }),
      ]);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
      const results = outcomes.map((outcome) => {
        if (outcome.status !== "fulfilled") throw new Error("Scheduler caller did not finish.");
        return outcome.value;
      });
      const enqueued = results.filter(isEnqueued);
      const waiting = results.filter((result) => result.status === "waiting");

      expect(enqueued).toHaveLength(1);
      expect(waiting).toEqual([
        { status: "waiting", nextRunAt: new Date("2100-01-03T00:00:00.000Z") },
      ]);

      const tick = enqueued[0];
      if (!tick) throw new Error("Expected one scheduler caller to enqueue a tick.");

      const persistedJobs = await db.jobRun.findMany({
        where: { id: { in: [tick.permitImportJobId, tick.dataQualityJobId] } },
        orderBy: { jobType: "asc" },
      });
      expect(persistedJobs).toHaveLength(2);
      expect(persistedJobs.map((job) => job.jobType).sort()).toEqual(
        [JobType.INCREMENTAL_PERMIT_IMPORT, JobType.DATA_QUALITY_CHECK].sort(),
      );
      expect(persistedJobs.every((job) => job.createdAt.getTime() === dueAt.getTime())).toBe(true);
    } finally {
      await removeTestRows();
    }
  });
});
