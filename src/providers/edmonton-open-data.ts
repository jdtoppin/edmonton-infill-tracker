import { createHash } from "node:crypto";
import { z } from "zod";

import {
  normalizedPermitRecordSchema,
  type FetchPermitOptions,
  type NormalizedPermitRecord,
  type PermitDataProvider,
  type PermitDataset,
  type PermitProviderPage,
  type PermitProviderRowResult,
  type ProviderDatasetColumn,
  type ProviderDatasetMetadata,
  type ProviderRawRecord,
  type ProviderRequestLog,
  type RawPermitPayload,
} from "./permit-data-provider";

const PROVIDER_ID = "edmonton-open-data";
const DEFAULT_BASE_URL = "https://data.edmonton.ca/resource";

const datasetIdSchema = z.string().regex(/^[a-z0-9]{4}-[a-z0-9]{4}$/i);

const metadataResponseSchema = z.object({
  id: datasetIdSchema,
  rowsUpdatedAt: z.union([z.number(), z.string()]).optional(),
  columns: z.array(
    z.object({
      fieldName: z.string(),
      dataTypeName: z.string(),
    }),
  ),
});

const countResponseSchema = z.array(
  z.object({
    count: z.union([z.string(), z.number()]),
  }),
);

const rawPageSchema = z.array(z.record(z.string(), z.unknown()));

type DatasetDescriptor = {
  dataset: PermitDataset;
  datasetId: string;
  sourceIdField: string;
  eventDateField: string;
  fields: readonly string[];
  requiredColumns: Readonly<Record<string, readonly string[]>>;
};

type SnapshotCursor = {
  version: 1;
  dataset: PermitDataset;
  datasetId: string;
  revision: string;
  from: string | null;
  to: string | null;
  lastSystemId: string;
};

export interface EdmontonSocrataPermitProviderOptions {
  baseUrl?: string;
  developmentDatasetId?: string;
  buildingDatasetId?: string;
  appToken?: string;
  defaultPageSize?: number;
  requestsPerSecond?: number;
  retryLimit?: number;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  onRequest?: (event: ProviderRequestLog) => void;
}

export class ProviderConfigurationError extends Error {}
export class ProviderSchemaError extends Error {}
export class ProviderRevisionChangedError extends Error {}
export class ProviderResponseError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export class EdmontonSocrataPermitProvider implements PermitDataProvider {
  readonly providerId = PROVIDER_ID;

  private readonly origin: string;
  private readonly appToken: string | null;
  private readonly defaultPageSize: number;
  private readonly minimumRequestIntervalMs: number;
  private readonly retryLimit: number;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly sleepImplementation: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  private readonly random: () => number;
  private readonly onRequest: ((event: ProviderRequestLog) => void) | undefined;
  private readonly descriptors: Record<PermitDataset, DatasetDescriptor>;
  private nextRequestAt = 0;
  private retryAfterUntil = 0;
  private retryAfterVersion = 0;

  constructor(options: EdmontonSocrataPermitProviderOptions = {}) {
    const parsedBaseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    if (parsedBaseUrl.protocol !== "https:" || parsedBaseUrl.hostname !== "data.edmonton.ca") {
      throw new ProviderConfigurationError(
        "Edmonton permit ingestion must use https://data.edmonton.ca.",
      );
    }

    this.origin = parsedBaseUrl.origin;
    this.appToken = options.appToken?.trim() || null;
    this.defaultPageSize = boundedInteger(options.defaultPageSize ?? 1_000, 1, 10_000);
    const requestsPerSecond = boundedNumber(options.requestsPerSecond ?? 4, 0.1, 20);
    this.minimumRequestIntervalMs = Math.ceil(1_000 / requestsPerSecond);
    this.retryLimit = boundedInteger(options.retryLimit ?? 4, 0, 8);
    this.requestTimeoutMs = boundedInteger(options.requestTimeoutMs ?? 30_000, 1_000, 120_000);
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? 25_000_000,
      100_000,
      100_000_000,
    );
    this.fetchImplementation = options.fetch ?? fetch;
    this.sleepImplementation = options.sleep ?? abortableSleep;
    this.random = options.random ?? Math.random;
    this.onRequest = options.onRequest;

    this.descriptors = {
      development: developmentDescriptor(
        datasetIdSchema.parse(options.developmentDatasetId ?? "2ccn-pwtu"),
      ),
      building: buildingDescriptor(datasetIdSchema.parse(options.buildingDatasetId ?? "24uj-dj8v")),
    };
  }

  async getDatasetMetadata(
    dataset: PermitDataset,
    options: { signal?: AbortSignal } = {},
  ): Promise<ProviderDatasetMetadata> {
    const descriptor = this.descriptors[dataset];
    const metadataUrl = new URL(`/api/views/${descriptor.datasetId}`, this.origin);
    const metadataResult = await this.requestJson(metadataUrl, dataset, "metadata", options.signal);
    const metadata = metadataResponseSchema.parse(metadataResult.value);
    const columns: ProviderDatasetColumn[] = metadata.columns
      .filter(({ fieldName }) => !fieldName.startsWith(":@"))
      .map(({ fieldName, dataTypeName }) => ({ fieldName, dataType: dataTypeName }));
    validateRequiredColumns(descriptor, columns);

    const countUrl = this.resourceUrl(descriptor.datasetId);
    countUrl.searchParams.set("$select", "count(*) as count");
    const countResult = await this.requestJson(countUrl, dataset, "count", options.signal);
    const parsedCount = countResponseSchema.parse(countResult.value);
    const rowCount = Number(parsedCount[0]?.count);
    if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
      throw new ProviderResponseError("Socrata returned an invalid dataset row count.", null);
    }

    const revisionPart =
      metadata.rowsUpdatedAt ?? metadataResult.etag ?? metadataResult.lastModified;
    if (revisionPart === undefined || revisionPart === null || String(revisionPart).trim() === "") {
      throw new ProviderResponseError("Socrata metadata did not include a dataset revision.", null);
    }

    return {
      sourceProvider: PROVIDER_ID,
      sourceDataset: dataset,
      sourceDatasetId: descriptor.datasetId,
      revision: String(revisionPart),
      rowCount,
      schemaFingerprint: schemaFingerprint(columns),
      columns,
      fetchedAt: new Date(),
    };
  }

  async fetchPage(options: FetchPermitOptions): Promise<PermitProviderPage> {
    const descriptor = this.descriptors[options.dataset];
    const metadata = await this.getDatasetMetadata(options.dataset, { signal: options.signal });
    if (options.expectedRevision && metadata.revision !== options.expectedRevision) {
      throw new ProviderRevisionChangedError(
        `The ${options.dataset} dataset changed before the page could be fetched.`,
      );
    }

    return this.fetchPageForRevision(options, descriptor, metadata);
  }

  async *pages(options: FetchPermitOptions): AsyncGenerator<PermitProviderPage> {
    const descriptor = this.descriptors[options.dataset];
    const metadata = await this.getDatasetMetadata(options.dataset, { signal: options.signal });
    if (options.expectedRevision && metadata.revision !== options.expectedRevision) {
      throw new ProviderRevisionChangedError(
        `The ${options.dataset} dataset revision no longer matches the requested snapshot.`,
      );
    }

    let cursor = options.cursor ?? null;
    let lastSystemId =
      decodeCursor(cursor, descriptor, metadata.revision, options)?.lastSystemId ?? null;

    while (true) {
      const page = await this.fetchPageForRevision(
        { ...options, cursor, expectedRevision: metadata.revision },
        descriptor,
        metadata,
      );
      if (page.nextCursor) {
        const currentLast = page.rows.at(-1)?.rawRecord.systemId;
        if (!currentLast) {
          throw new ProviderResponseError(
            "A Socrata page cannot be advanced because its final row has no system identifier.",
            null,
          );
        }
        // Socrata's text collation is not guaranteed to match JavaScript's
        // code-unit ordering. Equality still detects a cursor that did not move.
        if (lastSystemId !== null && currentLast === lastSystemId) {
          throw new ProviderResponseError(
            "Socrata returned the same system identifier while paging.",
            null,
          );
        }
        lastSystemId = currentLast;
      }

      yield page;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    const endingMetadata = await this.getDatasetMetadata(options.dataset, {
      signal: options.signal,
    });
    if (
      endingMetadata.revision !== metadata.revision ||
      endingMetadata.schemaFingerprint !== metadata.schemaFingerprint
    ) {
      throw new ProviderRevisionChangedError(
        `The ${options.dataset} dataset changed while its snapshot was being fetched.`,
      );
    }
  }

  private async fetchPageForRevision(
    options: FetchPermitOptions,
    descriptor: DatasetDescriptor,
    metadata: ProviderDatasetMetadata,
  ): Promise<PermitProviderPage> {
    const pageSize = boundedInteger(options.pageSize ?? this.defaultPageSize, 1, 10_000);
    const decodedCursor = decodeCursor(
      options.cursor ?? null,
      descriptor,
      metadata.revision,
      options,
    );
    const url = this.resourceUrl(descriptor.datasetId);
    url.searchParams.set("$select", `${descriptor.fields.join(",")},:id,:updated_at`);
    // Socrata's revision-scoped system ID is unique within one immutable
    // snapshot. It is safe for paging, but never used as application identity.
    url.searchParams.set("$order", ":id ASC");
    url.searchParams.set("$limit", String(pageSize));

    const where = buildWhereClause(descriptor, decodedCursor?.lastSystemId ?? null, options);
    if (where) url.searchParams.set("$where", where);

    const response = await this.requestJson(url, options.dataset, "page", options.signal);
    const rawRows = rawPageSchema.parse(response.value);
    const rows = rawRows.map((row) => normalizeRow(descriptor, row));
    const finalSystemId = rows.at(-1)?.rawRecord.systemId ?? null;
    if (rawRows.length === pageSize && !finalSystemId) {
      throw new ProviderResponseError(
        "Socrata omitted the system identifier required to continue paging.",
        null,
      );
    }
    const nextCursor =
      rawRows.length === pageSize
        ? encodeCursor({
            version: 1,
            dataset: descriptor.dataset,
            datasetId: descriptor.datasetId,
            revision: metadata.revision,
            from: options.from ? formatCivilDate(options.from) : null,
            to: options.to ? formatCivilDate(options.to) : null,
            lastSystemId: finalSystemId!,
          })
        : null;

    return {
      sourceProvider: PROVIDER_ID,
      sourceDataset: descriptor.dataset,
      sourceDatasetId: descriptor.datasetId,
      revision: metadata.revision,
      schemaFingerprint: metadata.schemaFingerprint,
      rows,
      fetchedCount: rawRows.length,
      nextCursor,
    };
  }

  private resourceUrl(datasetId: string): URL {
    return new URL(`/resource/${datasetId}.json`, this.origin);
  }

  private async requestJson(
    url: URL,
    dataset: PermitDataset,
    operation: ProviderRequestLog["operation"],
    signal?: AbortSignal,
  ): Promise<{ value: unknown; etag: string | null; lastModified: string | null }> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.retryLimit + 1; attempt += 1) {
      await this.waitForRateLimit(signal);
      const startedAt = Date.now();
      const timeoutController = new AbortController();
      const timeout = setTimeout(
        () => timeoutController.abort(new Error("Request timed out.")),
        this.requestTimeoutMs,
      );
      const combinedSignal = combineSignals(signal, timeoutController.signal);

      try {
        const headers = new Headers({ accept: "application/json" });
        if (this.appToken) headers.set("X-App-Token", this.appToken);
        const response = await this.fetchImplementation(url, {
          method: "GET",
          headers,
          redirect: "error",
          signal: combinedSignal,
        });
        const durationMs = Date.now() - startedAt;

        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
          this.deferRequests(retryAfterMs);
          await cancelResponseBody(response);
          const retryable = isRetryableStatus(response.status) && attempt <= this.retryLimit;
          this.onRequest?.({
            sourceDataset: dataset,
            operation,
            attempt,
            status: response.status,
            durationMs,
            outcome: retryable ? "retrying" : "failed",
          });
          if (!retryable) {
            throw new ProviderResponseError(
              `Socrata request failed with HTTP ${response.status}.`,
              response.status,
            );
          }
          await this.retryDelay(attempt, retryAfterMs, signal);
          continue;
        }

        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > this.maxResponseBytes) {
          await cancelResponseBody(response);
          throw new ProviderResponseError(
            "Socrata response exceeded the configured size limit.",
            response.status,
          );
        }
        const bytes = await readBoundedBody(response, this.maxResponseBytes);
        let value: unknown;
        try {
          value = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new ProviderResponseError("Socrata returned invalid JSON.", response.status);
        }

        this.onRequest?.({
          sourceDataset: dataset,
          operation,
          attempt,
          status: response.status,
          durationMs,
          outcome: "succeeded",
        });
        return {
          value,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
        };
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw signal.reason ?? error;
        if (error instanceof ProviderResponseError) throw error;

        const retryable = attempt <= this.retryLimit;
        this.onRequest?.({
          sourceDataset: dataset,
          operation,
          attempt,
          status: null,
          durationMs: Date.now() - startedAt,
          outcome: retryable ? "retrying" : "failed",
        });
        if (!retryable) break;
        await this.retryDelay(attempt, 0, signal);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new ProviderResponseError(
      lastError instanceof Error ? lastError.message : "Socrata request failed.",
      null,
    );
  }

  private async waitForRateLimit(signal?: AbortSignal): Promise<void> {
    while (true) {
      const now = Date.now();
      const retryAfterVersion = this.retryAfterVersion;
      const requestAt = Math.max(now, this.nextRequestAt, this.retryAfterUntil);
      this.nextRequestAt = requestAt + this.minimumRequestIntervalMs;
      const waitMs = requestAt - now;
      if (waitMs > 0) await this.sleepImplementation(waitMs, signal);

      // A Retry-After response may arrive while this request is already
      // waiting. Reserve a fresh slot beyond the extended shared gate.
      if (retryAfterVersion === this.retryAfterVersion) return;
    }
  }

  private deferRequests(milliseconds: number): void {
    if (milliseconds <= 0) return;
    const deferredUntil = Date.now() + milliseconds;
    if (deferredUntil <= this.retryAfterUntil) return;
    this.retryAfterUntil = deferredUntil;
    this.retryAfterVersion += 1;
  }

  private async retryDelay(
    attempt: number,
    retryAfterMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const exponentialMs = Math.min(30_000, 500 * 2 ** (attempt - 1));
    const jitterMs = Math.floor(exponentialMs * 0.25 * this.random());
    await this.sleepImplementation(Math.max(retryAfterMs, exponentialMs + jitterMs), signal);
  }
}

export function edmontonProviderFromEnv(
  overrides: Omit<EdmontonSocrataPermitProviderOptions, "baseUrl"> = {},
): EdmontonSocrataPermitProvider {
  return new EdmontonSocrataPermitProvider({
    baseUrl: process.env.EDMONTON_SOCRATA_BASE_URL ?? DEFAULT_BASE_URL,
    developmentDatasetId: process.env.EDMONTON_DEVELOPMENT_PERMITS_DATASET_ID,
    buildingDatasetId: process.env.EDMONTON_BUILDING_PERMITS_DATASET_ID,
    appToken: process.env.SOCRATA_APP_TOKEN,
    defaultPageSize: optionalNumber(process.env.IMPORT_PAGE_SIZE),
    requestsPerSecond: optionalNumber(process.env.IMPORT_RATE_LIMIT_PER_SECOND),
    retryLimit: optionalNumber(process.env.IMPORT_RETRY_LIMIT),
    requestTimeoutMs: optionalNumber(process.env.IMPORT_REQUEST_TIMEOUT_MS),
    maxResponseBytes: optionalNumber(process.env.IMPORT_MAX_RESPONSE_BYTES),
    ...overrides,
  });
}

function developmentDescriptor(datasetId: string): DatasetDescriptor {
  return {
    dataset: "development",
    datasetId,
    sourceIdField: "city_file_number",
    eventDateField: "permit_date",
    fields: [
      "city_file_number",
      "permit_type",
      "permit_class",
      "permit_date",
      "status",
      "description_of_development",
      "address",
      "legal_description",
      "neighbourhood_id",
      "neighbourhood",
      "neighbourhood_classification",
      "ward",
      "bia",
      "zoning",
      "land_parcel_count",
      "latitude",
      "longitude",
    ],
    requiredColumns: {
      city_file_number: ["text"],
      permit_type: ["text"],
      permit_date: ["calendar_date", "floating_timestamp"],
      address: ["text"],
      neighbourhood_id: ["text"],
      latitude: ["number"],
      longitude: ["number"],
    },
  };
}

function buildingDescriptor(datasetId: string): DatasetDescriptor {
  return {
    dataset: "building",
    datasetId,
    sourceIdField: "row_id",
    eventDateField: "issue_date",
    fields: [
      "row_id",
      "issue_date",
      "permit_number",
      "permit_date",
      "year",
      "month_number",
      "job_category",
      "job_description",
      "building_type",
      "work_type",
      "construction_value",
      "floor_area",
      "units_added",
      "address",
      "legal_description",
      "zoning",
      "neighbourhood_numberr",
      "neighbourhood",
      "bia",
      "count",
      "latitude",
      "longitude",
      "occupancy_granted_date",
    ],
    requiredColumns: {
      row_id: ["text"],
      issue_date: ["calendar_date", "floating_timestamp"],
      job_category: ["text"],
      address: ["text"],
      neighbourhood_numberr: ["text"],
      occupancy_granted_date: ["text"],
      latitude: ["number"],
      longitude: ["number"],
    },
  };
}

function normalizeRow(
  descriptor: DatasetDescriptor,
  raw: Record<string, unknown>,
): PermitProviderRowResult {
  const payload = toJsonObject(raw);
  const sourceRecordIdentifier = cleanText(raw[descriptor.sourceIdField], 200);
  const systemId = cleanText(raw[":id"], 200);
  const sourceUpdatedAt = parseTimestamp(raw[":updated_at"]);
  const rawRecord: ProviderRawRecord = {
    sourceProvider: PROVIDER_ID,
    sourceDataset: descriptor.dataset,
    sourceDatasetId: descriptor.datasetId,
    sourceRecordIdentifier,
    systemId,
    sourceUpdatedAt,
    payload,
  };

  if (!sourceRecordIdentifier) {
    return {
      ok: false,
      rawRecord,
      error: {
        code: "MISSING_SOURCE_ID",
        message: `The ${descriptor.dataset} row has no durable source identifier.`,
        issues: [descriptor.sourceIdField],
      },
    };
  }

  const invalidEventDateField =
    descriptor.dataset === "development"
      ? invalidCivilDateField(raw, "permit_date")
      : (invalidCivilDateField(raw, "issue_date") ?? invalidCivilDateField(raw, "permit_date"));
  if (invalidEventDateField) {
    return {
      ok: false,
      rawRecord,
      error: {
        code: "INVALID_SOURCE_ROW",
        message: `The ${descriptor.dataset} row contains an invalid permit date.`,
        issues: [`${invalidEventDateField}: expected a valid Socrata civil date`],
      },
    };
  }

  if (
    descriptor.dataset === "building" &&
    cleanText(raw.occupancy_granted_date, 100) &&
    !parseStrictOccupancyDate(raw.occupancy_granted_date)
  ) {
    return {
      ok: false,
      rawRecord,
      error: {
        code: "INVALID_SOURCE_ROW",
        message: "The building row contains an invalid occupancy-granted date.",
        issues: ["occupancy_granted_date: expected a valid YYYY-MM-DD civil date"],
      },
    };
  }

  const normalized =
    descriptor.dataset === "development"
      ? normalizeDevelopmentRow(descriptor, raw, sourceRecordIdentifier, systemId, sourceUpdatedAt)
      : normalizeBuildingRow(descriptor, raw, sourceRecordIdentifier, systemId, sourceUpdatedAt);
  const parsed = normalizedPermitRecordSchema.safeParse(normalized);
  if (!parsed.success) {
    return {
      ok: false,
      rawRecord,
      error: {
        code: "INVALID_SOURCE_ROW",
        message: `The ${descriptor.dataset} row did not match the normalized permit schema.`,
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      },
    };
  }

  return { ok: true, rawRecord, permit: parsed.data };
}

function normalizeDevelopmentRow(
  descriptor: DatasetDescriptor,
  raw: Record<string, unknown>,
  sourceRecordIdentifier: string,
  systemId: string | null,
  sourceUpdatedAt: Date | null,
): NormalizedPermitRecord {
  return {
    sourceProvider: PROVIDER_ID,
    sourceDataset: descriptor.dataset,
    sourceDatasetId: descriptor.datasetId,
    sourceRecordIdentifier,
    systemId,
    sourceUpdatedAt,
    permitNumber: sourceRecordIdentifier,
    permitType: cleanText(raw.permit_type, 300) ?? "Development Permit",
    permitSubtype: cleanText(raw.permit_class, 300),
    applicationDate: null,
    issueDate: parseCivilDate(raw.permit_date),
    status: cleanText(raw.status, 200),
    workDescription: cleanText(raw.description_of_development, 50_000),
    buildingType: null,
    constructionValue: null,
    unitsAdded: null,
    occupancyGrantedDate: null,
    rawAddress: cleanText(raw.address, 1_000) ?? "",
    neighbourhoodCityId: cleanText(raw.neighbourhood_id, 100),
    neighbourhoodName: cleanText(raw.neighbourhood, 500),
    latitude: parseNumber(raw.latitude),
    longitude: parseNumber(raw.longitude),
  };
}

function normalizeBuildingRow(
  descriptor: DatasetDescriptor,
  raw: Record<string, unknown>,
  sourceRecordIdentifier: string,
  systemId: string | null,
  sourceUpdatedAt: Date | null,
): NormalizedPermitRecord {
  const issueDate = parseCivilDate(raw.issue_date ?? raw.permit_date);
  return {
    sourceProvider: PROVIDER_ID,
    sourceDataset: descriptor.dataset,
    sourceDatasetId: descriptor.datasetId,
    sourceRecordIdentifier,
    systemId,
    sourceUpdatedAt,
    permitNumber: cleanText(raw.permit_number, 200),
    permitType: cleanText(raw.job_category, 300) ?? "Building Permit",
    permitSubtype: cleanText(raw.work_type, 300),
    applicationDate: null,
    issueDate,
    status: "Issued",
    workDescription: cleanText(raw.job_description, 50_000),
    buildingType: cleanText(raw.building_type, 500),
    constructionValue: parseDecimalString(raw.construction_value),
    unitsAdded: parseInteger(raw.units_added),
    occupancyGrantedDate: parseStrictOccupancyDate(raw.occupancy_granted_date),
    rawAddress: cleanText(raw.address, 1_000) ?? "",
    neighbourhoodCityId: cleanText(raw.neighbourhood_numberr, 100),
    neighbourhoodName: cleanText(raw.neighbourhood, 500),
    latitude: parseNumber(raw.latitude),
    longitude: parseNumber(raw.longitude),
  };
}

function validateRequiredColumns(
  descriptor: DatasetDescriptor,
  columns: readonly ProviderDatasetColumn[],
): void {
  const byName = new Map(columns.map((column) => [column.fieldName, column.dataType]));
  const problems: string[] = [];
  for (const [fieldName, acceptedTypes] of Object.entries(descriptor.requiredColumns)) {
    const actual = byName.get(fieldName);
    if (!actual) problems.push(`${fieldName} is missing`);
    else if (!acceptedTypes.includes(actual)) {
      problems.push(`${fieldName} changed from ${acceptedTypes.join("/")} to ${actual}`);
    }
  }
  if (problems.length > 0) {
    throw new ProviderSchemaError(
      `The ${descriptor.dataset} dataset schema is incompatible: ${problems.join("; ")}.`,
    );
  }
}

function schemaFingerprint(columns: readonly ProviderDatasetColumn[]): string {
  const canonical = [...columns]
    .sort((left, right) => left.fieldName.localeCompare(right.fieldName))
    .map(({ fieldName, dataType }) => `${fieldName}:${dataType}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

function buildWhereClause(
  descriptor: DatasetDescriptor,
  lastSystemId: string | null,
  options: FetchPermitOptions,
): string | null {
  const clauses: string[] = [];
  if (lastSystemId) {
    clauses.push(`:id > '${escapeSoqlText(lastSystemId)}'`);
  }
  if (options.from) {
    clauses.push(`${descriptor.eventDateField} >= '${formatCivilDate(options.from)}T00:00:00.000'`);
  }
  if (options.to) {
    clauses.push(`${descriptor.eventDateField} <= '${formatCivilDate(options.to)}T23:59:59.999'`);
  }
  return clauses.length > 0 ? clauses.join(" AND ") : null;
}

function encodeCursor(cursor: SnapshotCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(
  value: string | null,
  descriptor: DatasetDescriptor,
  revision: string,
  options: Pick<FetchPermitOptions, "from" | "to">,
): SnapshotCursor | null {
  if (!value) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new ProviderConfigurationError("The permit page cursor is malformed.");
  }
  const cursorSchema = z.object({
    version: z.literal(1),
    dataset: z.literal(descriptor.dataset),
    datasetId: z.literal(descriptor.datasetId),
    revision: z.literal(revision),
    from: z.string().nullable(),
    to: z.string().nullable(),
    lastSystemId: z.string().min(1),
  });
  const parsed = cursorSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ProviderConfigurationError(
      "The permit page cursor belongs to a different dataset revision.",
    );
  }
  const expectedFrom = options.from ? formatCivilDate(options.from) : null;
  const expectedTo = options.to ? formatCivilDate(options.to) : null;
  if (parsed.data.from !== expectedFrom || parsed.data.to !== expectedTo) {
    throw new ProviderConfigurationError(
      "The permit page cursor belongs to different date filters.",
    );
  }
  return parsed.data;
}

function toJsonObject(value: Record<string, unknown>): RawPermitPayload {
  // Synthetic Socrata fields change when the City republishes a complete
  // dataset. Keep them in explicit provider metadata, not the business payload
  // used for audit checksums and idempotency.
  const businessFields = Object.fromEntries(
    Object.entries(value).filter(([fieldName]) => !fieldName.startsWith(":")),
  );
  return JSON.parse(JSON.stringify(businessFields)) as RawPermitPayload;
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Releasing an error response is best effort; preserve the HTTP failure.
  }
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    throw new ProviderResponseError("Socrata returned an empty response body.", response.status);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel("Response size limit exceeded.").catch(() => undefined);
      throw new ProviderResponseError(
        "Socrata response exceeded the configured size limit.",
        response.status,
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function parseCivilDate(value: unknown): Date | null {
  const text = cleanText(value, 100);
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.\d{1,9})?)?$/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  const expected = `${match[1]}-${match[2]}-${match[3]}`;
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === expected
    ? date
    : null;
}

function invalidCivilDateField(raw: Record<string, unknown>, fieldName: string): string | null {
  return cleanText(raw[fieldName], 100) && !parseCivilDate(raw[fieldName]) ? fieldName : null;
}

function parseStrictOccupancyDate(value: unknown): Date | null {
  const text = cleanText(value, 100);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return parseCivilDate(text);
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value === "number") {
    const date = new Date(value < 10_000_000_000 ? value * 1_000 : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = cleanText(value, 100);
  if (!text) return null;
  const numeric = Number(text);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
    : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown): number | null {
  const parsed = parseNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function parseDecimalString(value: unknown): string | null {
  const text = cleanText(value, 100)?.replace(/[$,\s]/g, "") ?? null;
  if (!text || !/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  return text;
}

function formatCivilDate(value: Date): string {
  if (Number.isNaN(value.getTime()))
    throw new ProviderConfigurationError("Import date is invalid.");
  return value.toISOString().slice(0, 10);
}

function escapeSoqlText(value: string): string {
  return value.replaceAll("'", "''");
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(60_000, seconds * 1_000));
  const date = new Date(value).getTime();
  return Number.isFinite(date) ? Math.max(0, Math.min(60_000, date - Date.now())) : 0;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ProviderConfigurationError(`Expected an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boundedNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ProviderConfigurationError(`Expected a number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ProviderConfigurationError("A numeric importer environment variable is invalid.");
  }
  return parsed;
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

async function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new Error("Operation aborted.");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Operation aborted."));
      },
      { once: true },
    );
  });
}

export const _test = {
  buildWhereClause,
  decodeCursor,
  encodeCursor,
  normalizeRow,
  parseCivilDate,
  parseStrictOccupancyDate,
  schemaFingerprint,
};
