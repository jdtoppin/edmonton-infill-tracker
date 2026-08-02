import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { ProjectCategory, ProjectStage } from "../../src/generated/prisma/enums";
import { getDb } from "../../src/lib/db";
import { getDashboardOverview } from "../../src/services/project-read-model";

const hasTestDatabase =
  Boolean(process.env.DATABASE_URL) && process.env.ALLOW_DATABASE_INTEGRATION_TESTS === "true";

describe.skipIf(!hasTestDatabase)("dashboard lifecycle overview", () => {
  const suffix = randomUUID();
  const sourceProvider = `dashboard-lifecycle:${suffix}`;
  const cityNeighbourhoodId = `dashboard-lifecycle-${suffix}`;
  const normalizedAddressKey = `edmonton|ab|98765 test avenue nw|${suffix}`;
  const projectKey = `dashboard-lifecycle:${suffix}`;
  const now = new Date("2026-08-02T12:00:00.000Z");
  let db: PrismaClient;

  beforeAll(async () => {
    db = await getDb();
    const neighbourhood = await db.neighbourhood.create({
      data: {
        cityNeighbourhoodId,
        name: "Dashboard Lifecycle Test",
      },
    });
    const address = await db.address.create({
      data: {
        rawSourceAddress: "98765 TEST AVENUE NW",
        normalizedStreetAddress: "98765 TEST AVE NW",
        normalizedAddressKey,
        neighbourhoodId: neighbourhood.id,
      },
    });
    const project = await db.project.create({
      data: {
        projectKey,
        addressId: address.id,
        neighbourhoodId: neighbourhood.id,
        title: "Synthetic row housing project",
        category: ProjectCategory.PROBABLE_ROW_HOUSING,
        computedCategory: ProjectCategory.PROBABLE_ROW_HOUSING,
        currentStage: ProjectStage.BUILDING_PERMIT,
        computedStage: ProjectStage.BUILDING_PERMIT,
        earliestEventDate: new Date("2026-07-29T00:00:00.000Z"),
        latestEventDate: new Date("2026-07-30T00:00:00.000Z"),
        confidenceExplanation: { summary: "Synthetic integration fixture", factors: [] },
      },
    });
    const developmentPermit = await db.permitEvent.create({
      data: {
        sourceProvider,
        sourceDataset: "development",
        sourceRecordIdentifier: "development",
        permitType: "Development Permit",
        issueDate: new Date("2026-07-29T00:00:00.000Z"),
        status: "Approved",
        addressId: address.id,
        neighbourhoodId: neighbourhood.id,
        rawSourcePayload: {
          city_file_number: "synthetic-development",
          permit_date: "2026-07-29",
        },
      },
    });
    const buildingPermit = await db.permitEvent.create({
      data: {
        sourceProvider,
        sourceDataset: "building",
        sourceRecordIdentifier: "building",
        permitType: "Single, Semi-detached & Rowhousing",
        issueDate: new Date("2026-07-30T00:00:00.000Z"),
        status: "Issued",
        addressId: address.id,
        neighbourhoodId: neighbourhood.id,
        rawSourcePayload: {
          job_category: "Single, Semi-detached & Rowhousing",
          issue_date: "2026-07-30",
        },
      },
    });

    await db.projectEvent.createMany({
      data: [
        {
          projectId: project.id,
          permitEventId: developmentPermit.id,
          eventDate: new Date("2026-07-29T00:00:00.000Z"),
        },
        {
          projectId: project.id,
          permitEventId: buildingPermit.id,
          eventDate: new Date("2026-07-30T00:00:00.000Z"),
        },
      ],
    });
  });

  afterAll(async () => {
    await db.project.deleteMany({ where: { projectKey } });
    await db.permitEvent.deleteMany({ where: { sourceProvider } });
    await db.address.deleteMany({ where: { normalizedAddressKey } });
    await db.neighbourhood.deleteMany({ where: { cityNeighbourhoodId } });
  });

  it("counts City building-dataset events without treating development events as building permits", async () => {
    const overview = await getDashboardOverview(db, now);

    expect(overview.lifecycle[7]).toEqual({
      development: 1,
      building: 1,
      occupancy: 0,
    });
  });
});
