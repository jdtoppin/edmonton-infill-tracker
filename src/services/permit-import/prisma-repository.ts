import { normalizeEdmontonAddress } from "../../domain/address-normalization";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  ImportMode,
  NeighbourhoodNameSource,
  RawRecordStatus,
  RunStatus,
} from "../../generated/prisma/enums";
import type { RawPermitPayload } from "../../providers";
import type {
  PermitImportRepository,
  RejectedRawRecordInput,
  StageRawRecordInput,
  StagedRawRecord,
} from "./types";

function jsonInput(payload: RawPermitPayload) {
  return payload;
}

function cleanFailureMessage(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 1_000);
}

interface PermitNeighbourhoodDelegate {
  upsert(input: {
    where: { cityNeighbourhoodId: string };
    create: {
      cityNeighbourhoodId: string;
      name: string;
      nameSource: NeighbourhoodNameSource;
    };
    update: Record<string, never>;
    select: { id: true };
  }): Promise<{ id: string }>;
  updateMany(input: {
    where: { id: string; nameSource: NeighbourhoodNameSource };
    data: { name: string };
  }): Promise<{ count: number }>;
}

/**
 * Creates a usable name from a permit row, but only refreshes existing names
 * that still originate from permits. The conditional update remains safe if
 * the authoritative City sync commits between the upsert and update.
 */
export async function upsertPermitNeighbourhood(
  neighbourhoods: PermitNeighbourhoodDelegate,
  cityNeighbourhoodId: string,
  name: string,
): Promise<string> {
  const neighbourhood = await neighbourhoods.upsert({
    where: { cityNeighbourhoodId },
    create: {
      cityNeighbourhoodId,
      name,
      nameSource: NeighbourhoodNameSource.PERMIT,
    },
    update: {},
    select: { id: true },
  });
  await neighbourhoods.updateMany({
    where: {
      id: neighbourhood.id,
      nameSource: NeighbourhoodNameSource.PERMIT,
    },
    data: { name },
  });
  return neighbourhood.id;
}

export interface PrismaPermitImportFence {
  jobRunId: string;
  leaseToken: string;
}

export class PermitImportFenceError extends Error {
  constructor() {
    super("The worker no longer owns the active permit import lease.");
    this.name = "PermitImportFenceError";
  }
}

export class PrismaPermitImportRepository implements PermitImportRepository {
  constructor(
    private readonly db: PrismaClient,
    private readonly fence?: PrismaPermitImportFence,
  ) {}

  private async lockJobFence(transaction: Prisma.TransactionClient): Promise<void> {
    if (!this.fence) return;
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "JobRun"
      WHERE "id" = ${this.fence.jobRunId}
        AND "status" = ${RunStatus.RUNNING}::"RunStatus"
        AND "lockKey" = ${this.fence.leaseToken}
      FOR SHARE
    `;
    if (rows.length !== 1) throw new PermitImportFenceError();
  }

  private async lockActiveRun(transaction: Prisma.TransactionClient, runId: string): Promise<void> {
    const rows = this.fence
      ? await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "ImportRun"
          WHERE "id" = ${runId}
            AND "status" = ${RunStatus.RUNNING}::"RunStatus"
            AND "jobRunId" = ${this.fence.jobRunId}
            AND "leaseToken" = ${this.fence.leaseToken}
          FOR UPDATE
        `
      : await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "ImportRun"
          WHERE "id" = ${runId}
            AND "status" = ${RunStatus.RUNNING}::"RunStatus"
          FOR UPDATE
        `;
    if (rows.length !== 1) throw new PermitImportFenceError();
  }

  private async withActiveRun<T>(
    runId: string,
    mutation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction(async (transaction) => {
      // Recovery locks in this same order: JobRun, then ImportRun.
      await this.lockJobFence(transaction);
      await this.lockActiveRun(transaction, runId);
      return mutation(transaction);
    });
  }

  async findLatestAcceptedSnapshotCursor(sourceProviderKey: string): Promise<string | null> {
    const run = await this.db.importRun.findFirst({
      where: {
        sourceProvider: sourceProviderKey,
        status: { in: [RunStatus.SUCCEEDED, RunStatus.PARTIALLY_SUCCEEDED] },
        endCursor: { not: null },
      },
      orderBy: { completedAt: "desc" },
      select: { endCursor: true },
    });
    return run?.endCursor ?? null;
  }

  async createRun(input: Parameters<PermitImportRepository["createRun"]>[0]) {
    return this.db.$transaction(async (transaction) => {
      // Unfenced construction is retained for direct, non-worker imports and
      // persistence integration tests. The production worker always supplies a fence.
      await this.lockJobFence(transaction);
      return transaction.importRun.create({
        data: {
          sourceProvider: input.sourceProviderKey,
          activeKey: input.sourceProviderKey,
          jobRunId: this.fence?.jobRunId,
          leaseToken: this.fence?.leaseToken,
          mode: ImportMode[input.mode],
          status: RunStatus.RUNNING,
          requestedFrom: input.requestedFrom,
          requestedTo: input.requestedTo,
          startCursor: input.startCursor,
          startedAt: new Date(),
        },
        select: { id: true },
      });
    });
  }

  async stageRawRecord(input: StageRawRecordInput): Promise<StagedRawRecord> {
    return this.withActiveRun(input.runId, async (transaction) => {
      const key = {
        sourceProvider: input.sourceProviderKey,
        sourceRecordIdentifier: input.rawRecord.sourceRecordIdentifier!,
      };
      const existing = await transaction.rawPermitRecord.findUnique({
        where: { sourceProvider_sourceRecordIdentifier: key },
        select: {
          id: true,
          payloadChecksum: true,
          processingStatus: true,
          permitEvent: { select: { id: true } },
        },
      });

      if (
        existing?.payloadChecksum === input.checksum &&
        (existing.processingStatus === RawRecordStatus.PROCESSED ||
          existing.processingStatus === RawRecordStatus.SKIPPED) &&
        existing.permitEvent
      ) {
        await transaction.rawPermitRecord.update({
          where: { id: existing.id },
          data: {
            lastImportedAt: new Date(),
            importRunId: input.runId,
            processingStatus: RawRecordStatus.SKIPPED,
            processingError: null,
          },
        });
        return { id: existing.id, disposition: "unchanged" as const };
      }

      if (existing) {
        await transaction.rawPermitRecord.update({
          where: { id: existing.id },
          data: {
            payload: jsonInput(input.rawRecord.payload),
            payloadChecksum: input.checksum,
            sourceUpdatedAt: input.rawRecord.sourceUpdatedAt,
            processingStatus: RawRecordStatus.PENDING,
            processingError: null,
            lastImportedAt: new Date(),
            importRunId: input.runId,
          },
        });
        return { id: existing.id, disposition: "updated" as const };
      }

      const created = await transaction.rawPermitRecord.create({
        data: {
          sourceProvider: input.sourceProviderKey,
          sourceRecordIdentifier: input.rawRecord.sourceRecordIdentifier!,
          payload: jsonInput(input.rawRecord.payload),
          payloadChecksum: input.checksum,
          sourceUpdatedAt: input.rawRecord.sourceUpdatedAt,
          processingStatus: RawRecordStatus.PENDING,
          importRunId: input.runId,
        },
        select: { id: true },
      });
      return { id: created.id, disposition: "created" as const };
    });
  }

  async persistPermit(input: Parameters<PermitImportRepository["persistPermit"]>[0]) {
    const normalizedAddress = normalizeEdmontonAddress(input.permit.rawAddress);
    if (!normalizedAddress.normalizedAddressKey) {
      throw new Error("Permit address could not be normalized.");
    }

    await this.withActiveRun(input.runId, async (transaction) => {
      let neighbourhoodId: string | null = null;
      if (input.permit.neighbourhoodCityId && input.permit.neighbourhoodName) {
        neighbourhoodId = await upsertPermitNeighbourhood(
          transaction.neighbourhood,
          input.permit.neighbourhoodCityId,
          input.permit.neighbourhoodName,
        );
      }

      const address = await transaction.address.upsert({
        where: { normalizedAddressKey: normalizedAddress.normalizedAddressKey },
        create: {
          rawSourceAddress: normalizedAddress.rawSourceAddress,
          normalizedStreetAddress: normalizedAddress.normalizedStreetAddress,
          normalizedAddressKey: normalizedAddress.normalizedAddressKey,
          unitNumber: normalizedAddress.unitNumber,
          city: normalizedAddress.city,
          province: normalizedAddress.province,
          postalCode: normalizedAddress.postalCode,
          latitude: input.permit.latitude,
          longitude: input.permit.longitude,
          neighbourhoodId,
        },
        update: {
          rawSourceAddress: normalizedAddress.rawSourceAddress,
          normalizedStreetAddress: normalizedAddress.normalizedStreetAddress,
          unitNumber: normalizedAddress.unitNumber,
          postalCode: normalizedAddress.postalCode ?? undefined,
          latitude: input.permit.latitude ?? undefined,
          longitude: input.permit.longitude ?? undefined,
          neighbourhoodId: neighbourhoodId ?? undefined,
        },
        select: { id: true },
      });

      const permitData = {
        sourceDataset: input.permit.sourceDataset,
        permitNumber: input.permit.permitNumber,
        permitType: input.permit.permitType,
        permitSubtype: input.permit.permitSubtype,
        applicationDate: input.permit.applicationDate,
        issueDate: input.permit.issueDate,
        status: input.permit.status,
        workDescription: input.permit.workDescription,
        buildingType: input.permit.buildingType,
        constructionValue: input.permit.constructionValue,
        unitsAdded: input.permit.unitsAdded,
        occupancyGrantedDate: input.permit.occupancyGrantedDate,
        addressId: address.id,
        neighbourhoodId,
        rawRecordId: input.rawRecordId,
        rawSourcePayload: jsonInput(input.rawPayload),
        importedAt: new Date(),
        sourceUpdatedAt: input.permit.sourceUpdatedAt,
      };

      await transaction.permitEvent.upsert({
        where: {
          sourceProvider_sourceRecordIdentifier: {
            sourceProvider: input.sourceProviderKey,
            sourceRecordIdentifier: input.permit.sourceRecordIdentifier,
          },
        },
        create: {
          sourceProvider: input.sourceProviderKey,
          sourceRecordIdentifier: input.permit.sourceRecordIdentifier,
          ...permitData,
        },
        update: permitData,
      });

      await transaction.rawPermitRecord.update({
        where: { id: input.rawRecordId },
        data: {
          processingStatus: RawRecordStatus.PROCESSED,
          processingError: null,
          importRunId: input.runId,
        },
      });
    });
  }

  async rejectRawRecord(input: RejectedRawRecordInput): Promise<void> {
    await this.withActiveRun(input.runId, async (transaction) => {
      const raw = await transaction.rawPermitRecord.upsert({
        where: {
          sourceProvider_sourceRecordIdentifier: {
            sourceProvider: input.sourceProviderKey,
            sourceRecordIdentifier: input.failureIdentifier,
          },
        },
        create: {
          sourceProvider: input.sourceProviderKey,
          sourceRecordIdentifier: input.failureIdentifier,
          payload: jsonInput(input.rawRecord.payload),
          payloadChecksum: input.checksum,
          sourceUpdatedAt: input.rawRecord.sourceUpdatedAt,
          processingStatus: RawRecordStatus.FAILED,
          processingError: cleanFailureMessage(input.errorMessage),
          importRunId: input.runId,
        },
        update: {
          payload: jsonInput(input.rawRecord.payload),
          payloadChecksum: input.checksum,
          sourceUpdatedAt: input.rawRecord.sourceUpdatedAt,
          processingStatus: RawRecordStatus.FAILED,
          processingError: cleanFailureMessage(input.errorMessage),
          lastImportedAt: new Date(),
          importRunId: input.runId,
        },
        select: { id: true },
      });

      await transaction.importFailure.upsert({
        where: {
          importRunId_sourceRecordIdentifier: {
            importRunId: input.runId,
            sourceRecordIdentifier: input.failureIdentifier,
          },
        },
        create: {
          importRunId: input.runId,
          sourceRecordIdentifier: input.failureIdentifier,
          errorCode: input.errorCode.slice(0, 100),
          errorMessage: cleanFailureMessage(input.errorMessage),
          rawPayload: jsonInput(input.rawRecord.payload),
        },
        update: {
          errorCode: input.errorCode.slice(0, 100),
          errorMessage: cleanFailureMessage(input.errorMessage),
          rawPayload: jsonInput(input.rawRecord.payload),
        },
      });

      await transaction.rawPermitRecord.update({
        where: { id: raw.id },
        data: { processingStatus: RawRecordStatus.FAILED },
      });
    });
  }

  async markProcessingFailure(
    input: Parameters<PermitImportRepository["markProcessingFailure"]>[0],
  ): Promise<void> {
    await this.withActiveRun(input.runId, async (transaction) => {
      await transaction.rawPermitRecord.update({
        where: { id: input.rawRecordId },
        data: {
          processingStatus: RawRecordStatus.FAILED,
          processingError: cleanFailureMessage(input.errorMessage),
          importRunId: input.runId,
        },
      });
      await transaction.importFailure.upsert({
        where: {
          importRunId_sourceRecordIdentifier: {
            importRunId: input.runId,
            sourceRecordIdentifier: input.sourceRecordIdentifier,
          },
        },
        create: {
          importRunId: input.runId,
          sourceRecordIdentifier: input.sourceRecordIdentifier,
          errorCode: input.errorCode.slice(0, 100),
          errorMessage: cleanFailureMessage(input.errorMessage),
          rawPayload: jsonInput(input.rawPayload),
        },
        update: {
          errorCode: input.errorCode.slice(0, 100),
          errorMessage: cleanFailureMessage(input.errorMessage),
          rawPayload: jsonInput(input.rawPayload),
        },
      });
    });
  }

  async updateRunProgress(input: Parameters<PermitImportRepository["updateRunProgress"]>[0]) {
    await this.withActiveRun(input.runId, async (transaction) => {
      await transaction.importRun.update({
        where: { id: input.runId },
        data: {
          recordsFetched: input.counts.fetched,
          recordsCreated: input.counts.created,
          recordsUpdated: input.counts.updated,
          recordsSkipped: input.counts.skipped,
          recordsFailed: input.counts.failed,
        },
      });
    });
  }

  async completeRun(input: Parameters<PermitImportRepository["completeRun"]>[0]) {
    await this.withActiveRun(input.runId, async (transaction) => {
      await transaction.importRun.update({
        where: { id: input.runId },
        data: {
          status: RunStatus[input.status],
          activeKey: null,
          endCursor: input.endCursor,
          recordsFetched: input.counts.fetched,
          recordsCreated: input.counts.created,
          recordsUpdated: input.counts.updated,
          recordsSkipped: input.counts.skipped,
          recordsFailed: input.counts.failed,
          completedAt: new Date(),
          errorSummary: input.errorSummary,
        },
      });
    });
  }

  async failRun(input: Parameters<PermitImportRepository["failRun"]>[0]) {
    await this.withActiveRun(input.runId, async (transaction) => {
      await transaction.importRun.update({
        where: { id: input.runId },
        data: {
          status: RunStatus.FAILED,
          activeKey: null,
          endCursor: null,
          recordsFetched: input.counts.fetched,
          recordsCreated: input.counts.created,
          recordsUpdated: input.counts.updated,
          recordsSkipped: input.counts.skipped,
          recordsFailed: input.counts.failed,
          completedAt: new Date(),
          errorSummary: cleanFailureMessage(input.errorSummary),
        },
      });
    });
  }
}
