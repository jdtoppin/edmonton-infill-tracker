import { z } from "zod";

import { permitDatasetSchema, type PermitDataset } from "../providers";

const civilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Expected a valid YYYY-MM-DD date.");

export const permitImportJobMetadataSchema = z
  .object({
    mode: z.enum(["incremental", "backfill"]),
    datasets: z.array(permitDatasetSchema).min(1).max(2),
    from: civilDateSchema.nullish(),
    to: civilDateSchema.nullish(),
    source: z.enum(["scheduler", "cli", "manual"]).default("manual"),
  })
  .superRefine((value, context) => {
    if (new Set(value.datasets).size !== value.datasets.length) {
      context.addIssue({ code: "custom", path: ["datasets"], message: "Datasets must be unique." });
    }
    if (value.mode === "backfill" && (!value.from || !value.to)) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "Backfill jobs require both from and to dates.",
      });
    }
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "The end date must not precede the start date.",
      });
    }
  });

export type PermitImportJobMetadata = z.infer<typeof permitImportJobMetadataSchema>;

export function parsePermitImportJobMetadata(value: unknown): PermitImportJobMetadata {
  return permitImportJobMetadataSchema.parse(value);
}

export function jobDate(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

export const allPermitDatasets: readonly PermitDataset[] = ["development", "building"];
/** One key serializes the import -> matching -> reclassification pipeline. */
export const permitImportConflictKey = "job:permit-project-pipeline";
export const projectMatchingConflictKey = permitImportConflictKey;
export const projectReclassificationConflictKey = permitImportConflictKey;
export const dataQualityConflictKey = "job:data-quality";

export function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002",
  );
}
