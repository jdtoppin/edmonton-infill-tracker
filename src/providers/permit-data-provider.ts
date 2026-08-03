import { z } from "zod";

import { normalizeEdmontonAddress } from "../domain/address-normalization";

export const permitDatasetSchema = z.enum(["development", "building"]);
export type PermitDataset = z.infer<typeof permitDatasetSchema>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type RawPermitPayload = { [key: string]: JsonValue };

export const normalizedPermitRecordSchema = z
  .object({
    sourceProvider: z.string().min(1),
    sourceDataset: permitDatasetSchema,
    sourceDatasetId: z.string().regex(/^[a-z0-9]{4}-[a-z0-9]{4}$/i),
    sourceRecordIdentifier: z.string().trim().min(1).max(200),
    systemId: z.string().trim().min(1).max(200).nullable(),
    sourceUpdatedAt: z.date().nullable(),
    permitNumber: z.string().trim().min(1).max(200).nullable(),
    permitType: z.string().trim().min(1).max(300),
    permitSubtype: z.string().trim().min(1).max(300).nullable(),
    applicationDate: z.date().nullable(),
    issueDate: z.date().nullable(),
    status: z.string().trim().min(1).max(200).nullable(),
    workDescription: z.string().trim().min(1).max(50_000).nullable(),
    buildingType: z.string().trim().min(1).max(500).nullable(),
    constructionValue: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?$/)
      .nullable(),
    unitsAdded: z.number().int().min(-100_000).max(100_000).nullable(),
    occupancyGrantedDate: z.date().nullable(),
    rawAddress: z.string().trim().min(1).max(1_000),
    neighbourhoodCityId: z.string().trim().min(1).max(100).nullable(),
    neighbourhoodName: z.string().trim().min(1).max(500).nullable(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
  })
  .superRefine((record, context) => {
    if (!normalizeEdmontonAddress(record.rawAddress).siteAddressKey) {
      context.addIssue({
        code: "custom",
        path: ["rawAddress"],
        message: "A complete Edmonton civic address with a building number is required.",
      });
    }
  });

export type NormalizedPermitRecord = z.infer<typeof normalizedPermitRecordSchema>;

export interface ProviderRawRecord {
  sourceProvider: string;
  sourceDataset: PermitDataset;
  sourceDatasetId: string;
  sourceRecordIdentifier: string | null;
  systemId: string | null;
  sourceUpdatedAt: Date | null;
  payload: RawPermitPayload;
}

export interface PermitRowFailure {
  code: "MISSING_SOURCE_ID" | "INVALID_SOURCE_ROW";
  message: string;
  issues: readonly string[];
}

export type PermitProviderRowResult =
  | {
      ok: true;
      rawRecord: ProviderRawRecord;
      permit: NormalizedPermitRecord;
    }
  | {
      ok: false;
      rawRecord: ProviderRawRecord;
      error: PermitRowFailure;
    };

export interface ProviderDatasetColumn {
  fieldName: string;
  dataType: string;
}

export interface ProviderDatasetMetadata {
  sourceProvider: string;
  sourceDataset: PermitDataset;
  sourceDatasetId: string;
  revision: string;
  rowCount: number;
  schemaFingerprint: string;
  columns: readonly ProviderDatasetColumn[];
  fetchedAt: Date;
}

export interface PermitProviderPage {
  sourceProvider: string;
  sourceDataset: PermitDataset;
  sourceDatasetId: string;
  revision: string;
  schemaFingerprint: string;
  rows: readonly PermitProviderRowResult[];
  fetchedCount: number;
  nextCursor: string | null;
}

export interface FetchPermitOptions {
  dataset: PermitDataset;
  cursor?: string | null;
  pageSize?: number;
  expectedRevision?: string | null;
  from?: Date | null;
  to?: Date | null;
  signal?: AbortSignal;
}

export interface PermitDataProvider {
  readonly providerId: string;
  getDatasetMetadata(
    dataset: PermitDataset,
    options?: { signal?: AbortSignal },
  ): Promise<ProviderDatasetMetadata>;
  fetchPage(options: FetchPermitOptions): Promise<PermitProviderPage>;
  pages(options: FetchPermitOptions): AsyncGenerator<PermitProviderPage>;
}

export type ProviderRequestLog = {
  sourceDataset: PermitDataset;
  operation: "metadata" | "count" | "page";
  attempt: number;
  status: number | null;
  durationMs: number;
  outcome: "succeeded" | "retrying" | "failed";
};
