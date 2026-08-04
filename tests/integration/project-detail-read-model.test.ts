import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import {
  InfillAreaClassification,
  ProjectCategory,
  ProjectStage,
} from "../../src/generated/prisma/enums";
import { getDb } from "../../src/lib/db";
import { getProjectDetail } from "../../src/services/project-read-model";

const hasTestDatabase =
  Boolean(process.env.DATABASE_URL) && process.env.ALLOW_DATABASE_INTEGRATION_TESTS === "true";

describe.skipIf(!hasTestDatabase)("project detail read model", () => {
  const suffix = randomUUID();
  const sourceProvider = `project-detail:${suffix}`;
  const cityNeighbourhoodId = `project-detail-${suffix}`;
  const normalizedAddressKey = `edmonton|ab|98766 test avenue nw|${suffix}`;
  const projectKey = `project-detail:${suffix}`;
  const eventDate = new Date("2026-07-14T00:00:00.000Z");
  const observedAt = new Date("2026-08-02T13:30:04.486Z");
  let db: PrismaClient;
  let projectId: string;
  let buildingProjectId: string;
  let occupiedProjectId: string;
  let garageProjectId: string;

  beforeAll(async () => {
    db = await getDb();
    const neighbourhood = await db.neighbourhood.create({
      data: { cityNeighbourhoodId, name: "Project Detail Test" },
    });
    const address = await db.address.create({
      data: {
        rawSourceAddress: "98766 TEST AVENUE NW",
        normalizedStreetAddress: "98766 TEST AVE NW",
        normalizedAddressKey,
        neighbourhoodId: neighbourhood.id,
      },
    });
    const project = await db.project.create({
      data: {
        projectKey,
        addressId: address.id,
        neighbourhoodId: neighbourhood.id,
        title: "Dateless development permit project",
        category: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
        computedCategory: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
        currentStage: ProjectStage.DEVELOPMENT_PERMIT,
        computedStage: ProjectStage.DEVELOPMENT_PERMIT,
        earliestEventDate: eventDate,
        latestEventDate: eventDate,
        infillStartDate: eventDate,
        latestInfillActivityDate: eventDate,
        confidenceExplanation: { summary: "Synthetic integration fixture", factors: [] },
      },
    });
    projectId = project.id;
    const permit = await db.permitEvent.create({
      data: {
        sourceProvider,
        sourceDataset: "development",
        sourceRecordIdentifier: "dateless-development",
        permitType: "Development Permit",
        status: "In progress",
        addressId: address.id,
        neighbourhoodId: neighbourhood.id,
        rawSourcePayload: { city_file_number: "synthetic-dateless-development" },
        importedAt: observedAt,
        createdAt: observedAt,
      },
    });
    await db.projectEvent.create({
      data: { projectId, permitEventId: permit.id, eventDate },
    });

    const createBuildingFixture = async ({
      key,
      description,
      occupancyGrantedDate = null,
    }: {
      key: string;
      description: string;
      occupancyGrantedDate?: Date | null;
    }) => {
      const fixtureAddress = await db.address.create({
        data: {
          rawSourceAddress: `${key} PROJECT DETAIL TEST NW`,
          normalizedStreetAddress: `${key} PROJECT DETAIL TEST NW`,
          normalizedAddressKey: `edmonton|ab|${key}|${suffix}`,
          neighbourhoodId: neighbourhood.id,
        },
      });
      const issueDate = new Date("2025-03-01T00:00:00.000Z");
      const fixtureProject = await db.project.create({
        data: {
          projectKey: `project-detail:${suffix}:${key}`,
          addressId: fixtureAddress.id,
          neighbourhoodId: neighbourhood.id,
          title: `${key} occupancy timing fixture`,
          category: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
          computedCategory: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
          currentStage: occupancyGrantedDate ? ProjectStage.COMPLETE : ProjectStage.BUILDING_PERMIT,
          computedStage: occupancyGrantedDate
            ? ProjectStage.COMPLETE
            : ProjectStage.BUILDING_PERMIT,
          earliestEventDate: issueDate,
          latestEventDate: occupancyGrantedDate ?? issueDate,
          infillStartDate: issueDate,
          latestInfillActivityDate: occupancyGrantedDate ?? issueDate,
          infillAreaClassification: InfillAreaClassification.CORE,
          confidenceExplanation: { summary: "Synthetic occupancy fixture", factors: [] },
        },
      });
      const fixturePermit = await db.permitEvent.create({
        data: {
          sourceProvider,
          sourceDataset: "building",
          sourceRecordIdentifier: `${key}-building`,
          permitNumber: `${key}-BP`,
          permitType: "Building Permit",
          permitSubtype: "New Residential",
          issueDate,
          occupancyGrantedDate,
          status: "Issued",
          workDescription: description,
          buildingType: "Single Detached House",
          unitsAdded: 1,
          addressId: fixtureAddress.id,
          neighbourhoodId: neighbourhood.id,
          rawSourcePayload: { synthetic: true, key },
        },
      });
      await db.projectEvent.create({
        data: {
          projectId: fixtureProject.id,
          permitEventId: fixturePermit.id,
          eventDate: issueDate,
        },
      });
      return fixtureProject.id;
    };

    buildingProjectId = await createBuildingFixture({
      key: "principal",
      description: "Construct a new single detached dwelling with an attached garage.",
    });
    occupiedProjectId = await createBuildingFixture({
      key: "occupied",
      description: "Construct a new single detached dwelling.",
      occupancyGrantedDate: new Date("2026-02-01T00:00:00.000Z"),
    });
    garageProjectId = await createBuildingFixture({
      key: "garage",
      description: "Construct a new detached garage.",
    });
  });

  afterAll(async () => {
    await db.project.deleteMany({
      where: { projectKey: { startsWith: `project-detail:${suffix}` } },
    });
    await db.permitEvent.deleteMany({ where: { sourceProvider } });
    await db.address.deleteMany({ where: { normalizedAddressKey: { contains: suffix } } });
    await db.neighbourhood.deleteMany({ where: { cityNeighbourhoodId } });
  });

  it("labels an undated source row with its tracker observation date", async () => {
    const detail = await getProjectDetail(db, projectId);

    expect(detail?.timeline).toEqual([
      expect.objectContaining({
        milestoneType: "OBSERVED",
        stage: ProjectStage.DISCOVERED,
        date: "2026-08-02",
      }),
    ]);
    expect(detail).toMatchObject({
      infillStartDate: "2026-07-14",
      latestInfillActivityDate: "2026-07-14",
    });
  });

  it("adds a planning estimate only to a principal residential building permit", async () => {
    const detail = await getProjectDetail(
      db,
      buildingProjectId,
      new Date("2026-08-03T18:00:00.000Z"),
    );

    expect(detail?.timeline).toEqual([
      expect.objectContaining({
        milestoneType: "BUILDING_PERMIT",
        occupancyEstimate: expect.objectContaining({
          basis: "PLANNING_BASELINE",
          typicalDays: 548,
          maxComparisonDays: 730,
        }),
      }),
    ]);
  });

  it("suppresses the estimate when any occupancy milestone is reported", async () => {
    const detail = await getProjectDetail(
      db,
      occupiedProjectId,
      new Date("2026-08-03T18:00:00.000Z"),
    );

    expect(detail?.timeline.some(({ milestoneType }) => milestoneType === "OCCUPANCY")).toBe(true);
    expect(detail?.timeline.every(({ occupancyEstimate }) => occupancyEstimate === null)).toBe(
      true,
    );
  });

  it("does not attach an occupancy estimate to a standalone garage permit", async () => {
    const detail = await getProjectDetail(
      db,
      garageProjectId,
      new Date("2026-08-03T18:00:00.000Z"),
    );

    expect(detail?.timeline[0]).toMatchObject({
      milestoneType: "BUILDING_PERMIT",
      occupancyEstimate: null,
    });
  });
});
