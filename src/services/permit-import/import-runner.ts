import { z } from "zod";

import type {
  PermitDataProvider,
  PermitDataset,
  PermitProviderRowResult,
  ProviderDatasetMetadata,
  RawPermitPayload,
} from "../../providers";
import { checksumJson } from "./canonical-json";
import type {
  PermitImportCheckpoint,
  PermitImportCounts,
  PermitImportMode,
  PermitImportRepository,
} from "./types";

const checkpointSchema = z.object({
  version: z.literal(1),
  dataset: z.enum(["development", "building"]),
  datasetId: z.string().min(1),
  revision: z.string().min(1),
  schemaFingerprint: z.string().length(64),
  rowCount: z.number().int().nonnegative(),
});

export class DuplicateSourceIdentifierError extends Error {
  constructor(dataset: PermitDataset) {
    super(`The ${dataset} snapshot contains a duplicate durable source identifier.`);
    this.name = "DuplicateSourceIdentifierError";
  }
}

export class SnapshotRowCountError extends Error {
  constructor(expected: number, actual: number) {
    super(`The complete snapshot returned ${actual} rows; metadata reported ${expected}.`);
    this.name = "SnapshotRowCountError";
  }
}

export class PermitPersistenceError extends Error {
  constructor(dataset: PermitDataset, sourceRecordIdentifier: string, cause: unknown) {
    super(
      `The ${dataset} permit ${sourceRecordIdentifier} could not be persisted; the snapshot was not checkpointed.`,
      { cause },
    );
    this.name = "PermitPersistenceError";
  }
}

export interface RunPermitImportOptions {
  provider: PermitDataProvider;
  repository: PermitImportRepository;
  dataset: PermitDataset;
  mode?: PermitImportMode;
  from?: Date | null;
  to?: Date | null;
  pageSize?: number;
  signal?: AbortSignal;
  onEvent?: (event: PermitImportEvent) => void;
}

export type PermitImportEvent =
  | {
      type: "import.skipped";
      dataset: PermitDataset;
      revision: string;
      reason: "unchanged-revision";
    }
  | {
      type: "row.failed";
      dataset: PermitDataset;
      sourceRecordIdentifier: string;
      errorCode: string;
    }
  | {
      type: "page.completed";
      dataset: PermitDataset;
      counts: PermitImportCounts;
    };

export interface PermitImportResult {
  runId: string;
  dataset: PermitDataset;
  revision: string;
  status: "SUCCEEDED" | "PARTIALLY_SUCCEEDED";
  skippedUnchangedSnapshot: boolean;
  counts: PermitImportCounts;
}

function emptyCounts(): PermitImportCounts {
  return { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
}

function sourceProviderKey(metadata: ProviderDatasetMetadata): string {
  return `${metadata.sourceProvider}:${metadata.sourceDatasetId}`;
}

function makeCheckpoint(metadata: ProviderDatasetMetadata): PermitImportCheckpoint {
  return {
    version: 1,
    dataset: metadata.sourceDataset,
    datasetId: metadata.sourceDatasetId,
    revision: metadata.revision,
    schemaFingerprint: metadata.schemaFingerprint,
    rowCount: metadata.rowCount,
  };
}

function encodeCheckpoint(checkpoint: PermitImportCheckpoint): string {
  return JSON.stringify(checkpoint);
}

export function parseCheckpoint(value: string | null): PermitImportCheckpoint | null {
  if (!value) return null;
  try {
    const result = checkpointSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function checkpointsMatch(
  previous: PermitImportCheckpoint | null,
  current: PermitImportCheckpoint,
): boolean {
  return (
    previous?.dataset === current.dataset &&
    previous.datasetId === current.datasetId &&
    previous.revision === current.revision &&
    previous.schemaFingerprint === current.schemaFingerprint &&
    previous.rowCount === current.rowCount
  );
}

function fallbackIdentifier(row: PermitProviderRowResult, checksum: string): string {
  return row.rawRecord.sourceRecordIdentifier ?? `invalid:${checksum}`;
}

/** Socrata refresh metadata can change while the permit's business fields do not. */
export function checksumPermitPayload(payload: RawPermitPayload): string {
  const stablePayload = Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== ":id" && key !== ":updated_at"),
  );
  return checksumJson(stablePayload);
}

function safeFailureMessage(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 1_000);
}

function processingErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name.slice(0, 100) : "UnknownError";
}

export async function runPermitImport(
  options: RunPermitImportOptions,
): Promise<PermitImportResult> {
  const mode = options.mode ?? "INCREMENTAL";
  const metadata = await options.provider.getDatasetMetadata(options.dataset, {
    signal: options.signal,
  });
  const providerKey = sourceProviderKey(metadata);
  const currentCheckpoint = makeCheckpoint(metadata);
  const priorCursor = await options.repository.findLatestAcceptedSnapshotCursor(providerKey);
  const priorCheckpoint = parseCheckpoint(priorCursor);
  const run = await options.repository.createRun({
    sourceProviderKey: providerKey,
    mode,
    requestedFrom: options.from ?? null,
    requestedTo: options.to ?? null,
    startCursor: priorCursor,
  });
  const counts = emptyCounts();

  try {
    if (mode === "INCREMENTAL" && checkpointsMatch(priorCheckpoint, currentCheckpoint)) {
      const endCursor = encodeCheckpoint(currentCheckpoint);
      await options.repository.completeRun({
        runId: run.id,
        status: "SUCCEEDED",
        counts,
        endCursor,
        errorSummary: null,
      });
      options.onEvent?.({
        type: "import.skipped",
        dataset: options.dataset,
        revision: metadata.revision,
        reason: "unchanged-revision",
      });
      return {
        runId: run.id,
        dataset: options.dataset,
        revision: metadata.revision,
        status: "SUCCEEDED",
        skippedUnchangedSnapshot: true,
        counts,
      };
    }

    const identifiers = new Set<string>();
    const isCompleteSnapshot = !options.from && !options.to;

    for await (const page of options.provider.pages({
      dataset: options.dataset,
      expectedRevision: metadata.revision,
      pageSize: options.pageSize,
      from: options.from,
      to: options.to,
      signal: options.signal,
    })) {
      if (
        page.revision !== metadata.revision ||
        page.schemaFingerprint !== metadata.schemaFingerprint ||
        page.sourceProvider !== metadata.sourceProvider ||
        page.sourceDataset !== metadata.sourceDataset ||
        page.sourceDatasetId !== metadata.sourceDatasetId
      ) {
        throw new Error("The provider page does not belong to the requested dataset snapshot.");
      }

      for (const row of page.rows) {
        options.signal?.throwIfAborted();
        counts.fetched += 1;
        const checksum = checksumPermitPayload(row.rawRecord.payload);
        const identityChecksum = checksumJson(row.rawRecord.payload);
        const identifier = fallbackIdentifier(row, identityChecksum);

        const rawIdentityMatches =
          row.rawRecord.sourceProvider === page.sourceProvider &&
          row.rawRecord.sourceDataset === page.sourceDataset &&
          row.rawRecord.sourceDatasetId === page.sourceDatasetId;
        const normalizedIdentityMatches =
          !row.ok ||
          (row.permit.sourceProvider === row.rawRecord.sourceProvider &&
            row.permit.sourceDataset === row.rawRecord.sourceDataset &&
            row.permit.sourceDatasetId === row.rawRecord.sourceDatasetId &&
            row.permit.sourceRecordIdentifier === row.rawRecord.sourceRecordIdentifier);
        if (!rawIdentityMatches || !normalizedIdentityMatches) {
          await options.repository.rejectRawRecord({
            runId: run.id,
            sourceProviderKey: providerKey,
            rawRecord: row.rawRecord,
            checksum,
            failureIdentifier: identifier,
            errorCode: "PROVIDER_IDENTITY_MISMATCH",
            errorMessage: "The provider returned inconsistent row identity metadata.",
          });
          counts.failed += 1;
          options.onEvent?.({
            type: "row.failed",
            dataset: options.dataset,
            sourceRecordIdentifier: identifier,
            errorCode: "PROVIDER_IDENTITY_MISMATCH",
          });
          continue;
        }

        if (row.rawRecord.sourceRecordIdentifier) {
          if (identifiers.has(identifier)) {
            await options.repository.rejectRawRecord({
              runId: run.id,
              sourceProviderKey: providerKey,
              rawRecord: row.rawRecord,
              checksum,
              failureIdentifier: identifier,
              errorCode: "DUPLICATE_SOURCE_ID",
              errorMessage: "The source snapshot repeated a durable record identifier.",
            });
            counts.failed += 1;
            throw new DuplicateSourceIdentifierError(options.dataset);
          }
          identifiers.add(identifier);
        }

        if (!row.ok) {
          await options.repository.rejectRawRecord({
            runId: run.id,
            sourceProviderKey: providerKey,
            rawRecord: row.rawRecord,
            checksum,
            failureIdentifier: identifier,
            errorCode: row.error.code,
            errorMessage: safeFailureMessage(row.error.message),
          });
          counts.failed += 1;
          options.onEvent?.({
            type: "row.failed",
            dataset: options.dataset,
            sourceRecordIdentifier: identifier,
            errorCode: row.error.code,
          });
          continue;
        }

        const staged = await options.repository.stageRawRecord({
          runId: run.id,
          sourceProviderKey: providerKey,
          rawRecord: row.rawRecord,
          checksum,
        });
        if (staged.disposition === "unchanged") {
          counts.skipped += 1;
          continue;
        }

        try {
          await options.repository.persistPermit({
            runId: run.id,
            sourceProviderKey: providerKey,
            rawRecordId: staged.id,
            rawPayload: row.rawRecord.payload,
            permit: row.permit,
          });
          if (staged.disposition === "created") counts.created += 1;
          else counts.updated += 1;
        } catch (error) {
          const errorCode = `PROCESSING_${processingErrorName(error).toUpperCase()}`;
          counts.failed += 1;
          await options.repository.markProcessingFailure({
            runId: run.id,
            rawRecordId: staged.id,
            sourceRecordIdentifier: identifier,
            errorCode,
            errorMessage: "The normalized permit row could not be persisted.",
            rawPayload: row.rawRecord.payload,
          });
          options.onEvent?.({
            type: "row.failed",
            dataset: options.dataset,
            sourceRecordIdentifier: identifier,
            errorCode,
          });
          // Provider validation failures are deterministic and can be safely
          // quarantined. Persistence failures may be transient, so accepting
          // the revision here could strand a valid row until the City publishes
          // another snapshot.
          throw new PermitPersistenceError(options.dataset, identifier, error);
        }

        if (counts.fetched % 100 === 0) {
          await options.repository.updateRunProgress({ runId: run.id, counts: { ...counts } });
        }
      }

      await options.repository.updateRunProgress({ runId: run.id, counts: { ...counts } });
      options.onEvent?.({
        type: "page.completed",
        dataset: options.dataset,
        counts: { ...counts },
      });
    }

    if (isCompleteSnapshot && counts.fetched !== metadata.rowCount) {
      throw new SnapshotRowCountError(metadata.rowCount, counts.fetched);
    }

    const status = counts.failed > 0 ? "PARTIALLY_SUCCEEDED" : "SUCCEEDED";
    // A fully traversed, revision-stable snapshot is safe to checkpoint even
    // when isolated rows were quarantined. Range backfills never advance it.
    const acceptedCheckpoint = isCompleteSnapshot ? encodeCheckpoint(currentCheckpoint) : null;
    await options.repository.completeRun({
      runId: run.id,
      status,
      counts,
      endCursor: acceptedCheckpoint,
      errorSummary:
        counts.failed > 0
          ? `${counts.failed} source row${counts.failed === 1 ? " was" : "s were"} quarantined.`
          : null,
    });
    return {
      runId: run.id,
      dataset: options.dataset,
      revision: metadata.revision,
      status,
      skippedUnchangedSnapshot: false,
      counts,
    };
  } catch (error) {
    await options.repository.failRun({
      runId: run.id,
      counts,
      errorSummary:
        error instanceof Error
          ? safeFailureMessage(`${error.name}: ${error.message}`)
          : "Unknown snapshot import failure.",
    });
    throw error;
  }
}
