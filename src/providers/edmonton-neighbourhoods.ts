import { z } from "zod";

const EDMONTON_OPEN_DATA_ORIGIN = "https://data.edmonton.ca";
export const EDMONTON_CURRENT_NEIGHBOURHOODS_DATASET_ID = "3b6m-fezs";

const rawNeighbourhoodRowSchema = z
  .object({
    number: z.union([z.string(), z.number()]),
    name_mixed: z.string(),
    latitude: z.union([z.string(), z.number()]),
    longitude: z.union([z.string(), z.number()]),
  })
  .strict();

const rawNeighbourhoodResponseSchema = z.array(rawNeighbourhoodRowSchema);

export interface EdmontonNeighbourhood {
  cityNeighbourhoodId: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface EdmontonNeighbourhoodProvider {
  fetchCurrentNeighbourhoods(options?: {
    signal?: AbortSignal;
  }): Promise<readonly EdmontonNeighbourhood[]>;
}

export interface EdmontonSocrataNeighbourhoodProviderOptions {
  baseUrl?: string;
  appToken?: string;
  minimumRows?: number;
  maximumRows?: number;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  fetch?: typeof fetch;
}

export class NeighbourhoodProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeighbourhoodProviderConfigurationError";
  }
}

export class NeighbourhoodProviderResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeighbourhoodProviderResponseError";
  }
}

export class NeighbourhoodProviderSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeighbourhoodProviderSchemaError";
  }
}

/**
 * Fetches the City's complete, current neighbourhood centroid dataset in one
 * bounded request. The full response is validated before any caller can
 * persist it, preventing a partial or malformed upstream response from
 * replacing authoritative names.
 */
export class EdmontonSocrataNeighbourhoodProvider implements EdmontonNeighbourhoodProvider {
  private readonly origin: string;
  private readonly appToken: string | null;
  private readonly minimumRows: number;
  private readonly maximumRows: number;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: EdmontonSocrataNeighbourhoodProviderOptions = {}) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(options.baseUrl ?? EDMONTON_OPEN_DATA_ORIGIN);
    } catch {
      throw new NeighbourhoodProviderConfigurationError(
        "Edmonton neighbourhood data requires a valid HTTPS URL.",
      );
    }
    if (
      baseUrl.protocol !== "https:" ||
      baseUrl.hostname !== "data.edmonton.ca" ||
      (baseUrl.port !== "" && baseUrl.port !== "443") ||
      baseUrl.username !== "" ||
      baseUrl.password !== ""
    ) {
      throw new NeighbourhoodProviderConfigurationError(
        "Edmonton neighbourhood data must use https://data.edmonton.ca.",
      );
    }

    this.origin = EDMONTON_OPEN_DATA_ORIGIN;
    this.appToken = options.appToken?.trim() || null;
    this.minimumRows = boundedInteger(options.minimumRows ?? 300, 1, 750, "minimumRows");
    this.maximumRows = boundedInteger(options.maximumRows ?? 750, 1, 1_000, "maximumRows");
    if (this.minimumRows > this.maximumRows) {
      throw new NeighbourhoodProviderConfigurationError(
        "minimumRows cannot be greater than maximumRows.",
      );
    }
    this.requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs ?? 15_000,
      10,
      60_000,
      "requestTimeoutMs",
    );
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? 2_000_000,
      1,
      5_000_000,
      "maxResponseBytes",
    );
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async fetchCurrentNeighbourhoods(
    options: { signal?: AbortSignal } = {},
  ): Promise<readonly EdmontonNeighbourhood[]> {
    const url = new URL(
      `/resource/${EDMONTON_CURRENT_NEIGHBOURHOODS_DATASET_ID}.json`,
      this.origin,
    );
    url.searchParams.set("$select", "number,name_mixed,latitude,longitude");
    url.searchParams.set("$order", "number ASC");
    // Asking for one extra row makes truncation detectable.
    url.searchParams.set("$limit", String(this.maximumRows + 1));

    const controller = new AbortController();
    const forwardAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) forwardAbort();
    else options.signal?.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("Edmonton neighbourhood request timed out.")),
      this.requestTimeoutMs,
    );

    try {
      const headers = new Headers({ accept: "application/json" });
      if (this.appToken) headers.set("X-App-Token", this.appToken);
      const response = await this.fetchImplementation(url, {
        method: "GET",
        headers,
        redirect: "error",
        signal: controller.signal,
      });

      if (!response.ok) {
        await cancelResponseBody(response);
        throw new NeighbourhoodProviderResponseError(
          `Edmonton neighbourhood request failed with HTTP ${response.status}.`,
        );
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.startsWith("application/json")) {
        await cancelResponseBody(response);
        throw new NeighbourhoodProviderResponseError(
          "Edmonton neighbourhood data did not return JSON.",
        );
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > this.maxResponseBytes) {
        await cancelResponseBody(response);
        throw new NeighbourhoodProviderResponseError(
          "Edmonton neighbourhood response exceeded the size limit.",
        );
      }

      const bytes = await readBoundedBody(response, this.maxResponseBytes);
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new NeighbourhoodProviderResponseError(
          "Edmonton neighbourhood data returned invalid JSON.",
        );
      }

      const parsed = rawNeighbourhoodResponseSchema.safeParse(value);
      if (!parsed.success) {
        throw new NeighbourhoodProviderSchemaError(
          "Edmonton neighbourhood data did not match the expected schema.",
        );
      }
      if (parsed.data.length < this.minimumRows || parsed.data.length > this.maximumRows) {
        throw new NeighbourhoodProviderSchemaError(
          `Edmonton neighbourhood data returned an unsafe row count (${parsed.data.length}).`,
        );
      }

      const seenIds = new Set<string>();
      const neighbourhoods = parsed.data.map((row, index) => {
        const neighbourhood = normalizeNeighbourhood(row, index);
        if (seenIds.has(neighbourhood.cityNeighbourhoodId)) {
          throw new NeighbourhoodProviderSchemaError(
            `Edmonton neighbourhood data repeated ID ${neighbourhood.cityNeighbourhoodId}.`,
          );
        }
        seenIds.add(neighbourhood.cityNeighbourhoodId);
        return neighbourhood;
      });
      return neighbourhoods.sort((left, right) =>
        left.cityNeighbourhoodId.localeCompare(right.cityNeighbourhoodId, "en-CA", {
          numeric: true,
        }),
      );
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      if (
        error instanceof NeighbourhoodProviderResponseError ||
        error instanceof NeighbourhoodProviderSchemaError
      ) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new NeighbourhoodProviderResponseError("Edmonton neighbourhood request timed out.");
      }
      throw new NeighbourhoodProviderResponseError(
        error instanceof Error
          ? `Edmonton neighbourhood request failed: ${error.name}.`
          : "Edmonton neighbourhood request failed.",
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", forwardAbort);
    }
  }
}

export function edmontonNeighbourhoodProviderFromEnv(
  overrides: Omit<EdmontonSocrataNeighbourhoodProviderOptions, "baseUrl" | "appToken"> = {},
): EdmontonSocrataNeighbourhoodProvider {
  return new EdmontonSocrataNeighbourhoodProvider({
    baseUrl: process.env.EDMONTON_SOCRATA_BASE_URL ?? EDMONTON_OPEN_DATA_ORIGIN,
    appToken: process.env.SOCRATA_APP_TOKEN,
    ...overrides,
  });
}

function normalizeNeighbourhood(
  row: z.infer<typeof rawNeighbourhoodRowSchema>,
  index: number,
): EdmontonNeighbourhood {
  const cityNeighbourhoodId = String(row.number).trim();
  if (!/^\d{1,10}$/.test(cityNeighbourhoodId)) {
    throw new NeighbourhoodProviderSchemaError(
      `Edmonton neighbourhood row ${index + 1} has an invalid ID.`,
    );
  }

  const name = row.name_mixed.trim().replace(/\s+/gu, " ").normalize("NFC");
  if (name.length < 1 || name.length > 200 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new NeighbourhoodProviderSchemaError(
      `Edmonton neighbourhood ${cityNeighbourhoodId} has an invalid name.`,
    );
  }

  const latitude = strictNumber(row.latitude);
  const longitude = strictNumber(row.longitude);
  // A tight regional envelope prevents a valid-looking response from another
  // dataset or coordinate reference system from being accepted accidentally.
  if (latitude === null || latitude < 53 || latitude > 54) {
    throw new NeighbourhoodProviderSchemaError(
      `Edmonton neighbourhood ${cityNeighbourhoodId} has an invalid latitude.`,
    );
  }
  if (longitude === null || longitude < -114.5 || longitude > -112.5) {
    throw new NeighbourhoodProviderSchemaError(
      `Edmonton neighbourhood ${cityNeighbourhoodId} has an invalid longitude.`,
    );
  }

  return { cityNeighbourhoodId, name, latitude, longitude };
}

function strictNumber(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const clean = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(clean)) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new NeighbourhoodProviderConfigurationError(
      `${name} must be a whole number from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    throw new NeighbourhoodProviderResponseError("Edmonton neighbourhood response had no body.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new NeighbourhoodProviderResponseError(
          "Edmonton neighbourhood response exceeded the size limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing else should fail because an error response could not be drained.
  }
}
