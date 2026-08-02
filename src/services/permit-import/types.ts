import type {
  NormalizedPermitRecord,
  PermitDataset,
  ProviderRawRecord,
  RawPermitPayload,
} from "../../providers";

export type PermitImportMode = "INCREMENTAL" | "BACKFILL" | "MANUAL";
export type PermitImportRunStatus = "SUCCEEDED" | "PARTIALLY_SUCCEEDED" | "FAILED";

export type RawStageDisposition = "created" | "updated" | "unchanged";

export interface PermitImportCounts {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface PermitImportCheckpoint {
  version: 1;
  dataset: PermitDataset;
  datasetId: string;
  revision: string;
  schemaFingerprint: string;
  rowCount: number;
}

export interface PermitImportRunRecord {
  id: string;
}

export interface StageRawRecordInput {
  runId: string;
  sourceProviderKey: string;
  rawRecord: ProviderRawRecord;
  checksum: string;
}

export interface StagedRawRecord {
  id: string;
  disposition: RawStageDisposition;
}

export interface RejectedRawRecordInput extends StageRawRecordInput {
  failureIdentifier: string;
  errorCode: string;
  errorMessage: string;
}

export interface PermitImportRepository {
  findLatestAcceptedSnapshotCursor(sourceProviderKey: string): Promise<string | null>;
  createRun(input: {
    sourceProviderKey: string;
    mode: PermitImportMode;
    requestedFrom: Date | null;
    requestedTo: Date | null;
    startCursor: string | null;
  }): Promise<PermitImportRunRecord>;
  stageRawRecord(input: StageRawRecordInput): Promise<StagedRawRecord>;
  persistPermit(input: {
    runId: string;
    sourceProviderKey: string;
    rawRecordId: string;
    rawPayload: RawPermitPayload;
    permit: NormalizedPermitRecord;
  }): Promise<void>;
  rejectRawRecord(input: RejectedRawRecordInput): Promise<void>;
  markProcessingFailure(input: {
    runId: string;
    rawRecordId: string;
    sourceRecordIdentifier: string;
    errorCode: string;
    errorMessage: string;
    rawPayload: RawPermitPayload;
  }): Promise<void>;
  updateRunProgress(input: { runId: string; counts: PermitImportCounts }): Promise<void>;
  completeRun(input: {
    runId: string;
    status: Exclude<PermitImportRunStatus, "FAILED">;
    counts: PermitImportCounts;
    endCursor: string | null;
    errorSummary: string | null;
  }): Promise<void>;
  failRun(input: {
    runId: string;
    counts: PermitImportCounts;
    errorSummary: string;
  }): Promise<void>;
}
