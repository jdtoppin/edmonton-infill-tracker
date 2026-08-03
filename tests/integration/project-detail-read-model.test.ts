import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { ProjectCategory, ProjectStage } from "../../src/generated/prisma/enums";
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
  let db: PrismaClient;
  let projectId: string;

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
      },
    });
    await db.projectEvent.create({
      data: { projectId, permitEventId: permit.id, eventDate },
    });
  });

  afterAll(async () => {
    await db.project.deleteMany({ where: { projectKey } });
    await db.permitEvent.deleteMany({ where: { sourceProvider } });
    await db.address.deleteMany({ where: { normalizedAddressKey } });
    await db.neighbourhood.deleteMany({ where: { cityNeighbourhoodId } });
  });

  it("uses the persisted linked event date when every source milestone date is null", async () => {
    const detail = await getProjectDetail(db, projectId);

    expect(detail?.timeline).toEqual([
      expect.objectContaining({
        milestoneType: "DEVELOPMENT_PERMIT",
        date: "2026-07-14",
      }),
    ]);
    expect(detail).toMatchObject({
      infillStartDate: "2026-07-14",
      latestInfillActivityDate: "2026-07-14",
    });
  });
});
