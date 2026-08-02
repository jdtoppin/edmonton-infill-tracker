import { describe, expect, it } from "vitest";

import type {
  NormalizedPermitRecord,
  PermitDataProvider,
  PermitDataset,
  PermitProviderPage,
  PermitProviderRowResult,
  ProviderDatasetMetadata,
  ProviderRawRecord,
  RawPermitPayload,
} from "../../src/providers";
import {
  canonicalJson,
  PermitPersistenceError,
  runPermitImport,
  SnapshotRowCountError,
  type PermitImportRepository,
  type RejectedRawRecordInput,
  type StageRawRecordInput,
} from "../../src/services/permit-import";

const schemaFingerprint = "a".repeat(64);

function normalizedPermit(
  identifier: string,
  occupancyGrantedDate: Date | null,
): NormalizedPermitRecord {
  return {
    sourceProvider: "edmonton-open-data",
    sourceDataset: "building",
    sourceDatasetId: "24uj-dj8v",
    sourceRecordIdentifier: identifier,
    systemId: `system-${identifier}`,
    sourceUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
    permitNumber: null,
    permitType: "New House",
    permitSubtype: "New",
    applicationDate: null,
    issueDate: new Date("2026-06-01T00:00:00.000Z"),
    status: "Issued",
    workDescription: "Construct a new detached house",
    buildingType: "Single Detached House",
    constructionValue: "500000",
    unitsAdded: 1,
    occupancyGrantedDate,
    rawAddress: "10001 100 STREET NW",
    neighbourhoodCityId: "1010",
    neighbourhoodName: "TEST",
    latitude: 53.5,
    longitude: -113.5,
  };
}

function validRow(
  identifier: string,
  occupancy: string | null,
): Extract<PermitProviderRowResult, { ok: true }> {
  const payload: RawPermitPayload = {
    row_id: identifier,
    address: "10001 100 STREET NW",
    occupancy_granted_date: occupancy,
  };
  const rawRecord: ProviderRawRecord = {
    sourceProvider: "edmonton-open-data",
    sourceDataset: "building",
    sourceDatasetId: "24uj-dj8v",
    sourceRecordIdentifier: identifier,
    systemId: `system-${identifier}`,
    sourceUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
    payload,
  };
  return {
    ok: true,
    rawRecord,
    permit: normalizedPermit(identifier, occupancy ? new Date(`${occupancy}T00:00:00.000Z`) : null),
  };
}

function invalidRow(identifier: string): Extract<PermitProviderRowResult, { ok: false }> {
  return {
    ok: false,
    rawRecord: {
      sourceProvider: "edmonton-open-data",
      sourceDataset: "building",
      sourceDatasetId: "24uj-dj8v",
      sourceRecordIdentifier: identifier,
      systemId: null,
      sourceUpdatedAt: null,
      payload: { row_id: identifier, address: "" },
    },
    error: {
      code: "INVALID_SOURCE_ROW",
      message: "The source row is invalid.",
      issues: ["rawAddress"],
    },
  };
}

class FakeProvider implements PermitDataProvider {
  readonly providerId = "edmonton-open-data";

  constructor(
    readonly revision: string,
    readonly rows: readonly PermitProviderRowResult[],
    readonly reportedRowCount = rows.length,
  ) {}

  async getDatasetMetadata(dataset: PermitDataset): Promise<ProviderDatasetMetadata> {
    return {
      sourceProvider: this.providerId,
      sourceDataset: dataset,
      sourceDatasetId: dataset === "building" ? "24uj-dj8v" : "2ccn-pwtu",
      revision: this.revision,
      rowCount: this.reportedRowCount,
      schemaFingerprint,
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
    return {
      sourceProvider: this.providerId,
      sourceDataset: "building",
      sourceDatasetId: "24uj-dj8v",
      revision: this.revision,
      schemaFingerprint,
      rows: this.rows,
      fetchedCount: this.rows.length,
      nextCursor: null,
    };
  }
}

class FakeRepository implements PermitImportRepository {
  successfulCursor: string | null = null;
  runSequence = 0;
  failedRun = false;
  completionStatus: string | null = null;
  persistFailure: Error | null = null;
  processingFailures = 0;
  rejected: RejectedRawRecordInput[] = [];
  records = new Map<
    string,
    { id: string; checksum: string; processed: boolean; occupancyGrantedDate: Date | null }
  >();

  async findLatestAcceptedSnapshotCursor() {
    return this.successfulCursor;
  }

  async createRun() {
    this.runSequence += 1;
    return { id: `run-${this.runSequence}` };
  }

  async stageRawRecord(input: StageRawRecordInput) {
    const identifier = input.rawRecord.sourceRecordIdentifier!;
    const existing = this.records.get(identifier);
    if (existing?.checksum === input.checksum && existing.processed) {
      return { id: existing.id, disposition: "unchanged" as const };
    }
    if (existing) {
      existing.checksum = input.checksum;
      existing.processed = false;
      return { id: existing.id, disposition: "updated" as const };
    }
    const created = {
      id: `raw-${identifier}`,
      checksum: input.checksum,
      processed: false,
      occupancyGrantedDate: null,
    };
    this.records.set(identifier, created);
    return { id: created.id, disposition: "created" as const };
  }

  async persistPermit(
    input: Parameters<PermitImportRepository["persistPermit"]>[0],
  ): Promise<void> {
    if (this.persistFailure) throw this.persistFailure;
    const record = this.records.get(input.permit.sourceRecordIdentifier)!;
    record.processed = true;
    record.occupancyGrantedDate = input.permit.occupancyGrantedDate;
  }

  async rejectRawRecord(input: RejectedRawRecordInput): Promise<void> {
    this.rejected.push(input);
  }

  async markProcessingFailure(): Promise<void> {
    this.processingFailures += 1;
  }

  async updateRunProgress(): Promise<void> {}

  async completeRun(input: {
    status: "SUCCEEDED" | "PARTIALLY_SUCCEEDED";
    endCursor: string | null;
  }): Promise<void> {
    this.completionStatus = input.status;
    if (input.endCursor) {
      this.successfulCursor = input.endCursor;
    }
  }

  async failRun(): Promise<void> {
    this.failedRun = true;
  }
}

describe("permit snapshot import runner", () => {
  it("uses canonical content hashes independent of object key order", () => {
    expect(canonicalJson({ b: 2, a: { z: true, y: null } })).toBe(
      canonicalJson({ a: { y: null, z: true }, b: 2 }),
    );
  });

  it("tracks occupancy added later, then skips the accepted unchanged revision", async () => {
    const repository = new FakeRepository();

    const first = await runPermitImport({
      provider: new FakeProvider("revision-1", [validRow("row-1", null)]),
      repository,
      dataset: "building",
    });
    expect(first.counts).toMatchObject({ created: 1, updated: 0, skipped: 0, failed: 0 });
    expect(repository.records.get("row-1")?.occupancyGrantedDate).toBeNull();

    const second = await runPermitImport({
      provider: new FakeProvider("revision-2", [validRow("row-1", "2026-07-30")]),
      repository,
      dataset: "building",
    });
    expect(second.counts).toMatchObject({ created: 0, updated: 1, skipped: 0, failed: 0 });
    expect(repository.records.get("row-1")?.occupancyGrantedDate?.toISOString()).toBe(
      "2026-07-30T00:00:00.000Z",
    );

    const third = await runPermitImport({
      provider: new FakeProvider("revision-2", [validRow("row-1", "2026-07-30")]),
      repository,
      dataset: "building",
    });
    expect(third.skippedUnchangedSnapshot).toBe(true);
    expect(third.counts.fetched).toBe(0);
  });

  it("mirrors corrected and removed occupancy dates without inventing revocation state", async () => {
    const repository = new FakeRepository();
    await runPermitImport({
      provider: new FakeProvider("revision-1", [validRow("row-1", "2026-07-30")]),
      repository,
      dataset: "building",
    });
    await runPermitImport({
      provider: new FakeProvider("revision-2", [validRow("row-1", "2026-07-31")]),
      repository,
      dataset: "building",
    });
    expect(repository.records.get("row-1")?.occupancyGrantedDate?.getUTCDate()).toBe(31);

    const removed = await runPermitImport({
      provider: new FakeProvider("revision-3", [validRow("row-1", null)]),
      repository,
      dataset: "building",
    });
    expect(removed.counts.updated).toBe(1);
    expect(repository.records.get("row-1")?.occupancyGrantedDate).toBeNull();
  });

  it("quarantines invalid rows and checkpoints the fully traversed snapshot", async () => {
    const repository = new FakeRepository();
    const result = await runPermitImport({
      provider: new FakeProvider("revision-partial", [validRow("good", null), invalidRow("bad")]),
      repository,
      dataset: "building",
    });

    expect(result.status).toBe("PARTIALLY_SUCCEEDED");
    expect(result.counts).toMatchObject({ fetched: 2, created: 1, failed: 1 });
    expect(repository.rejected).toHaveLength(1);
    expect(repository.successfulCursor).not.toBeNull();

    const repeated = await runPermitImport({
      provider: new FakeProvider("revision-partial", [validRow("good", null), invalidRow("bad")]),
      repository,
      dataset: "building",
    });
    expect(repeated.skippedUnchangedSnapshot).toBe(true);
  });

  it("does not checkpoint a transient persistence failure and retries the unchanged revision", async () => {
    const repository = new FakeRepository();
    repository.persistFailure = new Error("Temporary database failure");
    const provider = new FakeProvider("revision-retry", [validRow("retry-row", "2026-07-30")]);

    await expect(
      runPermitImport({ provider, repository, dataset: "building" }),
    ).rejects.toBeInstanceOf(PermitPersistenceError);
    expect(repository.failedRun).toBe(true);
    expect(repository.processingFailures).toBe(1);
    expect(repository.successfulCursor).toBeNull();

    repository.persistFailure = null;
    repository.failedRun = false;
    const retried = await runPermitImport({ provider, repository, dataset: "building" });
    expect(retried.skippedUnchangedSnapshot).toBe(false);
    expect(retried.counts).toMatchObject({ fetched: 1, updated: 1, failed: 0 });
    expect(repository.records.get("retry-row")?.occupancyGrantedDate?.toISOString()).toBe(
      "2026-07-30T00:00:00.000Z",
    );
  });

  it("does not let a date-range backfill suppress the next complete snapshot", async () => {
    const repository = new FakeRepository();
    const revision = "shared-revision";

    const backfill = await runPermitImport({
      provider: new FakeProvider(revision, [validRow("range-row", null)]),
      repository,
      dataset: "building",
      mode: "BACKFILL",
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-01-31T00:00:00.000Z"),
    });
    expect(backfill.skippedUnchangedSnapshot).toBe(false);
    expect(repository.successfulCursor).toBeNull();

    const incremental = await runPermitImport({
      provider: new FakeProvider(revision, [
        validRow("range-row", null),
        validRow("outside-range", null),
      ]),
      repository,
      dataset: "building",
    });
    expect(incremental.skippedUnchangedSnapshot).toBe(false);
    expect(incremental.counts).toMatchObject({ fetched: 2, created: 1, skipped: 1 });
  });

  it("quarantines provider rows whose raw and normalized identities disagree", async () => {
    const repository = new FakeRepository();
    const mismatched = validRow("raw-id", null);
    mismatched.permit = { ...mismatched.permit, sourceRecordIdentifier: "different-id" };

    const result = await runPermitImport({
      provider: new FakeProvider("identity-revision", [mismatched]),
      repository,
      dataset: "building",
    });
    expect(result.status).toBe("PARTIALLY_SUCCEEDED");
    expect(repository.rejected[0]?.errorCode).toBe("PROVIDER_IDENTITY_MISMATCH");
    expect(repository.records.size).toBe(0);
  });

  it("fails rather than accepting an incomplete full snapshot", async () => {
    const repository = new FakeRepository();
    await expect(
      runPermitImport({
        provider: new FakeProvider("revision-short", [validRow("only-row", null)], 2),
        repository,
        dataset: "building",
      }),
    ).rejects.toBeInstanceOf(SnapshotRowCountError);
    expect(repository.failedRun).toBe(true);
    expect(repository.successfulCursor).toBeNull();
  });
});
