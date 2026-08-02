import { z } from "zod";

import type { PrismaClient } from "../../generated/prisma/client";
import { JobType, RunStatus } from "../../generated/prisma/enums";
import type { AuthenticatedAdmin } from "../../lib/api-auth";
import { isUniqueConstraintError, permitImportConflictKey } from "../../jobs/permit-import-job";

const millisecondsPerDay = 24 * 60 * 60 * 1_000;
export const MAX_ADMIN_BACKFILL_DAYS = 366;

const civilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value &&
      value >= "2000-01-01" &&
      value <= "2100-12-31"
    );
  }, "Use a real calendar date between 2000 and 2100.");

const datasetsSchema = z
  .array(z.enum(["development", "building"]))
  .min(1)
  .max(2)
  .refine((datasets) => new Set(datasets).size === datasets.length, {
    message: "Datasets must be unique.",
  });

const incrementalImportSchema = z
  .object({
    mode: z.literal("incremental"),
    datasets: datasetsSchema,
  })
  .strict();

const backfillImportSchema = z
  .object({
    mode: z.literal("backfill"),
    datasets: datasetsSchema,
    from: civilDateSchema,
    to: civilDateSchema,
  })
  .strict()
  .superRefine(({ from, to }, context) => {
    const fromTime = Date.parse(`${from}T00:00:00.000Z`);
    const toTime = Date.parse(`${to}T00:00:00.000Z`);
    if (from > to) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "The end date must not precede the start date.",
      });
      return;
    }
    const inclusiveDays = Math.floor((toTime - fromTime) / millisecondsPerDay) + 1;
    if (inclusiveDays > MAX_ADMIN_BACKFILL_DAYS) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: `Backfills are limited to ${MAX_ADMIN_BACKFILL_DAYS} days per request.`,
      });
    }
  });

export const adminPermitImportRequestSchema = z.discriminatedUnion("mode", [
  incrementalImportSchema,
  backfillImportSchema,
]);

export type AdminPermitImportRequest = z.infer<typeof adminPermitImportRequestSchema>;

export type EnqueueAdminPermitImportResult =
  { status: "enqueued"; jobId: string } | { status: "conflict" };

/** Queues an allowlisted import; the HTTP request never performs provider work. */
export async function enqueueAdminPermitImport(
  db: PrismaClient,
  actor: AuthenticatedAdmin,
  input: unknown,
): Promise<EnqueueAdminPermitImportResult> {
  const request = adminPermitImportRequestSchema.parse(input);

  try {
    const job = await db.jobRun.create({
      data: {
        jobType: JobType.INCREMENTAL_PERMIT_IMPORT,
        status: RunStatus.PENDING,
        conflictKey: permitImportConflictKey,
        metadata: {
          mode: request.mode,
          datasets: request.datasets,
          source: "manual",
          requestedByUserId: actor.id,
          ...(request.mode === "backfill" ? { from: request.from, to: request.to } : {}),
        },
      },
      select: { id: true },
    });
    return { status: "enqueued", jobId: job.id };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { status: "conflict" };
    throw error;
  }
}
