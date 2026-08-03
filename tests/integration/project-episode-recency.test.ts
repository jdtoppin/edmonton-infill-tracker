import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { ProjectCategory, ProjectStage } from "../../src/generated/prisma/enums";
import { getDb } from "../../src/lib/db";
import { matchPermitEvent } from "../../src/services/project-intelligence";
import { listProjects, parseProjectFilters } from "../../src/services/project-read-model";

const hasDatabase =
  Boolean(process.env.DATABASE_URL) && process.env.ALLOW_DATABASE_INTEGRATION_TESTS === "true";

describe.skipIf(!hasDatabase)("persisted infill episode recency", () => {
  const suffix = randomUUID();
  const sourceProvider = `episode-recency:${suffix}`;
  let db: PrismaClient;
  let neighbourhoodId: string;
  let addressId: string;
  let projectId: string;

  beforeAll(async () => {
    db = await getDb();
    const neighbourhood = await db.neighbourhood.create({
      data: { cityNeighbourhoodId: `episode-${suffix}`, name: "Synthetic Episode" },
    });
    neighbourhoodId = neighbourhood.id;
    const address = await db.address.create({
      data: {
        rawSourceAddress: "7632 92 AVENUE NW",
        normalizedStreetAddress: `7632 92 AVE NW ${suffix}`,
        normalizedAddressKey: `edmonton|ab|7632 92 ave nw|${suffix}`,
        neighbourhoodId,
      },
    });
    addressId = address.id;

    const permits = await Promise.all([
      db.permitEvent.create({
        data: {
          sourceProvider,
          sourceDataset: "development",
          sourceRecordIdentifier: "historic-demolition",
          permitType: "Demolition Permit",
          status: "Approved",
          workDescription:
            "To demolish an existing Single Detached House and Accessory Building (rear detached Garage).",
          issueDate: new Date("2015-11-01T00:00:00.000Z"),
          addressId,
          neighbourhoodId,
          rawSourcePayload: { synthetic: true },
        },
      }),
      db.permitEvent.create({
        data: {
          sourceProvider,
          sourceDataset: "building",
          sourceRecordIdentifier: "historic-house",
          permitType: "Single, Semi-detached & Rowhousing",
          status: "Issued",
          workDescription: "To construct a new single detached house.",
          buildingType: "Single Detached House",
          constructionValue: "351120.00",
          unitsAdded: 1,
          issueDate: new Date("2016-02-01T00:00:00.000Z"),
          addressId,
          neighbourhoodId,
          rawSourcePayload: { synthetic: true },
        },
      }),
      db.permitEvent.create({
        data: {
          sourceProvider,
          sourceDataset: "building",
          sourceRecordIdentifier: "property-air-conditioning",
          permitType: "Heating and Ventilation",
          status: "Issued",
          workDescription:
            "To install an air conditioner in a Single Detached House, existing without permits.",
          buildingType: "Single Detached House",
          issueDate: new Date("2018-06-01T00:00:00.000Z"),
          addressId,
          neighbourhoodId,
          rawSourcePayload: { synthetic: true },
        },
      }),
      db.permitEvent.create({
        data: {
          sourceProvider,
          sourceDataset: "development",
          sourceRecordIdentifier: "219976680-003",
          permitNumber: "219976680-003",
          permitType: "Accessory Building Combo Permit",
          status: "Other",
          workDescription: "To construct an Accessory Building (mutual Garage, 6.71m x 7.01m).",
          addressId,
          neighbourhoodId,
          rawSourcePayload: { synthetic: true },
          createdAt: new Date("2026-08-02T13:30:04.486Z"),
          importedAt: new Date("2026-08-02T13:30:04.486Z"),
        },
      }),
    ]);

    for (const permit of permits) {
      const matched = await matchPermitEvent(db, permit.id);
      if (!matched.projectId) throw new Error("Synthetic civic permit was not matched.");
      projectId = matched.projectId;
    }
  });

  afterAll(async () => {
    if (projectId) await db.project.deleteMany({ where: { id: projectId } });
    await db.permitEvent.deleteMany({ where: { sourceProvider } });
    if (addressId) await db.address.deleteMany({ where: { id: addressId } });
    if (neighbourhoodId) {
      await db.neighbourhood.deleteMany({ where: { id: neighbourhoodId } });
    }
  });

  it("keeps property-only records in history without reactivating the infill episode", async () => {
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { events: true },
    });

    expect(project).toMatchObject({
      category: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
      computedCategory: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
      currentStage: ProjectStage.BUILDING_PERMIT,
      computedStage: ProjectStage.BUILDING_PERMIT,
      estimatedUnits: 1,
    });
    expect(project.events).toHaveLength(4);
    expect(project.infillStartDate?.toISOString().slice(0, 10)).toBe("2015-11-01");
    expect(project.latestInfillActivityDate?.toISOString().slice(0, 10)).toBe("2016-02-01");
    expect(project.latestEventDate?.toISOString().slice(0, 10)).toBe("2026-08-02");
    expect(Number(project.estimatedConstructionValue)).toBe(351_120);
  });

  it("excludes the historic project from a 2026 latest-infill filter", async () => {
    const current = await listProjects(
      db,
      parseProjectFilters(new URLSearchParams([["from", "2026-01-01"]])),
    );
    expect(current.items.map(({ id }) => id)).not.toContain(projectId);

    const historic = await listProjects(
      db,
      parseProjectFilters(
        new URLSearchParams([
          ["from", "2016-01-01"],
          ["to", "2016-12-31"],
        ]),
      ),
    );
    expect(historic.items.map(({ id }) => id)).toContain(projectId);
  });
});
