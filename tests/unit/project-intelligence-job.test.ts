import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import {
  runProjectMatchingJob,
  runProjectReclassificationJob,
} from "../../src/jobs/project-intelligence-job";
import {
  assertActiveProjectJobLease,
  matchPermitEvent,
  ProjectJobLeaseLostError,
  recomputeProject,
} from "../../src/services/project-intelligence";

vi.mock("../../src/services/project-intelligence", () => ({
  assertActiveProjectJobLease: vi.fn(),
  matchPermitEvent: vi.fn(),
  ProjectJobLeaseLostError: class ProjectJobLeaseLostError extends Error {},
  recomputeProject: vi.fn(),
}));

const mockedAssertActiveProjectJobLease = vi.mocked(assertActiveProjectJobLease);
const mockedMatchPermitEvent = vi.mocked(matchPermitEvent);
const mockedRecomputeProject = vi.mocked(recomputeProject);
const fence = { jobRunId: "job-a", leaseToken: "lease-a" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("project-intelligence background jobs", () => {
  it("continues matching after one permit fails", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "permit-a" }, { id: "permit-b" }]);
    const db = { permitEvent: { findMany } } as unknown as PrismaClient;
    mockedMatchPermitEvent
      .mockRejectedValueOnce(new Error("missing neighbourhood"))
      .mockResolvedValueOnce({ disposition: "created", projectId: "project-b" });

    await expect(runProjectMatchingJob(db, undefined, fence)).resolves.toEqual({
      processed: 2,
      successful: 1,
      failed: 1,
      failureSamples: [{ recordId: "permit-a", errorName: "Error" }],
    });
    expect(mockedMatchPermitEvent).toHaveBeenCalledTimes(2);
    expect(mockedMatchPermitEvent).toHaveBeenNthCalledWith(1, db, "permit-a", { fence });
  });

  it("reclassifies active projects independently", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "project-a" }, { id: "project-b" }]);
    const transaction = {};
    const db = {
      project: { findMany },
      $transaction: vi.fn(async (operation: (value: unknown) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;
    mockedRecomputeProject
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error("malformed project"));

    await expect(runProjectReclassificationJob(db, undefined, fence)).resolves.toEqual({
      processed: 2,
      successful: 1,
      failed: 1,
      failureSamples: [{ recordId: "project-b", errorName: "Error" }],
    });
    expect(mockedAssertActiveProjectJobLease).toHaveBeenCalledTimes(2);
    expect(mockedAssertActiveProjectJobLease).toHaveBeenCalledWith(transaction, fence);
    expect(mockedRecomputeProject).toHaveBeenCalledTimes(2);
  });

  it("stops immediately instead of recording a stale lease as a row failure", async () => {
    const db = {
      permitEvent: {
        findMany: vi.fn().mockResolvedValue([{ id: "permit-a" }, { id: "permit-b" }]),
      },
    } as unknown as PrismaClient;
    mockedMatchPermitEvent.mockRejectedValueOnce(new ProjectJobLeaseLostError("stale lease"));

    await expect(runProjectMatchingJob(db, undefined, fence)).rejects.toBeInstanceOf(
      ProjectJobLeaseLostError,
    );
    expect(mockedMatchPermitEvent).toHaveBeenCalledTimes(1);
  });
});
