import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import {
  InfillAreaClassification,
  ProjectCategory,
  ProjectStage,
} from "../../src/generated/prisma/enums";
import { getDb } from "../../src/lib/db";
import { getDashboardOverview } from "../../src/services/project-read-model";

const hasTestDatabase =
  Boolean(process.env.DATABASE_URL) && process.env.ALLOW_DATABASE_INTEGRATION_TESTS === "true";

describe.skipIf(!hasTestDatabase)("dashboard lifecycle overview", () => {
  const suffix = randomUUID();
  const sourceProvider = `dashboard-lifecycle:${suffix}`;
  const cityNeighbourhoodId = `dashboard-lifecycle-${suffix}`;
  const outsideCityNeighbourhoodId = `dashboard-lifecycle-outside-${suffix}`;
  const normalizedAddressKey = `edmonton|ab|98765 test avenue nw|${suffix}`;
  const outsideAddressKey = `edmonton|ab|98767 test avenue nw|${suffix}`;
  const historicalAddressKey = `edmonton|ab|98766 test avenue nw|${suffix}`;
  const projectKey = `dashboard-lifecycle:${suffix}`;
  const outsideProjectKey = `dashboard-lifecycle:outside:${suffix}`;
  const historicalProjectKey = `dashboard-lifecycle:historical:${suffix}`;
  const now = new Date("2026-08-02T12:00:00.000Z");
  let db: PrismaClient;
  let projectId: string;
  let outsideProjectId: string;
  let baselineSevenStarts: number;
  let baselineAllTimeStarts: number;

  beforeAll(async () => {
    db = await getDb();
    const [baselineSeven, baselineAllTime] = await Promise.all([
      getDashboardOverview(db, now, 7),
      getDashboardOverview(db, now, "all"),
    ]);
    baselineSevenStarts = baselineSeven.potentialInfillStarts;
    baselineAllTimeStarts = baselineAllTime.potentialInfillStarts;
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
        latitude: 53.552234,
        longitude: -113.540089,
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
        infillStartDate: new Date("2026-07-29T00:00:00.000Z"),
        latestInfillActivityDate: new Date("2026-07-30T00:00:00.000Z"),
        infillConfidence: 100,
        infillAreaClassification: InfillAreaClassification.CORE,
        confidenceExplanation: { summary: "Synthetic integration fixture", factors: [] },
      },
    });
    projectId = project.id;
    const developmentPermit = await db.permitEvent.create({
      data: {
        sourceProvider,
        sourceDataset: "development",
        sourceRecordIdentifier: "development",
        permitType: "Development Permit",
        workDescription: "Construct new row housing dwellings.",
        buildingType: "Row Housing",
        unitsAdded: 4,
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
        workDescription: "Construct new row housing dwellings.",
        buildingType: "Row Housing",
        unitsAdded: 4,
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
    const accessoryGarage = await db.permitEvent.create({
      data: {
        sourceProvider,
        sourceDataset: "development",
        sourceRecordIdentifier: "accessory-garage",
        permitType: "Accessory Building Combo Permit",
        workDescription: "Construct a detached garage.",
        issueDate: new Date("2026-07-31T00:00:00.000Z"),
        status: "Permitted Development",
        addressId: address.id,
        neighbourhoodId: neighbourhood.id,
        rawSourcePayload: {
          city_file_number: "synthetic-accessory-garage",
          permit_date: "2026-07-31",
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
        {
          projectId: project.id,
          permitEventId: accessoryGarage.id,
          eventDate: new Date("2026-07-31T00:00:00.000Z"),
        },
      ],
    });

    const accessoryNoise = await db.permitEvent.createManyAndReturn({
      data: Array.from({ length: 105 }, (_, index) => ({
        sourceProvider,
        sourceDataset: "development",
        sourceRecordIdentifier: `accessory-noise-${index}`,
        permitType: "Accessory Building Combo Permit",
        workDescription: "Construct an Accessory Building (detached Garage).",
        issueDate: new Date("2026-07-31T00:00:00.000Z"),
        status: "Other",
        addressId: address.id,
        neighbourhoodId: neighbourhood.id,
        rawSourcePayload: {
          city_file_number: `synthetic-accessory-noise-${index}`,
          permit_date: "2026-07-31",
        },
      })),
      select: { id: true },
    });
    await db.projectEvent.createMany({
      data: accessoryNoise.map(({ id }) => ({
        projectId: project.id,
        permitEventId: id,
        eventDate: new Date("2026-07-31T00:00:00.000Z"),
      })),
    });

    const undatedDemolition = await db.permitEvent.create({
      data: {
        sourceProvider,
        sourceDataset: "development",
        sourceRecordIdentifier: "undated-demolition",
        permitType: "Demolition Permit",
        workDescription: "Demolish a dwelling.",
        status: "Approved",
        addressId: address.id,
        neighbourhoodId: neighbourhood.id,
        rawSourcePayload: { city_file_number: "synthetic-undated-demolition" },
        createdAt: now,
        importedAt: now,
      },
    });
    await db.projectEvent.create({
      data: {
        projectId: project.id,
        permitEventId: undatedDemolition.id,
        eventDate: new Date("2026-08-02T00:00:00.000Z"),
      },
    });

    const outsideNeighbourhood = await db.neighbourhood.create({
      data: {
        cityNeighbourhoodId: outsideCityNeighbourhoodId,
        name: "Dashboard Outside Core Test",
      },
    });
    const outsideAddress = await db.address.create({
      data: {
        rawSourceAddress: "98767 TEST AVENUE NW",
        normalizedStreetAddress: "98767 TEST AVE NW",
        normalizedAddressKey: outsideAddressKey,
        latitude: 53.603005,
        longitude: -113.455994,
        neighbourhoodId: outsideNeighbourhood.id,
      },
    });
    const outsideProject = await db.project.create({
      data: {
        projectKey: outsideProjectKey,
        addressId: outsideAddress.id,
        neighbourhoodId: outsideNeighbourhood.id,
        title: "Synthetic outside-core row housing project",
        category: ProjectCategory.PROBABLE_ROW_HOUSING,
        computedCategory: ProjectCategory.PROBABLE_ROW_HOUSING,
        currentStage: ProjectStage.BUILDING_PERMIT,
        computedStage: ProjectStage.BUILDING_PERMIT,
        earliestEventDate: new Date("2026-07-29T00:00:00.000Z"),
        latestEventDate: new Date("2026-07-30T00:00:00.000Z"),
        infillStartDate: new Date("2026-07-29T00:00:00.000Z"),
        latestInfillActivityDate: new Date("2026-07-30T00:00:00.000Z"),
        infillConfidence: 60,
        infillAreaClassification: InfillAreaClassification.OUTSIDE_CORE,
        confidenceExplanation: { summary: "Synthetic outside-core fixture", factors: [] },
      },
    });
    outsideProjectId = outsideProject.id;
    const [outsideDevelopment, outsideBuilding] = await Promise.all([
      db.permitEvent.create({
        data: {
          sourceProvider,
          sourceDataset: "development",
          sourceRecordIdentifier: "outside-development",
          permitType: "Development Permit",
          workDescription: "Construct new row housing dwellings.",
          buildingType: "Row Housing",
          unitsAdded: 4,
          issueDate: new Date("2026-07-29T00:00:00.000Z"),
          status: "Approved",
          addressId: outsideAddress.id,
          neighbourhoodId: outsideNeighbourhood.id,
          rawSourcePayload: { synthetic: true, area: "outside-core" },
        },
      }),
      db.permitEvent.create({
        data: {
          sourceProvider,
          sourceDataset: "building",
          sourceRecordIdentifier: "outside-building",
          permitType: "Single, Semi-detached & Rowhousing",
          workDescription: "Construct new row housing dwellings.",
          buildingType: "Row Housing",
          unitsAdded: 4,
          issueDate: new Date("2026-07-30T00:00:00.000Z"),
          status: "Issued",
          addressId: outsideAddress.id,
          neighbourhoodId: outsideNeighbourhood.id,
          rawSourcePayload: { synthetic: true, area: "outside-core" },
        },
      }),
    ]);
    await db.projectEvent.createMany({
      data: [
        {
          projectId: outsideProject.id,
          permitEventId: outsideDevelopment.id,
          eventDate: new Date("2026-07-29T00:00:00.000Z"),
        },
        {
          projectId: outsideProject.id,
          permitEventId: outsideBuilding.id,
          eventDate: new Date("2026-07-30T00:00:00.000Z"),
        },
      ],
    });

    const historicalAddress = await db.address.create({
      data: {
        rawSourceAddress: "98766 TEST AVENUE NW",
        normalizedStreetAddress: "98766 TEST AVE NW",
        normalizedAddressKey: historicalAddressKey,
        latitude: 53.552234,
        longitude: -113.540089,
        neighbourhoodId: neighbourhood.id,
      },
    });
    const historicalProject = await db.project.create({
      data: {
        projectKey: historicalProjectKey,
        addressId: historicalAddress.id,
        neighbourhoodId: neighbourhood.id,
        title: "Historical project imported today",
        category: ProjectCategory.PROBABLE_ROW_HOUSING,
        computedCategory: ProjectCategory.PROBABLE_ROW_HOUSING,
        currentStage: ProjectStage.BUILDING_PERMIT,
        computedStage: ProjectStage.BUILDING_PERMIT,
        earliestEventDate: new Date("2015-08-07T00:00:00.000Z"),
        latestEventDate: new Date("2015-08-07T00:00:00.000Z"),
        infillStartDate: new Date("2015-08-07T00:00:00.000Z"),
        latestInfillActivityDate: new Date("2015-08-07T00:00:00.000Z"),
        infillConfidence: 90,
        infillAreaClassification: InfillAreaClassification.CORE,
        confidenceExplanation: { summary: "Historical integration fixture", factors: [] },
        createdAt: now,
      },
    });
    const historicalPermit = await db.permitEvent.create({
      data: {
        sourceProvider,
        sourceDataset: "building",
        sourceRecordIdentifier: "historical-building",
        permitType: "Building Permit",
        workDescription: "Construct new row housing dwellings.",
        buildingType: "Row Housing",
        unitsAdded: 4,
        issueDate: new Date("2015-08-07T00:00:00.000Z"),
        status: "Issued",
        addressId: historicalAddress.id,
        neighbourhoodId: neighbourhood.id,
        rawSourcePayload: {
          job_category: "Single, Semi-detached & Rowhousing",
          issue_date: "2015-08-07",
        },
        createdAt: now,
        importedAt: now,
      },
    });
    await db.projectEvent.create({
      data: {
        projectId: historicalProject.id,
        permitEventId: historicalPermit.id,
        eventDate: new Date("2015-08-07T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await db.project.deleteMany({
      where: { projectKey: { in: [projectKey, outsideProjectKey, historicalProjectKey] } },
    });
    await db.permitEvent.deleteMany({ where: { sourceProvider } });
    await db.address.deleteMany({
      where: {
        normalizedAddressKey: {
          in: [normalizedAddressKey, outsideAddressKey, historicalAddressKey],
        },
      },
    });
    await db.neighbourhood.deleteMany({
      where: { cityNeighbourhoodId: { in: [cityNeighbourhoodId, outsideCityNeighbourhoodId] } },
    });
  });

  it("counts qualifying City lifecycle events without counting an accessory garage", async () => {
    const overview = await getDashboardOverview(db, now);

    expect(overview.range).toMatchObject({
      period: 7,
      from: "2026-07-27",
      through: "2026-08-02",
    });
    expect(overview.lifecycle).toEqual({
      development: 1,
      building: 1,
      occupancy: 0,
    });
    expect(overview.potentialInfillStarts).toBe(baselineSevenStarts + 1);
    expect(overview.categoryBreakdown).toContainEqual(
      expect.objectContaining({ category: ProjectCategory.PROBABLE_ROW_HOUSING }),
    );
    expect(overview.neighbourhoodBreakdown).toContainEqual(
      expect.objectContaining({ cityId: cityNeighbourhoodId, count: 1 }),
    );
    expect(overview.neighbourhoodBreakdown).not.toContainEqual(
      expect.objectContaining({ cityId: outsideCityNeighbourhoodId }),
    );
    expect(overview.mapProjects).toContainEqual(
      expect.objectContaining({
        id: projectId,
        address: "98765 TEST AVE NW",
        latitude: 53.552234,
        longitude: -113.540089,
      }),
    );
    expect(overview.mapProjects.map(({ id }) => id)).not.toContain(outsideProjectId);
    expect(overview.highConfidenceProjects.map(({ id }) => id)).toContain(projectId);
    expect(overview.highConfidenceProjects.map(({ id }) => id)).not.toContain(outsideProjectId);
    expect(overview.recentConstruction.map(({ id }) => id)).toContain(projectId);
    expect(overview.recentConstruction.map(({ id }) => id)).not.toContain(outsideProjectId);
    expect(overview.recentDemolitions.map(({ id }) => id)).not.toContain(projectId);

    const allTime = await getDashboardOverview(db, now, "all");
    expect(allTime.potentialInfillStarts).toBe(baselineAllTimeStarts + 2);
    expect(allTime.neighbourhoodBreakdown).toContainEqual(
      expect.objectContaining({ cityId: cityNeighbourhoodId, count: 2 }),
    );
    const constructionDates = allTime.recentConstruction.flatMap((project) =>
      project.latestEvent ? [project.latestEvent.date] : [],
    );
    expect(constructionDates).toEqual([...constructionDates].sort().reverse());
  });

  it("includes mapped projects outside the ten highest-activity neighbourhoods", async () => {
    const coveragePrefix = `dashboard-map-coverage:${suffix}`;
    try {
      const coverageNeighbourhoods = await db.neighbourhood.createManyAndReturn({
        data: Array.from({ length: 12 }, (_, index) => ({
          cityNeighbourhoodId: `${coveragePrefix}:${index}`,
          name: `Dashboard Map Coverage ${String(index).padStart(2, "0")}`,
        })),
        select: { id: true, cityNeighbourhoodId: true },
      });
      const coverageAddresses = await Promise.all(
        coverageNeighbourhoods.map((area, index) =>
          db.address.create({
            data: {
              rawSourceAddress: `${91000 + index} COVERAGE AVENUE NW`,
              normalizedStreetAddress: `${91000 + index} COVERAGE AVE NW`,
              normalizedAddressKey: `${coveragePrefix}:address:${index}`,
              latitude: 53.5 + index / 10_000,
              longitude: -113.5 - index / 10_000,
              neighbourhoodId: area.id,
            },
            select: { id: true, neighbourhoodId: true },
          }),
        ),
      );
      const coverageProjects = await Promise.all(
        coverageAddresses.map((address, index) =>
          db.project.create({
            data: {
              projectKey: `${coveragePrefix}:project:${index}`,
              addressId: address.id,
              neighbourhoodId: address.neighbourhoodId!,
              title: `Dashboard map coverage project ${index}`,
              category: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
              computedCategory: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
              currentStage: ProjectStage.BUILDING_PERMIT,
              computedStage: ProjectStage.BUILDING_PERMIT,
              latestInfillActivityDate: new Date("2026-08-01T00:00:00.000Z"),
              infillConfidence: 85,
              infillAreaClassification: InfillAreaClassification.CORE,
              confidenceExplanation: { summary: "Map coverage fixture", factors: [] },
            },
            select: { id: true, neighbourhoodId: true },
          }),
        ),
      );
      const overview = await getDashboardOverview(db, now, 30);
      const rankByNeighbourhoodId = new Map(
        overview.neighbourhoodBreakdown.map((area, index) => [area.id, index]),
      );
      const outsideLeadingTen = coverageProjects.find(
        (project) => (rankByNeighbourhoodId.get(project.neighbourhoodId) ?? -1) >= 10,
      );

      expect(outsideLeadingTen).toBeDefined();
      expect(overview.mapProjects.map(({ id }) => id)).toContain(outsideLeadingTen!.id);
    } finally {
      await db.project.deleteMany({ where: { projectKey: { startsWith: coveragePrefix } } });
      await db.address.deleteMany({
        where: { normalizedAddressKey: { startsWith: `${coveragePrefix}:address:` } },
      });
      await db.neighbourhood.deleteMany({
        where: { cityNeighbourhoodId: { startsWith: coveragePrefix } },
      });
    }
  });
});
