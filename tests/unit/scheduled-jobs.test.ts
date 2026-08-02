import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { JobType, RunStatus } from "../../src/generated/prisma/enums";
import { dataQualityConflictKey, permitImportConflictKey } from "../../src/jobs/permit-import-job";
import {
  DEFAULT_SCHEDULER_CONFLICT_RETRY_MS,
  DEFAULT_SCHEDULER_INTERVAL_MS,
  MAXIMUM_SCHEDULER_INTERVAL_MS,
  MINIMUM_SCHEDULER_INTERVAL_MS,
  scheduleRecurringJobs,
} from "../../src/jobs/scheduled-jobs";

interface TransactionDouble {
  $queryRaw: ReturnType<typeof vi.fn>;
  jobRun: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

function databaseDouble(transaction: TransactionDouble): PrismaClient {
  return {
    $transaction: vi.fn(async (operation: (value: TransactionDouble) => Promise<unknown>) =>
      operation(transaction),
    ),
  } as unknown as PrismaClient;
}

function transactionDouble(
  latestScheduledImport: { createdAt: Date } | null,
  activeConflict: { conflictKey: string | null } | null = null,
): TransactionDouble {
  const findFirst = vi
    .fn()
    .mockResolvedValueOnce(latestScheduledImport)
    .mockResolvedValueOnce(activeConflict);
  const create = vi.fn(async ({ data }: { data: { jobType: JobType } }) => ({
    id:
      data.jobType === JobType.INCREMENTAL_PERMIT_IMPORT
        ? "scheduled-import"
        : "scheduled-data-quality",
  }));
  return { $queryRaw: vi.fn().mockResolvedValue([]), jobRun: { findFirst, create } };
}

describe("durable recurring-job scheduling", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");

  it("enqueues the first import and data-quality check immediately in one transaction", async () => {
    const transaction = transactionDouble(null);
    const db = databaseDouble(transaction);

    await expect(scheduleRecurringJobs(db, { now })).resolves.toEqual({
      status: "enqueued",
      nextRunAt: new Date("2026-08-03T12:00:00.000Z"),
      permitImportJobId: "scheduled-import",
      dataQualityJobId: "scheduled-data-quality",
    });

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    const [queryParts, lockName] = transaction.$queryRaw.mock.calls[0] as unknown as [
      readonly string[],
      string,
    ];
    expect(queryParts.join("?")).toContain("pg_advisory_xact_lock");
    expect(lockName).toBe("edmonton-infill-tracker:scheduler:permit-import");
    expect(transaction.jobRun.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        jobType: JobType.INCREMENTAL_PERMIT_IMPORT,
        metadata: { path: ["source"], equals: "scheduler" },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    expect(transaction.jobRun.create).toHaveBeenNthCalledWith(1, {
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
    expect(transaction.jobRun.create).toHaveBeenNthCalledWith(2, {
      data: {
        jobType: JobType.DATA_QUALITY_CHECK,
        status: RunStatus.PENDING,
        conflictKey: dataQualityConflictKey,
        metadata: { source: "scheduler" },
        createdAt: now,
      },
      select: { id: true },
    });
  });

  it("uses the persisted scheduler-origin import time after a restart", async () => {
    const previousRun = new Date("2026-08-02T06:00:00.000Z");
    const transaction = transactionDouble({ createdAt: previousRun });

    await expect(scheduleRecurringJobs(databaseDouble(transaction), { now })).resolves.toEqual({
      status: "waiting",
      nextRunAt: new Date("2026-08-03T06:00:00.000Z"),
    });

    expect(transaction.jobRun.findFirst).toHaveBeenCalledOnce();
    expect(transaction.jobRun.create).not.toHaveBeenCalled();
  });

  it("starts a fresh daily cadence from now when the persisted run is overdue", async () => {
    const transaction = transactionDouble({
      createdAt: new Date("2026-07-31T12:00:00.000Z"),
    });

    const result = await scheduleRecurringJobs(databaseDouble(transaction), { now });

    expect(result).toMatchObject({
      status: "enqueued",
      nextRunAt: new Date("2026-08-03T12:00:00.000Z"),
    });
    expect(transaction.jobRun.create).toHaveBeenCalledTimes(2);
  });

  it("backs off for a bounded interval while a conflicting pipeline is active", async () => {
    const transaction = transactionDouble(
      { createdAt: new Date("2026-07-31T12:00:00.000Z") },
      { conflictKey: permitImportConflictKey },
    );

    await expect(scheduleRecurringJobs(databaseDouble(transaction), { now })).resolves.toEqual({
      status: "blocked",
      nextRunAt: new Date(now.getTime() + DEFAULT_SCHEDULER_CONFLICT_RETRY_MS),
    });
    expect(transaction.jobRun.create).not.toHaveBeenCalled();
  });

  it("treats a unique-key race outside the advisory-lock cohort as a bounded conflict", async () => {
    const transaction = transactionDouble(null);
    transaction.jobRun.create.mockRejectedValueOnce({ code: "P2002" });

    await expect(scheduleRecurringJobs(databaseDouble(transaction), { now })).resolves.toEqual({
      status: "blocked",
      nextRunAt: new Date(now.getTime() + DEFAULT_SCHEDULER_CONFLICT_RETRY_MS),
    });
  });

  it.each([
    0,
    -1,
    MINIMUM_SCHEDULER_INTERVAL_MS - 1,
    Number.NaN,
    MAXIMUM_SCHEDULER_INTERVAL_MS + 1,
  ])("rejects an unsafe scheduler interval (%s)", async (intervalMs) => {
    const transaction = transactionDouble(null);
    await expect(
      scheduleRecurringJobs(databaseDouble(transaction), { intervalMs, now }),
    ).rejects.toThrow("Scheduler interval must be a whole number");
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });

  it("preserves a supported custom scheduler interval longer than one timer chunk", async () => {
    const transaction = transactionDouble(null);
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1_000;

    await expect(
      scheduleRecurringJobs(databaseDouble(transaction), { intervalMs: thirtyDaysMs, now }),
    ).resolves.toMatchObject({
      status: "enqueued",
      nextRunAt: new Date(now.getTime() + thirtyDaysMs),
    });
  });

  it("defaults to a 24-hour interval", () => {
    expect(DEFAULT_SCHEDULER_INTERVAL_MS).toBe(86_400_000);
  });
});
