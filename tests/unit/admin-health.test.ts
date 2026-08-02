import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { ImportMode, RunStatus } from "../../src/generated/prisma/enums";
import { getAdminHealth } from "../../src/services/admin/admin-health";

function databaseDouble(
  options: {
    pending?: number;
    running?: number;
    expired?: number;
    scheduledAt?: Date | null;
    quarantined?: number;
    unmatched?: number;
    pendingReviews?: number;
    marketReviews?: number;
  } = {},
): PrismaClient {
  const jobCount = vi
    .fn()
    .mockResolvedValueOnce(options.pending ?? 0)
    .mockResolvedValueOnce(options.running ?? 0)
    .mockResolvedValueOnce(options.expired ?? 0);
  const projectCount = vi
    .fn()
    .mockResolvedValueOnce(options.pendingReviews ?? 0)
    .mockResolvedValueOnce(options.marketReviews ?? 0);
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ ready: 1 }]),
    jobRun: {
      count: jobCount,
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.scheduledAt === null
            ? null
            : { createdAt: options.scheduledAt ?? new Date("2026-08-02T12:00:00.000Z") },
        ),
    },
    importRun: {
      findFirst: vi.fn().mockResolvedValue({ completedAt: new Date("2026-08-02T12:05:00.000Z") }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "run-1",
          sourceProvider: "edmonton-open-data:24uj-dj8v",
          mode: ImportMode.INCREMENTAL,
          status: RunStatus.SUCCEEDED,
          recordsFetched: 10,
          recordsCreated: 1,
          recordsUpdated: 2,
          recordsSkipped: 7,
          recordsFailed: 0,
          startedAt: new Date("2026-08-02T12:00:00.000Z"),
          completedAt: new Date("2026-08-02T12:05:00.000Z"),
        },
      ]),
    },
    rawPermitRecord: { count: vi.fn().mockResolvedValue(options.quarantined ?? 0) },
    permitEvent: { count: vi.fn().mockResolvedValue(options.unmatched ?? 0) },
    project: { count: projectCount },
  } as unknown as PrismaClient;
}

describe("administrator health read model", () => {
  it("reports only observable database state and a durable future schedule", async () => {
    const ticks = [100, 104];
    const result = await getAdminHealth(databaseDouble(), {
      now: new Date("2026-08-02T13:00:00.000Z"),
      schedulerIntervalValue: "86400000",
      monotonicNow: () => ticks.shift() ?? 104,
    });

    expect(result).toMatchObject({
      state: "ready",
      database: { status: "ready", latencyMs: 4 },
      scheduler: {
        configurationValid: true,
        nextRunAt: "2026-08-03T12:00:00.000Z",
        overdue: false,
      },
      jobs: { pending: 0, running: 0, expiredLeases: 0 },
      visibility: {
        database: "observed",
        hostAndContainers: "not-observable-from-web",
      },
    });
    expect(result.imports.recent[0]).toMatchObject({
      mode: "INCREMENTAL",
      status: "SUCCEEDED",
      completedAt: "2026-08-02T12:05:00.000Z",
    });
    expect(JSON.stringify(result)).not.toMatch(/password|dockerSocket|databaseUrl/i);
  });

  it("calls for attention on expired work, quarantines, or an overdue scheduler", async () => {
    const result = await getAdminHealth(
      databaseDouble({
        scheduledAt: new Date("2026-07-30T12:00:00.000Z"),
        running: 1,
        expired: 1,
        quarantined: 2,
      }),
      {
        now: new Date("2026-08-02T13:00:00.000Z"),
        schedulerIntervalValue: "86400000",
      },
    );

    expect(result.state).toBe("attention");
    expect(result.scheduler.overdue).toBe(true);
    expect(result.jobs.expiredLeases).toBe(1);
    expect(result.dataQuality.quarantinedRecords).toBe(2);
  });

  it("fails closed to the documented interval while flagging invalid configuration", async () => {
    const result = await getAdminHealth(databaseDouble(), {
      now: new Date("2026-08-02T13:00:00.000Z"),
      schedulerIntervalValue: "not-a-number",
    });
    expect(result.state).toBe("attention");
    expect(result.scheduler.configurationValid).toBe(false);
    expect(result.scheduler.intervalMs).toBe(86_400_000);
  });
});
