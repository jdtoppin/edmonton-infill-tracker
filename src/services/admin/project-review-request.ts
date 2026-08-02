import { z } from "zod";
import { ProjectCategory, ProjectStage, ReviewStatus } from "../../generated/prisma/enums";

export const projectIdentifierSchema = z.string().trim().min(1).max(200);
const reason = z.string().trim().min(3).max(1_000);
const expectedUpdatedAt = z.string().datetime({ offset: true });
const reviewCategory = z
  .enum(ProjectCategory)
  .refine((value) => value !== ProjectCategory.NOT_RELEVANT, {
    message: "Use the dedicated not-relevant review action.",
  });

export const adminProjectActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("override"),
      expectedUpdatedAt,
      category: reviewCategory.nullable().optional(),
      stage: z.enum(ProjectStage).nullable().optional(),
      reviewStatus: z
        .enum([ReviewStatus.PENDING, ReviewStatus.CONFIRMED, ReviewStatus.CORRECTED])
        .optional(),
      reason,
    })
    .strict()
    .refine(
      ({ category, stage, reviewStatus }) =>
        category !== undefined || stage !== undefined || reviewStatus !== undefined,
      "Choose a correction before saving.",
    ),
  z.object({ action: z.literal("not-relevant"), expectedUpdatedAt, reason }).strict(),
  z
    .object({
      action: z.literal("merge"),
      expectedUpdatedAt,
      targetProjectId: projectIdentifierSchema,
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("reassign"),
      expectedUpdatedAt,
      permitEventId: projectIdentifierSchema,
      targetProjectId: projectIdentifierSchema,
      reason,
    })
    .strict(),
]);
