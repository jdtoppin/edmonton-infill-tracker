import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { JobType, RunStatus } from "../../src/generated/prisma/enums";
import { ensureAddressReconciliationJob } from "../../src/jobs/address-reconciliation";
import { permitImportConflictKey } from "../../src/jobs/permit-import-job";

interface TransactionDouble {
  $queryRaw: ReturnType<typeof vi.fn>;
  permitEvent: { findFirst: ReturnType<typeof vi.fn> };
  jobRun: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

function transactionDouble(options: {
  stale?: boolean;
  activeJobType?: JobType | null;
}): TransactionDouble {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    permitEvent: {
      findFirst: vi.fn().mockResolvedValue(options.stale === false ? null : { id: "permit-a" }),
    },
    jobRun: {
      findFirst: vi
        .fn()
        .mockResolvedValue(options.activeJobType ? { jobType: options.activeJobType } : null),
      create: vi.fn().mockResolvedValue({ id: "repair-job" }),
    },
  };
}

function databaseDouble(transaction: TransactionDouble): PrismaClient {
  return {
    $transaction: vi.fn(async (operation: (value: TransactionDouble) => Promise<unknown>) =>
      operation(transaction),
    ),
  } as unknown as PrismaClient;
}

describe("durable civic-address reconciliation queue", () => {
  it("does nothing when every permit uses the current normalization version", async () => {
    const transaction = transactionDouble({ stale: false });

    await expect(ensureAddressReconciliationJob(databaseDouble(transaction))).resolves.toEqual({
      status: "not-needed",
    });

    expect(transaction.jobRun.findFirst).not.toHaveBeenCalled();
    expect(transaction.jobRun.create).not.toHaveBeenCalled();
  });

  it.each([JobType.INCREMENTAL_PERMIT_IMPORT, JobType.PROJECT_MATCHING])(
    "recognizes that an active %s stage will cover the backlog",
    async (jobType) => {
      const transaction = transactionDouble({ activeJobType: jobType });

      await expect(ensureAddressReconciliationJob(databaseDouble(transaction))).resolves.toEqual({
        status: "covered",
        jobType,
      });
      expect(transaction.jobRun.create).not.toHaveBeenCalled();
    },
  );

  it("defers behind terminal reclassification and enqueues after it clears", async () => {
    const transaction = transactionDouble({ activeJobType: JobType.PROJECT_RECLASSIFICATION });
    transaction.jobRun.findFirst
      .mockReset()
      .mockResolvedValueOnce({ jobType: JobType.PROJECT_RECLASSIFICATION })
      .mockResolvedValueOnce(null);
    const db = databaseDouble(transaction);

    await expect(ensureAddressReconciliationJob(db)).resolves.toEqual({
      status: "deferred",
      jobType: JobType.PROJECT_RECLASSIFICATION,
    });
    await expect(ensureAddressReconciliationJob(db)).resolves.toEqual({
      status: "enqueued",
      jobId: "repair-job",
    });
    expect(transaction.jobRun.create).toHaveBeenCalledOnce();
  });

  it("enqueues matching with the normal serialized pipeline key", async () => {
    const transaction = transactionDouble({});

    await expect(ensureAddressReconciliationJob(databaseDouble(transaction))).resolves.toEqual({
      status: "enqueued",
      jobId: "repair-job",
    });
    expect(transaction.permitEvent.findFirst).toHaveBeenCalledWith({
      where: { addressNormalizationVersion: { lt: 2 } },
      select: { id: true },
    });
    expect(transaction.jobRun.create).toHaveBeenCalledWith({
      data: {
        jobType: JobType.PROJECT_MATCHING,
        status: RunStatus.PENDING,
        conflictKey: permitImportConflictKey,
        metadata: {
          source: "worker-startup",
          reason: "address-normalization-backlog",
          addressNormalizationVersion: 2,
        },
      },
      select: { id: true },
    });
  });

  it("reports a remaining backlog when the worker has exhausted bounded retries", async () => {
    const transaction = transactionDouble({});

    await expect(
      ensureAddressReconciliationJob(databaseDouble(transaction), { allowEnqueue: false }),
    ).resolves.toEqual({ status: "backlog-remains" });
    expect(transaction.jobRun.create).not.toHaveBeenCalled();
  });

  it("treats a unique-key race as a deferred retry", async () => {
    const transaction = transactionDouble({});
    transaction.jobRun.create.mockRejectedValueOnce({ code: "P2002" });

    await expect(ensureAddressReconciliationJob(databaseDouble(transaction))).resolves.toEqual({
      status: "deferred",
      jobType: null,
    });
  });
});
