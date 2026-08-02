import { z } from "zod";
import { JobType, RunStatus } from "../generated/prisma/enums";
import {
  allPermitDatasets,
  isUniqueConstraintError,
  permitImportConflictKey,
} from "../jobs/permit-import-job";
import { getDb } from "../lib/db";

function isCivilDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const argumentsSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isCivilDate),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isCivilDate),
    dataset: z.enum(["development", "building", "all"]).default("all"),
  })
  .refine(({ from, to }) => from <= to, { message: "The start date must be before the end date." });

function commandValues(arguments_: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--")) continue;
    const equals = argument.indexOf("=");
    if (equals > 2) {
      values[argument.slice(2, equals)] = argument.slice(equals + 1);
      continue;
    }
    const next = arguments_[index + 1];
    if (next && !next.startsWith("--")) {
      values[argument.slice(2)] = next;
      index += 1;
    }
  }
  return values;
}

const values = commandValues(process.argv.slice(2));

const parsed = argumentsSchema.safeParse(values);
if (!parsed.success) {
  console.error(
    "Usage: npm run import:backfill -- --from=2026-01-01 --to=2026-01-31 --dataset=all",
  );
  console.error(parsed.error.issues.map((issue) => issue.message).join("\n"));
  process.exitCode = 1;
} else {
  const db = await getDb();
  const datasets = parsed.data.dataset === "all" ? allPermitDatasets : [parsed.data.dataset];
  try {
    const job = await db.jobRun.create({
      data: {
        jobType: JobType.INCREMENTAL_PERMIT_IMPORT,
        status: RunStatus.PENDING,
        conflictKey: permitImportConflictKey,
        metadata: {
          mode: "backfill",
          datasets,
          from: parsed.data.from,
          to: parsed.data.to,
          source: "cli",
        },
      },
    });
    console.info(JSON.stringify({ event: "backfill.queued", jobId: job.id, datasets }));
  } catch (error) {
    console.error(
      isUniqueConstraintError(error)
        ? "Another permit import is already queued or running. Try again after it finishes."
        : "The backfill could not be queued. Check the application and database logs.",
    );
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
