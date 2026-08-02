import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { JobType, RunStatus } from "../../src/generated/prisma/enums";
import type { AuthenticatedAdmin } from "../../src/lib/api-auth";
import { permitImportConflictKey } from "../../src/jobs/permit-import-job";
import {
  adminPermitImportRequestSchema,
  enqueueAdminPermitImport,
  MAX_ADMIN_BACKFILL_DAYS,
} from "../../src/services/admin/import-operations";

const admin: AuthenticatedAdmin = {
  id: "admin-1",
  email: "admin@example.test",
  name: "Admin",
  role: "ADMIN",
};

describe("administrator permit-import operations", () => {
  it("accepts a bounded incremental request and rejects injected actor fields", () => {
    expect(
      adminPermitImportRequestSchema.parse({
        mode: "incremental",
        datasets: ["development", "building"],
      }),
    ).toEqual({ mode: "incremental", datasets: ["development", "building"] });

    expect(
      adminPermitImportRequestSchema.safeParse({
        mode: "incremental",
        datasets: ["development"],
        actorUserId: "forged-admin",
      }).success,
    ).toBe(false);
    expect(
      adminPermitImportRequestSchema.safeParse({
        mode: "incremental",
        datasets: ["building", "building"],
      }).success,
    ).toBe(false);
  });

  it("rejects invalid, reversed, and oversized historical ranges", () => {
    expect(
      adminPermitImportRequestSchema.safeParse({
        mode: "backfill",
        datasets: ["building"],
        from: "2026-02-30",
        to: "2026-03-01",
      }).success,
    ).toBe(false);
    expect(
      adminPermitImportRequestSchema.safeParse({
        mode: "backfill",
        datasets: ["development"],
        from: "2026-03-02",
        to: "2026-03-01",
      }).success,
    ).toBe(false);
    expect(
      adminPermitImportRequestSchema.safeParse({
        mode: "backfill",
        datasets: ["development"],
        from: "2025-01-01",
        to: "2026-01-02",
      }).success,
    ).toBe(false);
    expect(MAX_ADMIN_BACKFILL_DAYS).toBe(366);
  });

  it("queues only the allowlisted job and records the session actor in metadata", async () => {
    const create = vi.fn().mockResolvedValue({ id: "job-1" });
    const db = { jobRun: { create } } as unknown as PrismaClient;

    await expect(
      enqueueAdminPermitImport(db, admin, {
        mode: "backfill",
        datasets: ["building"],
        from: "2026-01-01",
        to: "2026-01-31",
      }),
    ).resolves.toEqual({ status: "enqueued", jobId: "job-1" });

    expect(create).toHaveBeenCalledWith({
      data: {
        jobType: JobType.INCREMENTAL_PERMIT_IMPORT,
        status: RunStatus.PENDING,
        conflictKey: permitImportConflictKey,
        metadata: {
          mode: "backfill",
          datasets: ["building"],
          source: "manual",
          requestedByUserId: admin.id,
          from: "2026-01-01",
          to: "2026-01-31",
        },
      },
      select: { id: true },
    });
  });

  it("turns the durable unique conflict into a safe conflict result", async () => {
    const db = {
      jobRun: { create: vi.fn().mockRejectedValue({ code: "P2002" }) },
    } as unknown as PrismaClient;

    await expect(
      enqueueAdminPermitImport(db, admin, {
        mode: "incremental",
        datasets: ["development"],
      }),
    ).resolves.toEqual({ status: "conflict" });
  });
});
