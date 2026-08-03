import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import {
  ProjectActionType,
  ProjectCategory,
  ProjectStage,
  InfillAreaClassification,
  ReviewStatus,
  JobType,
  RunStatus,
  UserRole,
} from "../../src/generated/prisma/enums";
import { getDb } from "../../src/lib/db";
import {
  markProjectNotRelevant,
  matchPermitEvent,
  mergeProjects,
  previewProjectScoring,
  ProjectAdminRequiredError,
  ProjectJobLeaseLostError,
  ProjectMergeConflictError,
  reassignPermitEvent,
  recomputeProject,
  setProjectManualOverride,
} from "../../src/services/project-intelligence";
import { getProjectDetail } from "../../src/services/project-read-model";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("persisted project intelligence", () => {
  const suffix = randomUUID();
  const provider = `project-intelligence:${suffix}`;
  let db: PrismaClient;
  let adminUserId: string;
  let standardUserId: string;
  let neighbourhoodId: string;
  let firstAddressId: string;
  let secondAddressId: string;
  let demolitionPermitId: string;
  let buildingPermitId: string;
  let projectId: string;
  let duplicateProjectId: string;

  beforeAll(async () => {
    db = await getDb();
    const admin = await db.user.create({
      data: {
        email: `phase3-admin-${suffix}@example.test`,
        normalizedEmail: `phase3-admin-${suffix}@example.test`,
        passwordHash: "synthetic-test-hash",
        role: UserRole.ADMIN,
      },
    });
    adminUserId = admin.id;
    const standard = await db.user.create({
      data: {
        email: `phase3-user-${suffix}@example.test`,
        normalizedEmail: `phase3-user-${suffix}@example.test`,
        passwordHash: "synthetic-test-hash",
        role: UserRole.USER,
      },
    });
    standardUserId = standard.id;
    const neighbourhood = await db.neighbourhood.create({
      data: { cityNeighbourhoodId: `phase3-${suffix}`, name: "Synthetic Phase 3" },
    });
    neighbourhoodId = neighbourhood.id;
    const firstAddress = await db.address.create({
      data: {
        rawSourceAddress: "1-12345 67 STREET NW",
        normalizedStreetAddress: "12345 67 ST NW",
        normalizedAddressKey: `edmonton|ab|12345 67 st nw|unit:1|${suffix}`,
        unitNumber: "1",
        neighbourhoodId,
      },
    });
    firstAddressId = firstAddress.id;
    const secondAddress = await db.address.create({
      data: {
        rawSourceAddress: "2-12345 67 STREET NW",
        normalizedStreetAddress: "12345 67 ST NW",
        normalizedAddressKey: `edmonton|ab|12345 67 st nw|unit:2|${suffix}`,
        unitNumber: "2",
        latitude: 53.552234,
        longitude: -113.540089,
        neighbourhoodId,
      },
    });
    secondAddressId = secondAddress.id;

    const demolition = await db.permitEvent.create({
      data: {
        sourceProvider: provider,
        sourceRecordIdentifier: "demolition",
        permitType: "Demolition Permit",
        status: "Issued",
        workDescription: "Demolish the existing detached dwelling",
        issueDate: new Date("2026-01-15T00:00:00.000Z"),
        addressId: firstAddressId,
        neighbourhoodId,
        rawSourcePayload: { synthetic: true, kind: "demolition" },
      },
    });
    demolitionPermitId = demolition.id;
    const building = await db.permitEvent.create({
      data: {
        sourceProvider: provider,
        sourceRecordIdentifier: "building",
        permitType: "Building Permit",
        permitSubtype: "New",
        status: "Issued",
        workDescription: "Construct a new semi-detached dwelling",
        buildingType: "Semi-detached residential",
        constructionValue: "750000.00",
        unitsAdded: 2,
        applicationDate: new Date("2026-02-01T00:00:00.000Z"),
        issueDate: new Date("2026-03-01T00:00:00.000Z"),
        occupancyGrantedDate: new Date("2026-08-01T00:00:00.000Z"),
        addressId: secondAddressId,
        neighbourhoodId,
        rawSourcePayload: { synthetic: true, kind: "building" },
      },
    });
    buildingPermitId = building.id;
  });

  it("rejects project mutations after the owning job lease expires", async () => {
    const job = await db.jobRun.create({
      data: {
        jobType: JobType.PROJECT_MATCHING,
        status: RunStatus.RUNNING,
        lockKey: `expired:${suffix}`,
        lockExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
        metadata: { synthetic: true },
      },
    });
    try {
      await expect(
        matchPermitEvent(db, demolitionPermitId, {
          fence: { jobRunId: job.id, leaseToken: `expired:${suffix}` },
        }),
      ).rejects.toBeInstanceOf(ProjectJobLeaseLostError);
      await expect(
        db.projectEvent.findUnique({ where: { permitEventId: demolitionPermitId } }),
      ).resolves.toBeNull();
    } finally {
      await db.jobRun.delete({ where: { id: job.id } });
    }
  });

  afterAll(async () => {
    await db.projectAction.deleteMany({
      where: { actorUserId: { in: [adminUserId, standardUserId] } },
    });
    const projectIds = [projectId, duplicateProjectId].filter(
      (id): id is string => typeof id === "string",
    );
    if (projectIds.length > 0) {
      await db.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    await db.permitEvent.deleteMany({ where: { sourceProvider: provider } });
    await db.address.deleteMany({ where: { id: { in: [firstAddressId, secondAddressId] } } });
    await db.neighbourhood.deleteMany({ where: { id: neighbourhoodId } });
    await db.user.deleteMany({ where: { id: { in: [adminUserId, standardUserId] } } });
  });

  it("matches physical-address permits idempotently and persists chronological occupancy state", async () => {
    const first = await matchPermitEvent(db, demolitionPermitId);
    expect(first.disposition).toBe("created");
    if (!first.projectId) throw new Error("Synthetic demolition permit was not matched.");
    projectId = first.projectId;

    const second = await matchPermitEvent(db, buildingPermitId);
    expect(second).toMatchObject({ disposition: "matched", projectId });
    expect(await matchPermitEvent(db, buildingPermitId)).toMatchObject({
      disposition: "skipped",
      projectId,
    });

    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { events: { orderBy: { eventDate: "asc" } } },
    });
    expect(project.events.map(({ permitEventId }) => permitEventId)).toEqual([
      demolitionPermitId,
      buildingPermitId,
    ]);
    expect(project).toMatchObject({
      category: ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
      computedCategory: ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
      currentStage: ProjectStage.COMPLETE,
      computedStage: ProjectStage.COMPLETE,
      estimatedUnits: 2,
      marketReviewRequired: true,
      infillAreaClassification: InfillAreaClassification.CORE,
    });
    expect(project.earliestEventDate?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(project.latestEventDate?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(project.infillStartDate?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(project.latestInfillActivityDate?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(project.confidenceExplanation).toMatchObject({
      geography: {
        classification: InfillAreaClassification.CORE,
        coordinateSource: "LINKED_PERMIT_ADDRESSES",
      },
    });

    await db.permitEvent.update({
      where: { id: buildingPermitId },
      data: { issueDate: new Date("2026-03-05T00:00:00.000Z") },
    });
    await db.$transaction((transaction) => recomputeProject(transaction, projectId));
    const refreshedLink = await db.projectEvent.findUniqueOrThrow({
      where: { permitEventId: buildingPermitId },
    });
    expect(refreshedLink.eventDate.toISOString()).toBe("2026-03-05T00:00:00.000Z");

    const preview = await previewProjectScoring(db, { projectId, actorUserId: adminUserId });
    expect(preview.milestones.map(({ type }) => type)).toEqual([
      "DEMOLITION",
      "APPLICATION",
      "BUILDING_PERMIT",
      "OCCUPANCY",
    ]);
  });

  it("uses the stable tracker observation when a City civic date is later removed", async () => {
    const observedAt = new Date("2026-08-02T13:30:04.486Z");
    const permit = await db.permitEvent.create({
      data: {
        sourceProvider: provider,
        sourceDataset: "development",
        sourceRecordIdentifier: "date-removed-accessory-building",
        permitType: "Accessory Building Combo Permit",
        status: "Other",
        workDescription: "To construct an Accessory Building (mutual Garage).",
        issueDate: new Date("2026-07-20T00:00:00.000Z"),
        addressId: firstAddressId,
        neighbourhoodId,
        rawSourcePayload: { synthetic: true, kind: "date-removed" },
        createdAt: observedAt,
        importedAt: observedAt,
      },
    });

    try {
      expect(await matchPermitEvent(db, permit.id)).toMatchObject({
        disposition: "matched",
        projectId,
      });
      await db.permitEvent.update({ where: { id: permit.id }, data: { issueDate: null } });
      await db.$transaction((transaction) => recomputeProject(transaction, projectId));

      const link = await db.projectEvent.findUniqueOrThrow({
        where: { permitEventId: permit.id },
      });
      expect(link.eventDate).toEqual(new Date("2026-08-02T00:00:00.000Z"));

      const detail = await getProjectDetail(db, projectId);
      expect(detail?.timeline).toContainEqual(
        expect.objectContaining({
          permitEventId: permit.id,
          milestoneType: "OBSERVED",
          date: "2026-08-02",
        }),
      );
    } finally {
      await db.permitEvent.delete({ where: { id: permit.id } });
      await db.$transaction((transaction) => recomputeProject(transaction, projectId));
    }
  });

  it("requires an admin and preserves overrides through event reassignment recomputation", async () => {
    const duplicate = await db.project.create({
      data: {
        projectKey: `phase3-duplicate:${suffix}`,
        addressId: firstAddressId,
        neighbourhoodId,
        title: "Synthetic duplicate project",
        category: ProjectCategory.NOT_RELEVANT,
        computedCategory: ProjectCategory.NOT_RELEVANT,
        currentStage: ProjectStage.DISCOVERED,
        computedStage: ProjectStage.DISCOVERED,
        confidenceExplanation: { summary: "Synthetic duplicate", score: 0, factors: [] },
      },
    });
    duplicateProjectId = duplicate.id;

    await expect(
      setProjectManualOverride(db, {
        projectId: duplicate.id,
        actorUserId: standardUserId,
        reason: "A non-admin must not change classification.",
        category: ProjectCategory.PROBABLE_DUPLEX,
      }),
    ).rejects.toBeInstanceOf(ProjectAdminRequiredError);

    await setProjectManualOverride(db, {
      projectId: duplicate.id,
      actorUserId: adminUserId,
      reason: "Synthetic admin correction for persistence coverage.",
      category: ProjectCategory.PROBABLE_DUPLEX,
    });
    await reassignPermitEvent(db, {
      permitEventId: buildingPermitId,
      targetProjectId: duplicate.id,
      actorUserId: adminUserId,
      reason: "Move the building permit to the reviewed duplicate.",
    });

    const [source, target] = await Promise.all([
      db.project.findUniqueOrThrow({ where: { id: projectId } }),
      db.project.findUniqueOrThrow({ where: { id: duplicate.id } }),
    ]);
    expect(source.computedCategory).toBe(ProjectCategory.DEMOLITION_ONLY);
    expect(source.currentStage).toBe(ProjectStage.DEMOLITION);
    expect(target.computedCategory).toBe(ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL);
    expect(target.category).toBe(ProjectCategory.PROBABLE_DUPLEX);
    expect(target.categoryOverride).toBe(ProjectCategory.PROBABLE_DUPLEX);
    expect(target.currentStage).toBe(ProjectStage.COMPLETE);
  });

  it("audits merges, blocks invalid targets, and supports a durable not-relevant decision", async () => {
    await expect(
      mergeProjects(db, {
        sourceProjectId: projectId,
        targetProjectId: projectId,
        actorUserId: adminUserId,
        reason: "Self merge must be rejected.",
      }),
    ).rejects.toBeInstanceOf(ProjectMergeConflictError);

    await db.project.update({
      where: { id: projectId },
      data: { marketReviewRequired: true },
    });

    await mergeProjects(db, {
      sourceProjectId: projectId,
      targetProjectId: duplicateProjectId,
      actorUserId: adminUserId,
      reason: "Consolidate the reviewed physical-address duplicate.",
    });
    const manuallyMergedLink = await db.projectEvent.findUniqueOrThrow({
      where: { permitEventId: demolitionPermitId },
    });
    expect(manuallyMergedLink.matchReason).toMatchObject({
      strategy: "manual-project-merge",
      automated: false,
      sourceProjectId: projectId,
      targetProjectId: duplicateProjectId,
    });
    const merged = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(merged).toMatchObject({
      mergedIntoId: duplicateProjectId,
      reviewStatus: ReviewStatus.MERGED,
      marketReviewRequired: false,
    });

    await expect(
      mergeProjects(db, {
        sourceProjectId: duplicateProjectId,
        targetProjectId: projectId,
        actorUserId: adminUserId,
        reason: "A merged target must be rejected.",
      }),
    ).rejects.toBeInstanceOf(ProjectMergeConflictError);

    await markProjectNotRelevant(db, {
      projectId: duplicateProjectId,
      actorUserId: adminUserId,
      reason: "Reviewed synthetic example is intentionally excluded.",
    });
    const target = await db.project.findUniqueOrThrow({ where: { id: duplicateProjectId } });
    expect(target).toMatchObject({
      category: ProjectCategory.NOT_RELEVANT,
      categoryOverride: ProjectCategory.NOT_RELEVANT,
      reviewStatus: ReviewStatus.NOT_RELEVANT,
      marketReviewRequired: false,
    });

    await setProjectManualOverride(db, {
      projectId: duplicateProjectId,
      actorUserId: adminUserId,
      reason: "Restore automatic classification after reviewing new evidence.",
      category: null,
    });
    const restored = await db.project.findUniqueOrThrow({ where: { id: duplicateProjectId } });
    expect(restored).toMatchObject({
      category: ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
      categoryOverride: null,
      reviewStatus: ReviewStatus.CORRECTED,
      marketReviewRequired: true,
    });

    await markProjectNotRelevant(db, {
      projectId: duplicateProjectId,
      actorUserId: adminUserId,
      reason: "Return the synthetic project to the excluded review fixture.",
    });

    const actions = await db.projectAction.findMany({
      where: { actorUserId: adminUserId },
      select: { actionType: true },
    });
    expect(actions).toHaveLength(6);
    expect(actions.map(({ actionType }) => actionType)).toEqual(
      expect.arrayContaining([
        ProjectActionType.MANUAL_OVERRIDE,
        ProjectActionType.EVENT_REASSIGNED,
        ProjectActionType.PROJECT_MERGED,
        ProjectActionType.MARKED_NOT_RELEVANT,
      ]),
    );
  });
});
