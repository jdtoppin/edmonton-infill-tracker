import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { ImportMode, JobType, RunStatus } from "../../src/generated/prisma/enums";
import { claimNextJob, extendJobLease, recoverExpiredJobs } from "../../src/jobs/job-lease";
import { getDb } from "../../src/lib/db";
import {
  PermitImportFenceError,
  PrismaPermitImportRepository,
} from "../../src/services/permit-import/prisma-repository";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("durable job leases", () => {
  const suffix = randomUUID();
  const conflictKey = `integration-job:${suffix}`;
  const sourceProvider = `integration-provider:${suffix}`;
  const unrelatedSourceProvider = `integration-provider-unrelated:${suffix}`;
  const staleLeaseToken = `expired:${suffix}`;
  let db: PrismaClient;
  let jobId: string;
  let importRunId: string;
  let unrelatedJobId: string;
  let unrelatedImportRunId: string;
  let staleRepository: PrismaPermitImportRepository;

  beforeAll(async () => {
    db = await getDb();
    const job = await db.jobRun.create({
      data: {
        jobType: JobType.INCREMENTAL_PERMIT_IMPORT,
        status: RunStatus.RUNNING,
        lockKey: staleLeaseToken,
        conflictKey,
        heartbeatAt: new Date("2026-01-01T00:00:00.000Z"),
        lockExpiresAt: new Date("2026-01-01T00:01:00.000Z"),
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        metadata: { mode: "incremental", datasets: ["building"], source: "manual" },
      },
    });
    jobId = job.id;
    const importRun = await db.importRun.create({
      data: {
        sourceProvider,
        activeKey: sourceProvider,
        jobRunId: job.id,
        leaseToken: staleLeaseToken,
        mode: ImportMode.INCREMENTAL,
        status: RunStatus.RUNNING,
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    importRunId = importRun.id;
    staleRepository = new PrismaPermitImportRepository(db, {
      jobRunId: job.id,
      leaseToken: staleLeaseToken,
    });

    const unrelatedJob = await db.jobRun.create({
      data: {
        jobType: JobType.INCREMENTAL_PERMIT_IMPORT,
        status: RunStatus.RUNNING,
        lockKey: `current:${suffix}`,
        conflictKey: `integration-job-unrelated:${suffix}`,
        heartbeatAt: new Date("2026-01-01T00:04:30.000Z"),
        lockExpiresAt: new Date("2026-01-01T00:10:00.000Z"),
        startedAt: new Date("2026-01-01T00:04:00.000Z"),
        metadata: { mode: "incremental", datasets: ["development"], source: "manual" },
      },
    });
    unrelatedJobId = unrelatedJob.id;
    const unrelatedImportRun = await db.importRun.create({
      data: {
        sourceProvider: unrelatedSourceProvider,
        activeKey: unrelatedSourceProvider,
        jobRunId: unrelatedJob.id,
        leaseToken: `current:${suffix}`,
        mode: ImportMode.INCREMENTAL,
        status: RunStatus.RUNNING,
        startedAt: new Date("2026-01-01T00:04:00.000Z"),
      },
    });
    unrelatedImportRunId = unrelatedImportRun.id;
  });

  afterAll(async () => {
    await db.rawPermitRecord.deleteMany({
      where: { sourceProvider: { in: [sourceProvider, unrelatedSourceProvider] } },
    });
    await db.importRun.deleteMany({
      where: { sourceProvider: { in: [sourceProvider, unrelatedSourceProvider] } },
    });
    await db.jobRun.deleteMany({ where: { id: { in: [jobId, unrelatedJobId] } } });
  });

  it("reclaims a crashed worker, fences overlaps, and renews the new lease", async () => {
    const now = new Date("2026-01-01T00:05:00.000Z");
    const recovered = await recoverExpiredJobs(db, now);
    expect(recovered).toMatchObject({ jobs: 1, imports: 1 });

    const staleImport = await db.importRun.findUniqueOrThrow({ where: { id: importRunId } });
    expect(staleImport).toMatchObject({ status: RunStatus.FAILED, activeKey: null });

    const unrelatedImport = await db.importRun.findUniqueOrThrow({
      where: { id: unrelatedImportRunId },
    });
    expect(unrelatedImport).toMatchObject({
      status: RunStatus.RUNNING,
      activeKey: unrelatedSourceProvider,
    });

    await expect(
      staleRepository.stageRawRecord({
        runId: importRunId,
        sourceProviderKey: sourceProvider,
        checksum: "stale-checksum",
        rawRecord: {
          sourceProvider: "edmonton-open-data",
          sourceDataset: "building",
          sourceDatasetId: "24uj-dj8v",
          sourceRecordIdentifier: "stale-write",
          systemId: "stale-system-id",
          sourceUpdatedAt: null,
          payload: { row_id: "stale-write" },
        },
      }),
    ).rejects.toBeInstanceOf(PermitImportFenceError);
    await expect(
      staleRepository.completeRun({
        runId: importRunId,
        status: "SUCCEEDED",
        counts: { fetched: 1, created: 1, updated: 0, skipped: 0, failed: 0 },
        endCursor: "stale-cursor",
        errorSummary: null,
      }),
    ).rejects.toBeInstanceOf(PermitImportFenceError);
    expect(
      await db.rawPermitRecord.findUnique({
        where: {
          sourceProvider_sourceRecordIdentifier: {
            sourceProvider,
            sourceRecordIdentifier: "stale-write",
          },
        },
      }),
    ).toBeNull();

    await expect(
      db.jobRun.create({
        data: {
          jobType: JobType.INCREMENTAL_PERMIT_IMPORT,
          status: RunStatus.PENDING,
          conflictKey,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    const claimed = await claimNextJob(db, {
      leaseMs: 120_000,
      workerName: "integration-worker",
      now,
    });
    expect(claimed?.id).toBe(jobId);
    expect(claimed?.lockKey).toMatch(/^integration-worker:/);
    if (!claimed) throw new Error("Expected the recovered job to be claimed.");

    expect(
      await extendJobLease(
        db,
        { id: claimed.id, lockKey: "wrong-fencing-token" },
        120_000,
        new Date("2026-01-01T00:06:00.000Z"),
      ),
    ).toBe(false);
    expect(await extendJobLease(db, claimed, 120_000, new Date("2026-01-01T00:06:00.000Z"))).toBe(
      true,
    );

    const renewed = await db.jobRun.findUniqueOrThrow({ where: { id: jobId } });
    expect(renewed.lockExpiresAt?.toISOString()).toBe("2026-01-01T00:08:00.000Z");
  });
});
