import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { JobType, RunStatus } from "../../src/generated/prisma/enums";
import type { ClaimedJob } from "../../src/jobs/job-lease";
import { permitImportConflictKey } from "../../src/jobs/permit-import-job";
import {
  completeProjectPipelineStage,
  nextProjectPipelineStage,
} from "../../src/jobs/project-pipeline";

function claimedJob(jobType: JobType): ClaimedJob {
  return {
    id: "job-a",
    jobType,
    status: RunStatus.RUNNING,
    conflictKey: permitImportConflictKey,
    metadata: {},
    processedCount: 0,
    successfulCount: 0,
    failedCount: 0,
    errorSummary: null,
    startedAt: new Date(),
    heartbeatAt: new Date(),
    lockExpiresAt: new Date(Date.now() + 60_000),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lockKey: "lease-a",
  };
}

const completion = {
  status: RunStatus.SUCCEEDED,
  processedCount: 2,
  successfulCount: 2,
  failedCount: 0,
  errorSummary: null,
};

describe("project pipeline handoff", () => {
  it("uses the required import, matching, reclassification order", () => {
    expect(nextProjectPipelineStage(JobType.INCREMENTAL_PERMIT_IMPORT)).toBe(
      JobType.PROJECT_MATCHING,
    );
    expect(nextProjectPipelineStage(JobType.PROJECT_MATCHING)).toBe(
      JobType.PROJECT_RECLASSIFICATION,
    );
    expect(nextProjectPipelineStage(JobType.PROJECT_RECLASSIFICATION)).toBeNull();
  });

  it("atomically enqueues matching when an owned import completes", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({});
    const transaction = { jobRun: { updateMany, create } };
    const db = {
      $transaction: vi.fn(async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;

    await expect(
      completeProjectPipelineStage(db, claimedJob(JobType.INCREMENTAL_PERMIT_IMPORT), completion),
    ).resolves.toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobType: JobType.PROJECT_MATCHING,
        conflictKey: permitImportConflictKey,
      }),
    });
  });

  it("still hands an owned failed import to matching for partial-write cleanup", async () => {
    const create = vi.fn().mockResolvedValue({});
    const transaction = {
      jobRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), create },
    };
    const db = {
      $transaction: vi.fn(async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;

    await expect(
      completeProjectPipelineStage(db, claimedJob(JobType.INCREMENTAL_PERMIT_IMPORT), {
        ...completion,
        status: RunStatus.FAILED,
        successfulCount: 1,
        failedCount: 1,
        errorSummary: "Provider failed after a partial import.",
      }),
    ).resolves.toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ jobType: JobType.PROJECT_MATCHING }),
    });
  });

  it("does not hand off after the lease token is lost", async () => {
    const create = vi.fn();
    const transaction = {
      jobRun: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), create },
    };
    const db = {
      $transaction: vi.fn(async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;

    await expect(
      completeProjectPipelineStage(db, claimedJob(JobType.PROJECT_MATCHING), completion),
    ).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
