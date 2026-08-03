import { createHash } from "node:crypto";

import { z } from "zod";

import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  ProjectActionType,
  ProjectCategory,
  ProjectStage,
  ReviewStatus,
  RunStatus,
  UserRole,
} from "../../generated/prisma/enums";
import { classifyInfillProject, INFILL_EVENT_ROLE } from "../../domain/infill-classification";
import { configuredInfillScoringConfig } from "../../domain/infill-scoring-config";
import { getSiteAddressKey } from "../../domain/project-matching";
import {
  buildProjectMilestones,
  determineProjectStage,
  projectEventDate,
} from "../../domain/project-timeline";

const reasonSchema = z.string().trim().min(3).max(1_000);
const identifierSchema = z.string().trim().min(1).max(200);

export class ProjectIntelligenceError extends Error {}
export class ProjectAdminRequiredError extends ProjectIntelligenceError {}
export class ProjectMergeConflictError extends ProjectIntelligenceError {}
export class ProjectJobLeaseLostError extends ProjectIntelligenceError {}

export interface ProjectMutationFence {
  jobRunId: string;
  leaseToken: string;
}

type Transaction = Prisma.TransactionClient;

/**
 * Locks the owning JobRun before a background mutation. Recovery takes the
 * same row lock, making lease expiry a hard serialization boundary rather than
 * relying on the stale worker to observe its next heartbeat.
 */
export async function assertActiveProjectJobLease(
  transaction: Transaction,
  fence: ProjectMutationFence,
): Promise<void> {
  const active = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "JobRun"
    WHERE "id" = ${fence.jobRunId}
      AND "status" = ${RunStatus.RUNNING}::"RunStatus"
      AND "lockKey" = ${fence.leaseToken}
      AND "lockExpiresAt" IS NOT NULL
      AND "lockExpiresAt" > CURRENT_TIMESTAMP
    FOR UPDATE
  `;
  if (active.length !== 1) {
    throw new ProjectJobLeaseLostError("The project-intelligence job lease is no longer active.");
  }
}

async function requireActiveAdmin(transaction: Transaction, actorUserId: string): Promise<void> {
  const actor = await transaction.user.findUnique({
    where: { id: actorUserId },
    select: { role: true, isActive: true },
  });
  if (!actor || !actor.isActive || actor.role !== UserRole.ADMIN) {
    throw new ProjectAdminRequiredError("An active administrator is required for this action.");
  }
}

async function getProjectForAggregation(transaction: Transaction, projectId: string) {
  return transaction.project.findUnique({
    where: { id: projectId },
    include: {
      neighbourhood: { select: { name: true } },
      events: {
        include: { permitEvent: true },
        orderBy: [{ eventDate: "asc" }, { permitEventId: "asc" }],
      },
    },
  });
}

type ProjectForAggregation = NonNullable<Awaited<ReturnType<typeof getProjectForAggregation>>>;

function maximum(values: Array<number | null>): number | null {
  const present = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  return present.length > 0 ? Math.max(...present) : null;
}

const marketReviewCategories = new Set<ProjectCategory>([
  ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
  ProjectCategory.PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE,
  ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
  ProjectCategory.PROBABLE_DUPLEX,
  ProjectCategory.PROBABLE_ROW_HOUSING,
  ProjectCategory.PROBABLE_GARDEN_SUITE,
]);

export function requiresMarketReview(
  category: ProjectCategory,
  latestOccupancy: Date | undefined,
  marketLastCheckedAt: Date | null,
): boolean {
  return Boolean(
    marketReviewCategories.has(category) &&
    latestOccupancy &&
    (!marketLastCheckedAt || marketLastCheckedAt < latestOccupancy),
  );
}

function calculateProjectState(project: ProjectForAggregation) {
  const permits = project.events.map(({ permitEvent }) => permitEvent);
  const milestones = buildProjectMilestones(permits);
  const config = configuredInfillScoringConfig();
  const classificationEvents = permits.map((permit) => ({
    sourceDataset:
      permit.sourceDataset === "development" || permit.sourceDataset === "building"
        ? permit.sourceDataset
        : null,
    permitType: permit.permitType,
    permitSubtype: permit.permitSubtype,
    status: permit.status,
    workDescription: permit.workDescription,
    buildingType: permit.buildingType,
    unitsAdded: permit.unitsAdded,
    constructionValue: permit.constructionValue === null ? null : Number(permit.constructionValue),
    applicationDate: permit.applicationDate,
    issueDate: permit.issueDate,
    occupancyGrantedDate: permit.occupancyGrantedDate,
    observedAt: permit.createdAt,
  }));
  const classification = classifyInfillProject(
    {
      neighbourhood: project.neighbourhood.name,
      marketListingSignal: project.marketListingStatus === "CONFIRMED_MATCH",
      events: classificationEvents,
    },
    config,
  );
  const selectedEvents = new Set(classification.episode.events);
  const episodePermits = permits.filter((_permit, index) =>
    selectedEvents.has(classificationEvents[index]!),
  );
  const estimatedUnits = maximum(episodePermits.map(({ unitsAdded }) => unitsAdded));
  const estimatedConstructionValue = maximum(
    episodePermits.map(({ constructionValue }) =>
      constructionValue === null ? null : Number(constructionValue),
    ),
  );
  const computedCategory = classification.category as ProjectCategory;
  const computedStage = determineProjectStage(episodePermits) as ProjectStage;
  const category = project.categoryOverride ?? computedCategory;
  const occupancyDates = episodePermits
    .map(({ occupancyGrantedDate }) => occupancyGrantedDate)
    .filter((date): date is Date => date !== null);
  const latestOccupancy = occupancyDates.sort((left, right) => right.getTime() - left.getTime())[0];

  return {
    milestones,
    computedCategory,
    category,
    computedStage,
    currentStage: project.stageOverride ?? computedStage,
    earliestEventDate: milestones.at(0)?.date ?? null,
    latestEventDate: milestones.at(-1)?.date ?? null,
    infillStartDate: classification.episode.infillStartDate,
    latestInfillActivityDate: classification.episode.latestInfillActivityDate,
    estimatedUnits,
    estimatedConstructionValue,
    marketReviewRequired: requiresMarketReview(
      category,
      latestOccupancy,
      project.marketLastCheckedAt,
    ),
    confidenceScore: classification.confidenceScore,
    confidenceExplanation: {
      summary: classification.plainLanguageExplanation,
      score: classification.confidenceScore,
      factors: classification.scoreExplanation.map(({ rule, points, message }) => ({
        rule,
        points,
        message,
      })),
      timeline: {
        demolitionToConstructionDays: classification.timeline.demolitionToConstructionDays,
        withinConfiguredWindow: classification.timeline.withinConfiguredWindow,
      },
      episode: {
        maxLookbackDays: config.maxEpisodeGapDays,
        infillStartDate: classification.episode.infillStartDate?.toISOString() ?? null,
        latestInfillActivityDate:
          classification.episode.latestInfillActivityDate?.toISOString() ?? null,
        includedEventCount: classification.episode.events.length,
        propertyOnlyEventCount: classification.episode.allAssessments.filter(
          ({ role }) => role === INFILL_EVENT_ROLE.propertyOnly,
        ).length,
        excludedEventCount: classification.episode.allAssessments.filter(
          ({ role }) => role === INFILL_EVENT_ROLE.excluded,
        ).length,
      },
      computedCategory,
      computedStage,
      categoryOverride: project.categoryOverride,
      stageOverride: project.stageOverride,
    },
  };
}

export async function recomputeProject(
  transaction: Transaction,
  projectId: string,
): Promise<ReturnType<typeof calculateProjectState>> {
  const project = await getProjectForAggregation(transaction, projectId);
  if (!project) throw new ProjectIntelligenceError("Project was not found.");
  if (project.mergedIntoId) {
    throw new ProjectIntelligenceError("Merged projects cannot be recomputed independently.");
  }
  for (const event of project.events) {
    const currentEventDate = projectEventDate(event.permitEvent);
    if (currentEventDate.getTime() !== event.eventDate.getTime()) {
      await transaction.projectEvent.update({
        where: { id: event.id },
        data: { eventDate: currentEventDate },
      });
    }
  }
  const state = calculateProjectState(project);
  await transaction.project.update({
    where: { id: projectId },
    data: {
      computedCategory: state.computedCategory,
      category: state.category,
      computedStage: state.computedStage,
      currentStage: state.currentStage,
      earliestEventDate: state.earliestEventDate,
      latestEventDate: state.latestEventDate,
      infillStartDate: state.infillStartDate,
      latestInfillActivityDate: state.latestInfillActivityDate,
      estimatedUnits: state.estimatedUnits,
      estimatedConstructionValue: state.estimatedConstructionValue,
      marketReviewRequired: state.marketReviewRequired,
      infillConfidence: state.confidenceScore,
      confidenceExplanation: state.confidenceExplanation,
    },
  });
  return state;
}

function automaticProjectKey(siteAddressKey: string): string {
  return `address:${createHash("sha256").update(siteAddressKey).digest("hex")}`;
}

async function matchOnePermit(transaction: Transaction, permitEventId: string) {
  const permit = await transaction.permitEvent.findUnique({
    where: { id: permitEventId },
    include: {
      address: true,
      projectEvent: { select: { projectId: true } },
    },
  });
  if (!permit) throw new ProjectIntelligenceError("Permit event was not found.");
  if (permit.projectEvent)
    return { disposition: "skipped" as const, projectId: permit.projectEvent.projectId };

  const siteAddressKey = getSiteAddressKey(permit.address);
  if (!siteAddressKey) throw new ProjectIntelligenceError("Permit address cannot be matched.");

  const candidates = await transaction.project.findMany({
    where: {
      mergedIntoId: null,
      address: { normalizedStreetAddress: permit.address.normalizedStreetAddress },
    },
    select: { id: true, addressId: true },
    orderBy: { id: "asc" },
  });
  const candidate = [...candidates].sort((left, right) => {
    const leftExact = left.addressId === permit.addressId ? 1 : 0;
    const rightExact = right.addressId === permit.addressId ? 1 : 0;
    return rightExact - leftExact || left.id.localeCompare(right.id);
  })[0];

  const neighbourhoodId = permit.neighbourhoodId ?? permit.address.neighbourhoodId;
  const projectKey = automaticProjectKey(siteAddressKey);
  const keyedProject = candidate
    ? null
    : await transaction.project.findUnique({
        where: { projectKey },
        select: { id: true, addressId: true, mergedIntoId: true },
      });
  const canonicalKeyedProject = keyedProject?.mergedIntoId
    ? await transaction.project.findUnique({
        where: { id: keyedProject.mergedIntoId },
        select: { id: true, addressId: true, mergedIntoId: true },
      })
    : keyedProject;
  if (canonicalKeyedProject?.mergedIntoId) {
    throw new ProjectIntelligenceError("The canonical address project has an invalid merge chain.");
  }
  const created = !candidate && !canonicalKeyedProject;
  if (created && !neighbourhoodId) {
    throw new ProjectIntelligenceError("A new project requires a neighbourhood assignment.");
  }
  const project =
    candidate ??
    canonicalKeyedProject ??
    (await transaction.project.create({
      data: {
        projectKey,
        addressId: permit.addressId,
        neighbourhoodId: neighbourhoodId!,
        title: `${permit.address.normalizedStreetAddress} infill activity`,
        category: ProjectCategory.NOT_RELEVANT,
        computedCategory: ProjectCategory.NOT_RELEVANT,
        currentStage: ProjectStage.DISCOVERED,
        computedStage: ProjectStage.DISCOVERED,
        confidenceExplanation: {
          summary: "Awaiting project aggregation.",
          score: 0,
          factors: [],
        },
      },
      select: { id: true, addressId: true },
    }));

  await transaction.projectEvent.create({
    data: {
      projectId: project.id,
      permitEventId: permit.id,
      eventDate: projectEventDate(permit),
      matchReason: {
        strategy: "normalized-site-address",
        siteAddressKey,
        automated: true,
      },
    },
  });
  await recomputeProject(transaction, project.id);
  return {
    disposition: created ? ("created" as const) : ("matched" as const),
    projectId: project.id,
  };
}

export interface MatchPermitEventsResult {
  processed: number;
  created: number;
  matched: number;
  skipped: number;
  failed: number;
  failures: Array<{ permitEventId: string; error: string }>;
}

export async function matchPermitEvent(
  db: PrismaClient,
  permitEventId: string,
  options: { fence?: ProjectMutationFence } = {},
) {
  const id = identifierSchema.parse(permitEventId);
  return db.$transaction(
    async (transaction) => {
      if (options.fence) await assertActiveProjectJobLease(transaction, options.fence);
      return matchOnePermit(transaction, id);
    },
    { isolationLevel: "Serializable" },
  );
}

export async function matchUnassignedPermitEvents(
  db: PrismaClient,
  options: { limit?: number } = {},
): Promise<MatchPermitEventsResult> {
  const limit = z
    .number()
    .int()
    .min(1)
    .max(1_000)
    .parse(options.limit ?? 100);
  const permits = await db.permitEvent.findMany({
    where: { projectEvent: null },
    select: { id: true },
    orderBy: [{ importedAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  const result: MatchPermitEventsResult = {
    processed: 0,
    created: 0,
    matched: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  for (const { id } of permits) {
    result.processed += 1;
    try {
      const matched = await db.$transaction((transaction) => matchOnePermit(transaction, id), {
        isolationLevel: "Serializable",
      });
      result[matched.disposition] += 1;
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        permitEventId: id,
        error:
          error instanceof Error ? error.message.slice(0, 500) : "Unknown project match failure.",
      });
    }
  }
  return result;
}

const overrideSchema = z
  .object({
    projectId: identifierSchema,
    actorUserId: identifierSchema,
    reason: reasonSchema,
    category: z.enum(ProjectCategory).nullable().optional(),
    stage: z.enum(ProjectStage).nullable().optional(),
    reviewStatus: z
      .enum([ReviewStatus.PENDING, ReviewStatus.CONFIRMED, ReviewStatus.CORRECTED])
      .optional(),
  })
  .refine(
    ({ category, stage, reviewStatus }) =>
      category !== undefined || stage !== undefined || reviewStatus !== undefined,
    "At least one manual project change is required.",
  );

export async function setProjectManualOverride(
  db: PrismaClient,
  input: z.input<typeof overrideSchema>,
): Promise<void> {
  const parsed = overrideSchema.parse(input);
  await db.$transaction(
    async (transaction) => {
      await requireActiveAdmin(transaction, parsed.actorUserId);
      const project = await transaction.project.findUnique({ where: { id: parsed.projectId } });
      if (!project || project.mergedIntoId) {
        throw new ProjectIntelligenceError("An active project is required for an override.");
      }
      const categoryOverride =
        parsed.category === undefined ? project.categoryOverride : parsed.category;
      const stageOverride = parsed.stage === undefined ? project.stageOverride : parsed.stage;
      const leavesNotRelevantDecision =
        project.reviewStatus === ReviewStatus.NOT_RELEVANT &&
        parsed.category !== undefined &&
        categoryOverride !== ProjectCategory.NOT_RELEVANT;
      const reviewStatus =
        parsed.reviewStatus ??
        (leavesNotRelevantDecision ? ReviewStatus.CORRECTED : project.reviewStatus);
      await transaction.project.update({
        where: { id: project.id },
        data: {
          categoryOverride,
          category: categoryOverride ?? project.computedCategory,
          stageOverride,
          currentStage: stageOverride ?? project.computedStage,
          reviewStatus,
          reviewedById: parsed.actorUserId,
          reviewedAt: new Date(),
          reviewNotes: parsed.reason,
        },
      });
      await recomputeProject(transaction, project.id);
      await transaction.projectAction.create({
        data: {
          actionType: ProjectActionType.MANUAL_OVERRIDE,
          projectId: project.id,
          actorUserId: parsed.actorUserId,
          reason: parsed.reason,
          details: {
            before: {
              categoryOverride: project.categoryOverride,
              stageOverride: project.stageOverride,
              reviewStatus: project.reviewStatus,
            },
            after: { categoryOverride, stageOverride, reviewStatus },
          },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function markProjectNotRelevant(
  db: PrismaClient,
  input: { projectId: string; actorUserId: string; reason: string },
): Promise<void> {
  const parsed = z
    .object({ projectId: identifierSchema, actorUserId: identifierSchema, reason: reasonSchema })
    .parse(input);
  await db.$transaction(
    async (transaction) => {
      await requireActiveAdmin(transaction, parsed.actorUserId);
      const project = await transaction.project.findUnique({ where: { id: parsed.projectId } });
      if (!project || project.mergedIntoId) {
        throw new ProjectIntelligenceError("An active project is required for review.");
      }
      await transaction.project.update({
        where: { id: project.id },
        data: {
          categoryOverride: ProjectCategory.NOT_RELEVANT,
          category: ProjectCategory.NOT_RELEVANT,
          reviewStatus: ReviewStatus.NOT_RELEVANT,
          reviewedById: parsed.actorUserId,
          reviewedAt: new Date(),
          reviewNotes: parsed.reason,
          marketReviewRequired: false,
        },
      });
      await recomputeProject(transaction, project.id);
      await transaction.projectAction.create({
        data: {
          actionType: ProjectActionType.MARKED_NOT_RELEVANT,
          projectId: project.id,
          actorUserId: parsed.actorUserId,
          reason: parsed.reason,
          details: {
            before: { category: project.category, reviewStatus: project.reviewStatus },
            after: {
              category: ProjectCategory.NOT_RELEVANT,
              reviewStatus: ReviewStatus.NOT_RELEVANT,
            },
          },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function reassignPermitEvent(
  db: PrismaClient,
  input: { permitEventId: string; targetProjectId: string; actorUserId: string; reason: string },
): Promise<void> {
  const parsed = z
    .object({
      permitEventId: identifierSchema,
      targetProjectId: identifierSchema,
      actorUserId: identifierSchema,
      reason: reasonSchema,
    })
    .parse(input);
  await db.$transaction(
    async (transaction) => {
      await requireActiveAdmin(transaction, parsed.actorUserId);
      const link = await transaction.projectEvent.findUnique({
        where: { permitEventId: parsed.permitEventId },
      });
      const target = await transaction.project.findUnique({
        where: { id: parsed.targetProjectId },
      });
      if (!link) throw new ProjectIntelligenceError("Permit event is not assigned to a project.");
      if (!target || target.mergedIntoId) {
        throw new ProjectIntelligenceError("The target must be an active project.");
      }
      if (link.projectId === target.id) {
        throw new ProjectIntelligenceError(
          "Permit event is already assigned to the target project.",
        );
      }

      await transaction.projectEvent.update({
        where: { permitEventId: parsed.permitEventId },
        data: {
          projectId: target.id,
          linkedAt: new Date(),
          matchReason: {
            strategy: "manual-reassignment",
            automated: false,
          },
        },
      });
      await recomputeProject(transaction, link.projectId);
      await recomputeProject(transaction, target.id);
      await transaction.projectAction.create({
        data: {
          actionType: ProjectActionType.EVENT_REASSIGNED,
          projectId: link.projectId,
          relatedProjectId: target.id,
          permitEventId: parsed.permitEventId,
          actorUserId: parsed.actorUserId,
          reason: parsed.reason,
          details: { fromProjectId: link.projectId, toProjectId: target.id },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function mergeProjects(
  db: PrismaClient,
  input: { sourceProjectId: string; targetProjectId: string; actorUserId: string; reason: string },
): Promise<void> {
  const parsed = z
    .object({
      sourceProjectId: identifierSchema,
      targetProjectId: identifierSchema,
      actorUserId: identifierSchema,
      reason: reasonSchema,
    })
    .parse(input);
  if (parsed.sourceProjectId === parsed.targetProjectId) {
    throw new ProjectMergeConflictError("A project cannot be merged into itself.");
  }

  await db.$transaction(
    async (transaction) => {
      await requireActiveAdmin(transaction, parsed.actorUserId);
      const [source, target] = await Promise.all([
        transaction.project.findUnique({ where: { id: parsed.sourceProjectId } }),
        transaction.project.findUnique({ where: { id: parsed.targetProjectId } }),
      ]);
      if (!source || !target) throw new ProjectMergeConflictError("Both projects must exist.");
      if (source.mergedIntoId) {
        throw new ProjectMergeConflictError("The source project has already been merged.");
      }
      if (target.mergedIntoId) {
        throw new ProjectMergeConflictError("A merged project cannot be used as a merge target.");
      }

      const movedEvents = await transaction.projectEvent.updateMany({
        where: { projectId: source.id },
        data: { projectId: target.id, linkedAt: new Date() },
      });
      await transaction.alertEvent.updateMany({
        where: { projectId: source.id },
        data: { projectId: target.id },
      });
      await transaction.project.updateMany({
        where: { mergedIntoId: source.id },
        data: { mergedIntoId: target.id },
      });
      await transaction.project.update({
        where: { id: source.id },
        data: {
          mergedIntoId: target.id,
          reviewStatus: ReviewStatus.MERGED,
          reviewedById: parsed.actorUserId,
          reviewedAt: new Date(),
          reviewNotes: parsed.reason,
          marketReviewRequired: false,
        },
      });
      await recomputeProject(transaction, target.id);
      await transaction.projectAction.create({
        data: {
          actionType: ProjectActionType.PROJECT_MERGED,
          projectId: source.id,
          relatedProjectId: target.id,
          actorUserId: parsed.actorUserId,
          reason: parsed.reason,
          details: {
            sourceProjectId: source.id,
            targetProjectId: target.id,
            movedEvents: movedEvents.count,
          },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function previewProjectScoring(
  db: PrismaClient,
  input: { projectId: string; actorUserId: string },
) {
  const parsed = z
    .object({ projectId: identifierSchema, actorUserId: identifierSchema })
    .parse(input);
  return db.$transaction(async (transaction) => {
    await requireActiveAdmin(transaction, parsed.actorUserId);
    const project = await getProjectForAggregation(transaction, parsed.projectId);
    if (!project || project.mergedIntoId) {
      throw new ProjectIntelligenceError("An active project is required for scoring preview.");
    }
    return calculateProjectState(project);
  });
}
