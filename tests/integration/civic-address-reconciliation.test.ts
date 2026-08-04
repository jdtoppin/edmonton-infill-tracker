import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import {
  ProjectCategory,
  ProjectMatchStatus,
  ProjectStage,
  RunStatus,
} from "../../src/generated/prisma/enums";
import { ensureAddressReconciliationJob } from "../../src/jobs/address-reconciliation";
import { permitImportConflictKey } from "../../src/jobs/permit-import-job";
import { runProjectMatchingJob } from "../../src/jobs/project-intelligence-job";
import { getDb } from "../../src/lib/db";
import { matchPermitEvent } from "../../src/services/project-intelligence";

const hasTestDatabase =
  Boolean(process.env.DATABASE_URL) && process.env.ALLOW_DATABASE_INTEGRATION_TESTS === "true";

describe.skipIf(!hasTestDatabase)("civic address reconciliation", () => {
  const suffix = randomUUID();
  const seed = Number.parseInt(suffix.slice(0, 8), 16);
  const fultonCivic = String(9_000_000_000 + seed);
  const goldBarCivic = String(8_000_000_000 + seed);
  const streetToken = `${7_000_000_000 + seed}A`;
  const fultonRawAddress = `${fultonCivic} - ${streetToken} AVENUE NW`;
  const goldBarRawAddress = `${goldBarCivic} - ${streetToken} AVENUE NW`;
  const legacyStreetAddress = `${streetToken} AVE NW`;
  const fultonNormalizedAddress = `${fultonCivic} ${streetToken} AVE NW`;
  const goldBarNormalizedAddress = `${goldBarCivic} ${streetToken} AVE NW`;
  const condoCivic = String(6_000_000_000 + seed);
  const condoStreetToken = `${5_000_000_000 + seed}A`;
  const condoRawAddress = `317, ${condoCivic} - ${condoStreetToken} AVENUE NW`;
  const condoLegacyAddress = `317 ${condoCivic} ${condoStreetToken} AVE NW`;
  const condoNormalizedAddress = `${condoCivic} ${condoStreetToken} AVE NW`;
  const provider = `civic-address-repair:${suffix}`;
  const oldProjectKey = `legacy-street-wide-project:${suffix}`;
  let db: PrismaClient;
  let oldProjectId: string;
  let fultonNeighbourhoodId: string;
  let fultonPermitId: string;
  let goldBarPermitId: string;
  const neighbourhoodIds: string[] = [];
  const addressIds: string[] = [];
  const projectIds: string[] = [];

  beforeAll(async () => {
    db = await getDb();
    const [fulton, goldBar] = await Promise.all([
      db.neighbourhood.create({
        data: { cityNeighbourhoodId: `fulton-repair-${suffix}`, name: "Fulton Place" },
      }),
      db.neighbourhood.create({
        data: { cityNeighbourhoodId: `gold-bar-repair-${suffix}`, name: "Gold Bar" },
      }),
    ]);
    neighbourhoodIds.push(fulton.id, goldBar.id);
    fultonNeighbourhoodId = fulton.id;

    const correctedKeyCollision = await db.address.count({
      where: {
        normalizedAddressKey: {
          in: [
            `edmonton|ab|${fultonNormalizedAddress.toLowerCase()}`,
            `edmonton|ab|${goldBarNormalizedAddress.toLowerCase()}`,
          ],
        },
      },
    });
    if (correctedKeyCollision > 0) throw new Error("Synthetic civic address collision.");
    const correctedProjectCollision = await db.project.count({
      where: {
        address: {
          normalizedStreetAddress: {
            in: [fultonNormalizedAddress, goldBarNormalizedAddress],
          },
        },
      },
    });
    if (correctedProjectCollision > 0) throw new Error("Synthetic civic project collision.");

    const [legacyFultonAddress, legacyGoldBarAddress] = await Promise.all([
      db.address.create({
        data: {
          rawSourceAddress: fultonRawAddress,
          normalizedStreetAddress: legacyStreetAddress,
          normalizedAddressKey: `edmonton|ab|${streetToken.toLowerCase()} ave nw|unit:${fultonCivic}|${suffix}`,
          unitNumber: fultonCivic,
          latitude: 53.545862,
          longitude: -113.421378,
          neighbourhoodId: fulton.id,
        },
      }),
      db.address.create({
        data: {
          rawSourceAddress: goldBarRawAddress,
          normalizedStreetAddress: legacyStreetAddress,
          normalizedAddressKey: `edmonton|ab|${streetToken.toLowerCase()} ave nw|unit:${goldBarCivic}|${suffix}`,
          unitNumber: goldBarCivic,
          latitude: 53.545295,
          longitude: -113.41424,
          neighbourhoodId: goldBar.id,
        },
      }),
    ]);
    addressIds.push(legacyFultonAddress.id, legacyGoldBarAddress.id);

    const oldProject = await db.project.create({
      data: {
        projectKey: oldProjectKey,
        addressId: legacyFultonAddress.id,
        neighbourhoodId: fulton.id,
        title: `${legacyStreetAddress} infill activity`,
        category: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
        computedCategory: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
        currentStage: ProjectStage.DEVELOPMENT_PERMIT,
        computedStage: ProjectStage.DEVELOPMENT_PERMIT,
        confidenceExplanation: { summary: "Legacy conflated project", factors: [] },
      },
    });
    oldProjectId = oldProject.id;
    projectIds.push(oldProject.id);

    const [fultonPermit, goldBarPermit] = await Promise.all([
      db.permitEvent.create({
        data: {
          sourceProvider: provider,
          sourceDataset: "development",
          sourceRecordIdentifier: "558684557-002",
          permitNumber: "558684557-002",
          permitType: "Minor Development Permit",
          status: "Approved",
          workDescription: "To construct a Single Detached House.",
          issueDate: new Date("2025-07-09T00:00:00.000Z"),
          addressId: legacyFultonAddress.id,
          neighbourhoodId: fulton.id,
          addressNormalizationVersion: 1,
          rawSourcePayload: {
            address: fultonRawAddress,
            latitude: "53.545862022",
            longitude: "-113.421378117",
          },
        },
      }),
      db.permitEvent.create({
        data: {
          sourceProvider: provider,
          sourceDataset: "development",
          sourceRecordIdentifier: "568953983-002",
          permitNumber: "568953983-002",
          permitType: "Minor Development Permit",
          status: "Other",
          workDescription: "To construct a Single Detached House.",
          addressId: legacyGoldBarAddress.id,
          neighbourhoodId: goldBar.id,
          addressNormalizationVersion: 1,
          rawSourcePayload: {
            address: goldBarRawAddress,
            latitude: "53.54529480994811",
            longitude: "-113.4142403706947",
          },
        },
      }),
    ]);
    fultonPermitId = fultonPermit.id;
    goldBarPermitId = goldBarPermit.id;

    await db.projectEvent.createMany({
      data: [
        {
          projectId: oldProject.id,
          permitEventId: fultonPermit.id,
          eventDate: new Date("2025-07-09T00:00:00.000Z"),
          matchReason: { strategy: "normalized-site-address", automated: true },
        },
        {
          projectId: oldProject.id,
          permitEventId: goldBarPermit.id,
          eventDate: new Date("2026-08-02T00:00:00.000Z"),
          matchReason: { strategy: "normalized-site-address", automated: true },
        },
      ],
    });
  });

  afterAll(async () => {
    await db.project.deleteMany({
      where: { id: { in: projectIds } },
    });
    await db.permitEvent.deleteMany({ where: { sourceProvider: provider } });
    await db.address.deleteMany({ where: { id: { in: addressIds } } });
    await db.neighbourhood.deleteMany({ where: { id: { in: neighbourhoodIds } } });
  });

  it("splits a legacy street-wide project into corrected civic sites", async () => {
    const fulton = await matchPermitEvent(db, fultonPermitId);
    const goldBar = await matchPermitEvent(db, goldBarPermitId);
    if (!fulton.projectId || !goldBar.projectId) {
      throw new Error("Synthetic civic permits were not matched.");
    }
    projectIds.push(fulton.projectId, goldBar.projectId);

    expect(fulton.disposition).toBe("created");
    expect(goldBar.disposition).toBe("created");
    expect(fulton.projectId).not.toBe(goldBar.projectId);
    expect(fulton.projectId).not.toBe(oldProjectId);
    expect(goldBar.projectId).not.toBe(oldProjectId);

    const repaired = await db.permitEvent.findMany({
      where: { id: { in: [fultonPermitId, goldBarPermitId] } },
      select: {
        sourceRecordIdentifier: true,
        addressNormalizationVersion: true,
        projectMatchStatus: true,
        address: { select: { id: true, normalizedStreetAddress: true, unitNumber: true } },
        projectEvent: { select: { projectId: true } },
      },
      orderBy: { sourceRecordIdentifier: "asc" },
    });
    expect(repaired).toEqual([
      expect.objectContaining({
        sourceRecordIdentifier: "558684557-002",
        addressNormalizationVersion: 2,
        projectMatchStatus: ProjectMatchStatus.MATCHED,
        address: expect.objectContaining({
          normalizedStreetAddress: fultonNormalizedAddress,
          unitNumber: null,
        }),
      }),
      expect.objectContaining({
        sourceRecordIdentifier: "568953983-002",
        addressNormalizationVersion: 2,
        projectMatchStatus: ProjectMatchStatus.MATCHED,
        address: expect.objectContaining({
          normalizedStreetAddress: goldBarNormalizedAddress,
          unitNumber: null,
        }),
      }),
    ]);
    addressIds.push(...repaired.map(({ address }) => address.id));

    await expect(
      db.project.findUniqueOrThrow({ where: { id: oldProjectId } }),
    ).resolves.toMatchObject({
      category: ProjectCategory.NOT_RELEVANT,
      computedCategory: ProjectCategory.NOT_RELEVANT,
    });
  });

  it("detaches a genuinely incomplete address without rolling the repair back", async () => {
    const incompleteAddress = await db.address.create({
      data: {
        rawSourceAddress: `${streetToken} AVENUE NW`,
        normalizedStreetAddress: legacyStreetAddress,
        normalizedAddressKey: `legacy-incomplete|${suffix}`,
        neighbourhoodId: fultonNeighbourhoodId,
      },
    });
    addressIds.push(incompleteAddress.id);
    const incompleteProject = await db.project.create({
      data: {
        projectKey: `legacy-incomplete-project:${suffix}`,
        addressId: incompleteAddress.id,
        neighbourhoodId: fultonNeighbourhoodId,
        title: `${legacyStreetAddress} incomplete project`,
        category: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
        computedCategory: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
        currentStage: ProjectStage.DISCOVERED,
        computedStage: ProjectStage.DISCOVERED,
        confidenceExplanation: { summary: "Incomplete legacy address", factors: [] },
      },
    });
    projectIds.push(incompleteProject.id);
    const incompletePermit = await db.permitEvent.create({
      data: {
        sourceProvider: provider,
        sourceDataset: "development",
        sourceRecordIdentifier: `incomplete-${suffix}`,
        permitType: "Minor Development Permit",
        status: "Other",
        workDescription: "An undated source row without a civic number.",
        addressId: incompleteAddress.id,
        neighbourhoodId: fultonNeighbourhoodId,
        addressNormalizationVersion: 1,
        rawSourcePayload: { address: `${streetToken} AVENUE NW` },
      },
    });
    await db.projectEvent.create({
      data: {
        projectId: incompleteProject.id,
        permitEventId: incompletePermit.id,
        eventDate: new Date("2026-08-02T00:00:00.000Z"),
        matchReason: { strategy: "normalized-site-address", automated: true },
      },
    });

    await expect(matchPermitEvent(db, incompletePermit.id)).resolves.toEqual({
      disposition: "unassigned",
      projectId: null,
    });
    await expect(matchPermitEvent(db, incompletePermit.id)).resolves.toEqual({
      disposition: "unassigned",
      projectId: null,
    });
    await expect(
      db.permitEvent.findUniqueOrThrow({
        where: { id: incompletePermit.id },
        select: {
          addressNormalizationVersion: true,
          projectMatchStatus: true,
          projectEvent: true,
        },
      }),
    ).resolves.toEqual({
      addressNormalizationVersion: 2,
      projectMatchStatus: ProjectMatchStatus.UNMATCHABLE,
      projectEvent: null,
    });
    await expect(
      db.permitEvent.count({
        where: {
          id: incompletePermit.id,
          OR: [
            { projectMatchStatus: ProjectMatchStatus.PENDING },
            { addressNormalizationVersion: { lt: 2 } },
          ],
        },
      }),
    ).resolves.toBe(0);
    await expect(
      db.project.findUniqueOrThrow({ where: { id: incompleteProject.id } }),
    ).resolves.toMatchObject({
      category: ProjectCategory.NOT_RELEVANT,
      computedCategory: ProjectCategory.NOT_RELEVANT,
    });
  });

  it("repairs an existing numeric comma-prefixed unit", async () => {
    const legacyAddress = await db.address.create({
      data: {
        rawSourceAddress: condoRawAddress,
        normalizedStreetAddress: condoLegacyAddress,
        normalizedAddressKey: `legacy-comma-unit|${suffix}`,
        neighbourhoodId: fultonNeighbourhoodId,
      },
    });
    addressIds.push(legacyAddress.id);
    const legacyProject = await db.project.create({
      data: {
        projectKey: `legacy-comma-unit-project:${suffix}`,
        addressId: legacyAddress.id,
        neighbourhoodId: fultonNeighbourhoodId,
        title: `${condoLegacyAddress} legacy unit project`,
        category: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
        computedCategory: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
        currentStage: ProjectStage.DEVELOPMENT_PERMIT,
        computedStage: ProjectStage.DEVELOPMENT_PERMIT,
        confidenceExplanation: { summary: "Legacy comma-prefixed unit", factors: [] },
      },
    });
    projectIds.push(legacyProject.id);
    const permit = await db.permitEvent.create({
      data: {
        sourceProvider: provider,
        sourceDataset: "development",
        sourceRecordIdentifier: `comma-unit-${suffix}`,
        permitType: "Development Permit",
        issueDate: new Date("2025-07-10T00:00:00.000Z"),
        addressId: legacyAddress.id,
        neighbourhoodId: fultonNeighbourhoodId,
        addressNormalizationVersion: 1,
        rawSourcePayload: { address: condoRawAddress },
      },
    });
    await db.projectEvent.create({
      data: {
        projectId: legacyProject.id,
        permitEventId: permit.id,
        eventDate: new Date("2025-07-10T00:00:00.000Z"),
        matchReason: { strategy: "normalized-site-address", automated: true },
      },
    });

    const matched = await matchPermitEvent(db, permit.id);
    if (!matched.projectId) throw new Error("Synthetic condo permit was not matched.");
    projectIds.push(matched.projectId);

    expect(matched).toMatchObject({ disposition: "created" });
    const repairedPermit = await db.permitEvent.findUniqueOrThrow({
      where: { id: permit.id },
      select: {
        addressNormalizationVersion: true,
        projectMatchStatus: true,
        address: {
          select: { id: true, normalizedStreetAddress: true, unitNumber: true },
        },
      },
    });
    expect(repairedPermit).toMatchObject({
      addressNormalizationVersion: 2,
      projectMatchStatus: ProjectMatchStatus.MATCHED,
      address: {
        normalizedStreetAddress: condoNormalizedAddress,
        unitNumber: "317",
      },
    });
    addressIds.push(repairedPermit.address.id);
    await expect(
      db.project.findUniqueOrThrow({ where: { id: legacyProject.id } }),
    ).resolves.toMatchObject({
      category: ProjectCategory.NOT_RELEVANT,
      computedCategory: ProjectCategory.NOT_RELEVANT,
    });
  });

  it("automatically reunites the 5215 101A development and building permits", async () => {
    const rawAddress = "5215 - 101A AVENUE NW";
    const normalizedAddress = "5215 101A AVE NW";
    const latitude = 53.541947022;
    const longitude = -113.420761618;
    const legacyAddress = await db.address.create({
      data: {
        rawSourceAddress: rawAddress,
        normalizedStreetAddress: "101A AVE NW",
        normalizedAddressKey: `legacy-5215-101a|${suffix}`,
        unitNumber: "5215",
        neighbourhoodId: fultonNeighbourhoodId,
      },
    });
    addressIds.push(legacyAddress.id);
    const legacyProject = await db.project.create({
      data: {
        projectKey: `legacy-5215-101a-project:${suffix}`,
        addressId: legacyAddress.id,
        neighbourhoodId: fultonNeighbourhoodId,
        title: "101A AVE NW infill activity",
        category: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
        computedCategory: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
        currentStage: ProjectStage.BUILDING_PERMIT,
        computedStage: ProjectStage.BUILDING_PERMIT,
        confidenceExplanation: { summary: "Legacy street-wide project", factors: [] },
      },
    });
    projectIds.push(legacyProject.id);

    const permits = await Promise.all([
      db.permitEvent.create({
        data: {
          id: `address-repair-a-${suffix}`,
          sourceProvider: provider,
          sourceDataset: "development",
          sourceRecordIdentifier: "659145196-002",
          permitNumber: "659145196-002",
          permitType: "Minor Development Permit",
          status: "Approved",
          workDescription: "To construct a Residential Use building as a Single Detached House.",
          issueDate: new Date("2026-06-26T00:00:00.000Z"),
          addressId: legacyAddress.id,
          neighbourhoodId: fultonNeighbourhoodId,
          addressNormalizationVersion: 1,
          projectMatchStatus: ProjectMatchStatus.MATCHED,
          rawSourcePayload: {
            address: rawAddress,
            latitude: String(latitude),
            longitude: String(longitude),
          },
        },
      }),
      db.permitEvent.create({
        data: {
          id: `address-repair-b-${suffix}`,
          sourceProvider: provider,
          sourceDataset: "building",
          sourceRecordIdentifier: "2-659134782",
          permitType: "Single, Semi-detached & Rowhousing",
          permitSubtype: "(01) Building - New",
          status: "Issued",
          workDescription: "To construct a Residential Use building as a Single Detached House.",
          buildingType: "Single Detached House (110)",
          issueDate: new Date("2026-07-08T00:00:00.000Z"),
          addressId: legacyAddress.id,
          neighbourhoodId: fultonNeighbourhoodId,
          addressNormalizationVersion: 1,
          projectMatchStatus: ProjectMatchStatus.MATCHED,
          rawSourcePayload: { address: rawAddress },
        },
      }),
      db.permitEvent.create({
        data: {
          id: `address-repair-c-${suffix}`,
          sourceProvider: provider,
          sourceDataset: "building",
          sourceRecordIdentifier: "4-659134782",
          permitType: "Home Improvement",
          status: "Issued",
          workDescription: "To construct an Accessory building (detached Garage).",
          buildingType: "Single Detached House (110)",
          issueDate: new Date("2026-07-13T00:00:00.000Z"),
          addressId: legacyAddress.id,
          neighbourhoodId: fultonNeighbourhoodId,
          addressNormalizationVersion: 1,
          projectMatchStatus: ProjectMatchStatus.MATCHED,
          rawSourcePayload: { address: rawAddress },
        },
      }),
    ]);
    await db.projectEvent.createMany({
      data: permits.map((permit) => ({
        projectId: legacyProject.id,
        permitEventId: permit.id,
        eventDate: permit.issueDate!,
        matchReason: { strategy: "normalized-site-address", automated: true },
      })),
    });

    const activePipeline = await db.jobRun.findFirst({
      where: { conflictKey: permitImportConflictKey },
      select: { id: true, conflictKey: true },
    });
    if (activePipeline) {
      await db.jobRun.update({
        where: { id: activePipeline.id },
        data: { conflictKey: null },
      });
    }

    let repairJobId: string | null = null;
    try {
      const queued = await ensureAddressReconciliationJob(db);
      expect(queued.status).toBe("enqueued");
      if (queued.status !== "enqueued") throw new Error("Address repair was not enqueued.");
      repairJobId = queued.jobId;
      const leaseToken = `address-repair-worker:${suffix}`;
      const now = new Date();
      await db.jobRun.update({
        where: { id: queued.jobId },
        data: {
          status: RunStatus.RUNNING,
          lockKey: leaseToken,
          startedAt: now,
          heartbeatAt: now,
          lockExpiresAt: new Date(now.getTime() + 60_000),
        },
      });

      const result = await runProjectMatchingJob(db, undefined, {
        jobRunId: queued.jobId,
        leaseToken,
      });
      expect(result.failed).toBe(0);
      expect(result.successful).toBeGreaterThanOrEqual(3);

      const repaired = await db.permitEvent.findMany({
        where: { id: { in: permits.map(({ id }) => id) } },
        select: {
          sourceRecordIdentifier: true,
          addressNormalizationVersion: true,
          projectMatchStatus: true,
          address: {
            select: {
              id: true,
              normalizedStreetAddress: true,
              unitNumber: true,
              latitude: true,
              longitude: true,
            },
          },
          projectEvent: { select: { projectId: true } },
        },
        orderBy: { sourceRecordIdentifier: "asc" },
      });
      expect(repaired).toHaveLength(3);
      expect(new Set(repaired.map(({ projectEvent }) => projectEvent?.projectId)).size).toBe(1);
      expect(new Set(repaired.map(({ address }) => address.id)).size).toBe(1);
      expect(
        repaired.every(
          ({ address, addressNormalizationVersion, projectMatchStatus }) =>
            address.normalizedStreetAddress === normalizedAddress &&
            address.unitNumber === null &&
            Number(address.latitude) === latitude &&
            Number(address.longitude) === longitude &&
            addressNormalizationVersion === 2 &&
            projectMatchStatus === ProjectMatchStatus.MATCHED,
        ),
      ).toBe(true);

      const correctedProjectId = repaired[0]?.projectEvent?.projectId;
      if (!correctedProjectId) throw new Error("Corrected civic project was not created.");
      projectIds.push(correctedProjectId);
      addressIds.push(repaired[0]!.address.id);
      await expect(
        db.project.findUniqueOrThrow({
          where: { id: correctedProjectId },
          select: {
            title: true,
            address: { select: { latitude: true, longitude: true } },
          },
        }),
      ).resolves.toMatchObject({
        title: `${normalizedAddress} infill activity`,
        address: { latitude: expect.anything(), longitude: expect.anything() },
      });
      const correctedProject = await db.project.findUniqueOrThrow({
        where: { id: correctedProjectId },
        select: { address: { select: { latitude: true, longitude: true } } },
      });
      expect(Number(correctedProject.address.latitude)).toBe(latitude);
      expect(Number(correctedProject.address.longitude)).toBe(longitude);
      await expect(
        db.project.findUniqueOrThrow({ where: { id: legacyProject.id } }),
      ).resolves.toMatchObject({
        category: ProjectCategory.NOT_RELEVANT,
        computedCategory: ProjectCategory.NOT_RELEVANT,
      });
    } finally {
      if (repairJobId) {
        await db.jobRun.deleteMany({ where: { id: repairJobId } });
      }
      if (activePipeline?.conflictKey) {
        await db.jobRun.update({
          where: { id: activePipeline.id },
          data: { conflictKey: activePipeline.conflictKey },
        });
      }
    }
  });
});
