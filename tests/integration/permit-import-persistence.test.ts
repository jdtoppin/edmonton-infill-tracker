import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { getDb } from "../../src/lib/db";
import type {
  NormalizedPermitRecord,
  PermitDataProvider,
  PermitDataset,
  PermitProviderPage,
  ProviderDatasetMetadata,
  RawPermitPayload,
} from "../../src/providers";
import { PrismaPermitImportRepository, runPermitImport } from "../../src/services/permit-import";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("permit import persistence", () => {
  const sourceProvider = `integration-${randomUUID()}`;
  const sourceProviderKey = `${sourceProvider}:24uj-dj8v`;
  const sourceRecordIdentifier = `row-${randomUUID()}`;
  const neighbourhoodCityId = `test-${randomUUID()}`;
  const address = `${Math.floor(Math.random() * 80_000) + 10_000} TEST STREET NW`;
  let db: PrismaClient;

  class OneRowProvider implements PermitDataProvider {
    readonly providerId = sourceProvider;

    constructor(
      readonly revision: string,
      readonly occupancyGrantedDate: string | null,
    ) {}

    async getDatasetMetadata(dataset: PermitDataset): Promise<ProviderDatasetMetadata> {
      return {
        sourceProvider,
        sourceDataset: dataset,
        sourceDatasetId: "24uj-dj8v",
        revision: this.revision,
        rowCount: 1,
        schemaFingerprint: "b".repeat(64),
        columns: [],
        fetchedAt: new Date(),
      };
    }

    async fetchPage(): Promise<PermitProviderPage> {
      return this.page();
    }

    async *pages(): AsyncGenerator<PermitProviderPage> {
      yield this.page();
    }

    private page(): PermitProviderPage {
      const payload: RawPermitPayload = {
        row_id: sourceRecordIdentifier,
        address,
        occupancy_granted_date: this.occupancyGrantedDate,
      };
      const permit: NormalizedPermitRecord = {
        sourceProvider,
        sourceDataset: "building",
        sourceDatasetId: "24uj-dj8v",
        sourceRecordIdentifier,
        systemId: null,
        sourceUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
        permitNumber: null,
        permitType: "New House",
        permitSubtype: "New",
        applicationDate: null,
        issueDate: new Date("2026-06-01T00:00:00.000Z"),
        status: "Issued",
        workDescription: "Construct a new detached house",
        buildingType: "Single Detached House",
        constructionValue: "500000.00",
        unitsAdded: 1,
        occupancyGrantedDate: this.occupancyGrantedDate
          ? new Date(`${this.occupancyGrantedDate}T00:00:00.000Z`)
          : null,
        rawAddress: address,
        neighbourhoodCityId,
        neighbourhoodName: "INTEGRATION TEST",
        latitude: 53.5,
        longitude: -113.5,
      };
      return {
        sourceProvider,
        sourceDataset: "building",
        sourceDatasetId: "24uj-dj8v",
        revision: this.revision,
        schemaFingerprint: "b".repeat(64),
        rows: [
          {
            ok: true,
            rawRecord: {
              sourceProvider,
              sourceDataset: "building",
              sourceDatasetId: "24uj-dj8v",
              sourceRecordIdentifier,
              systemId: null,
              sourceUpdatedAt: permit.sourceUpdatedAt,
              payload,
            },
            permit,
          },
        ],
        fetchedCount: 1,
        nextCursor: null,
      };
    }
  }

  beforeAll(async () => {
    db = await getDb();
  });

  afterAll(async () => {
    await db.permitEvent.deleteMany({ where: { sourceProvider: sourceProviderKey } });
    await db.rawPermitRecord.deleteMany({ where: { sourceProvider: sourceProviderKey } });
    await db.importRun.deleteMany({ where: { sourceProvider: sourceProviderKey } });
    await db.address.deleteMany({ where: { rawSourceAddress: address } });
    await db.neighbourhood.deleteMany({ where: { cityNeighbourhoodId: neighbourhoodCityId } });
  });

  it("round-trips occupancy DATE values and remains idempotent across revisions", async () => {
    const repository = new PrismaPermitImportRepository(db);
    const initial = await runPermitImport({
      provider: new OneRowProvider("revision-1", null),
      repository,
      dataset: "building",
    });
    expect(initial.counts.created).toBe(1);

    const updated = await runPermitImport({
      provider: new OneRowProvider("revision-2", "2026-07-30"),
      repository,
      dataset: "building",
    });
    expect(updated.counts.updated).toBe(1);

    const stored = await db.permitEvent.findUniqueOrThrow({
      where: {
        sourceProvider_sourceRecordIdentifier: {
          sourceProvider: sourceProviderKey,
          sourceRecordIdentifier,
        },
      },
    });
    expect(stored.sourceDataset).toBe("building");
    expect(stored.occupancyGrantedDate?.toISOString()).toBe("2026-07-30T00:00:00.000Z");

    const unchanged = await runPermitImport({
      provider: new OneRowProvider("revision-2", "2026-07-30"),
      repository,
      dataset: "building",
    });
    expect(unchanged.skippedUnchangedSnapshot).toBe(true);
    expect(await db.rawPermitRecord.count({ where: { sourceProvider: sourceProviderKey } })).toBe(
      1,
    );
    expect(await db.permitEvent.count({ where: { sourceProvider: sourceProviderKey } })).toBe(1);
  });
});
