import { describe, expect, it, vi } from "vitest";

import {
  EdmontonSocrataPermitProvider,
  ProviderConfigurationError,
  ProviderResponseError,
  ProviderRevisionChangedError,
  ProviderSchemaError,
} from "../../src/providers/edmonton-open-data";
import type { PermitDataset } from "../../src/providers/permit-data-provider";

const requiredColumns: Record<PermitDataset, Array<{ fieldName: string; dataTypeName: string }>> = {
  development: [
    { fieldName: "city_file_number", dataTypeName: "text" },
    { fieldName: "permit_type", dataTypeName: "text" },
    { fieldName: "permit_date", dataTypeName: "calendar_date" },
    { fieldName: "address", dataTypeName: "text" },
    { fieldName: "neighbourhood_id", dataTypeName: "text" },
    { fieldName: "latitude", dataTypeName: "number" },
    { fieldName: "longitude", dataTypeName: "number" },
  ],
  building: [
    { fieldName: "row_id", dataTypeName: "text" },
    { fieldName: "issue_date", dataTypeName: "calendar_date" },
    { fieldName: "job_category", dataTypeName: "text" },
    { fieldName: "address", dataTypeName: "text" },
    { fieldName: "neighbourhood_numberr", dataTypeName: "text" },
    { fieldName: "occupancy_granted_date", dataTypeName: "text" },
    { fieldName: "latitude", dataTypeName: "number" },
    { fieldName: "longitude", dataTypeName: "number" },
  ],
};

function datasetFromUrl(url: URL): PermitDataset {
  return url.pathname.includes("24uj-dj8v") ? "building" : "development";
}

function metadata(dataset: PermitDataset, revision = 100, columns = requiredColumns[dataset]) {
  return {
    id: dataset === "building" ? "24uj-dj8v" : "2ccn-pwtu",
    rowsUpdatedAt: revision,
    columns,
  };
}

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}) {
  const body = JSON.stringify(value);
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json",
      "content-length": String(body.length),
      ...headers,
    },
  });
}

function cancellableErrorResponse(
  status: number,
  headers: HeadersInit,
  onCancel: () => void,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{}"));
    },
    cancel() {
      onCancel();
    },
  });
  return new Response(stream, { status, headers });
}

function providerWithFetch(fetchImplementation: typeof fetch) {
  return new EdmontonSocrataPermitProvider({
    fetch: fetchImplementation,
    requestsPerSecond: 20,
    retryLimit: 2,
    sleep: async () => undefined,
    random: () => 0,
  });
}

describe("Edmonton Socrata permit provider", () => {
  it("normalizes building occupancy as a first-class civil date", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/api/views/")) return jsonResponse(metadata("building"));
      if (url.searchParams.get("$select") === "count(*) as count") {
        return jsonResponse([{ count: "1" }]);
      }
      return jsonResponse([
        {
          row_id: "building-row-1",
          issue_date: "2026-06-10T00:00:00.000",
          permit_number: "",
          job_category: "New House",
          work_type: "New",
          job_description: "Construct a new detached house",
          building_type: "Single Detached House",
          construction_value: "625000.00",
          units_added: "1",
          address: "10524 75 AVENUE NW",
          neighbourhood_numberr: "5480",
          neighbourhood: "QUEEN ALEXANDRA",
          latitude: "53.5123",
          longitude: "-113.5012",
          occupancy_granted_date: "2026-07-30",
          ":id": "system-1",
          ":updated_at": 1_785_369_600,
        },
      ]);
    });

    const page = await providerWithFetch(fetchImplementation).fetchPage({
      dataset: "building",
      expectedRevision: "100",
      pageSize: 100,
    });

    expect(page.rows).toHaveLength(1);
    const row = page.rows[0];
    expect(row.ok).toBe(true);
    if (!row.ok) throw new Error("Expected a valid building row.");
    expect(row.permit.occupancyGrantedDate?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
    expect(row.permit.permitNumber).toBeNull();
    expect(row.permit.neighbourhoodCityId).toBe("5480");
    expect(row.permit.constructionValue).toBe("625000.00");
    expect(row.rawRecord.payload).not.toHaveProperty(":id");
    expect(row.rawRecord.systemId).toBe("system-1");

    const pageUrl = new URL(String(fetchImplementation.mock.calls.at(-1)?.[0]));
    expect(pageUrl.searchParams.get("$order")).toBe(":id ASC");
    expect(pageUrl.searchParams.get("$select")).toContain("occupancy_granted_date");
  });

  it("maps development permits without inventing an occupancy milestone", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/api/views/")) return jsonResponse(metadata("development"));
      if (url.searchParams.get("$select") === "count(*) as count") {
        return jsonResponse([{ count: "1" }]);
      }
      return jsonResponse([
        {
          city_file_number: "DP-1",
          permit_type: "Development Permit",
          permit_class: "Class A",
          permit_date: "2026-07-01T00:00:00.000",
          status: "Approved",
          address: "11437 78 AVENUE NW",
          neighbourhood_id: "5300",
          neighbourhood: "MCKERNAN",
          latitude: "53.5101",
          longitude: "-113.5234",
          ":id": "system-dp-1",
        },
      ]);
    });

    const page = await providerWithFetch(fetchImplementation).fetchPage({
      dataset: "development",
      expectedRevision: "100",
    });
    const row = page.rows[0];
    expect(row.ok).toBe(true);
    if (row.ok) expect(row.permit.occupancyGrantedDate).toBeNull();
  });

  it("quarantines malformed nonblank permit dates instead of silently clearing them", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/api/views/")) return jsonResponse(metadata("development"));
      if (url.searchParams.get("$select") === "count(*) as count") {
        return jsonResponse([{ count: "1" }]);
      }
      return jsonResponse([
        {
          city_file_number: "DP-BAD-DATE",
          permit_type: "Development Permit",
          permit_date: "2026-07-01 trailing text",
          address: "1 TEST STREET NW",
        },
      ]);
    });

    const page = await providerWithFetch(fetchImplementation).fetchPage({
      dataset: "development",
      expectedRevision: "100",
    });
    expect(page.rows[0]).toMatchObject({ ok: false, error: { code: "INVALID_SOURCE_ROW" } });
  });

  it.each(["2026-02-30", "2026-07-30T00:00:00", "July 30, 2026", "2026-7-3"])(
    "quarantines a nonblank invalid occupancy value: %s",
    async (occupancyGrantedDate) => {
      const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.startsWith("/api/views/")) return jsonResponse(metadata("building"));
        if (url.searchParams.get("$select") === "count(*) as count") {
          return jsonResponse([{ count: "1" }]);
        }
        return jsonResponse([
          {
            row_id: "invalid-occupancy",
            issue_date: "2026-01-01T00:00:00.000",
            job_category: "New House",
            address: "10001 100 STREET NW",
            occupancy_granted_date: occupancyGrantedDate,
          },
        ]);
      });

      const page = await providerWithFetch(fetchImplementation).fetchPage({
        dataset: "building",
        expectedRevision: "100",
      });
      expect(page.rows[0]).toMatchObject({
        ok: false,
        error: { code: "INVALID_SOURCE_ROW" },
      });
    },
  );

  it("accepts leap days and treats blank occupancy as not reported", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/api/views/")) return jsonResponse(metadata("building"));
      if (url.searchParams.get("$select") === "count(*) as count") {
        return jsonResponse([{ count: "2" }]);
      }
      return jsonResponse([
        {
          row_id: "leap",
          issue_date: "2024-01-01T00:00:00.000",
          job_category: "New House",
          address: "1 TEST STREET NW",
          occupancy_granted_date: "2024-02-29",
        },
        {
          row_id: "blank",
          issue_date: "2024-01-02T00:00:00.000",
          job_category: "New House",
          address: "2 TEST STREET NW",
          occupancy_granted_date: " ",
        },
      ]);
    });

    const page = await providerWithFetch(fetchImplementation).fetchPage({
      dataset: "building",
      expectedRevision: "100",
    });
    const permits = page.rows.map((row) => (row.ok ? row.permit : null));
    expect(permits[0]?.occupancyGrantedDate?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(permits[1]?.occupancyGrantedDate).toBeNull();
  });

  it("uses an opaque revision-bound keyset cursor", async () => {
    const requestedWhere: Array<string | null> = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const dataset = datasetFromUrl(url);
      if (url.pathname.startsWith("/api/views/")) return jsonResponse(metadata(dataset));
      if (url.searchParams.get("$select") === "count(*) as count") {
        return jsonResponse([{ count: "2" }]);
      }
      const where = url.searchParams.get("$where");
      requestedWhere.push(where);
      if (!where) {
        return jsonResponse([
          {
            city_file_number: "A-1",
            ":id": "system-a",
            permit_type: "Development Permit",
            permit_date: "2026-01-01T00:00:00.000",
            address: "1 TEST STREET NW",
          },
        ]);
      }
      return jsonResponse([
        {
          city_file_number: "B-2",
          ":id": "system-b",
          permit_type: "Development Permit",
          permit_date: "2026-01-02T00:00:00.000",
          address: "2 TEST STREET NW",
        },
      ]);
    });
    const provider = providerWithFetch(fetchImplementation);
    const identifiers: string[] = [];
    let pageCount = 0;
    for await (const page of provider.pages({ dataset: "development", pageSize: 1 })) {
      pageCount += 1;
      for (const row of page.rows) {
        if (row.rawRecord.sourceRecordIdentifier) {
          identifiers.push(row.rawRecord.sourceRecordIdentifier);
        }
      }
      if (pageCount === 2) break;
    }

    expect(identifiers).toEqual(["A-1", "B-2"]);
    expect(requestedWhere).toEqual([null, ":id > 'system-a'"]);
  });

  it("continues paging after a row with no durable business identifier", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/api/views/")) return jsonResponse(metadata("development"));
      if (url.searchParams.get("$select") === "count(*) as count") {
        return jsonResponse([{ count: "2" }]);
      }
      if (!url.searchParams.get("$where")) {
        return jsonResponse([
          {
            ":id": "system-a",
            permit_type: "Development Permit",
            permit_date: "2026-01-01T00:00:00.000",
            address: "1 TEST STREET NW",
          },
        ]);
      }
      return jsonResponse([
        {
          ":id": "system-b",
          city_file_number: "DP-VALID",
          permit_type: "Development Permit",
          permit_date: "2026-01-02T00:00:00.000",
          address: "2 TEST STREET NW",
        },
      ]);
    });

    const outcomes: boolean[] = [];
    let pages = 0;
    for await (const page of providerWithFetch(fetchImplementation).pages({
      dataset: "development",
      pageSize: 1,
    })) {
      outcomes.push(...page.rows.map((row) => row.ok));
      pages += 1;
      if (pages === 2) break;
    }
    expect(outcomes).toEqual([false, true]);
  });

  it("retries HTTP 429 without exposing the application token in the URL", async () => {
    const delays: number[] = [];
    let metadataAttempts = 0;
    let retryBodyCancelled = false;
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.toString()).not.toContain("secret-token");
      expect(new Headers(init?.headers).get("X-App-Token")).toBe("secret-token");
      if (url.pathname.startsWith("/api/views/")) {
        metadataAttempts += 1;
        if (metadataAttempts === 1) {
          return cancellableErrorResponse(429, { "retry-after": "1" }, () => {
            retryBodyCancelled = true;
          });
        }
        expect(retryBodyCancelled).toBe(true);
        return jsonResponse(metadata("development"));
      }
      return jsonResponse([{ count: "0" }]);
    });
    const provider = new EdmontonSocrataPermitProvider({
      fetch: fetchImplementation,
      appToken: "secret-token",
      requestsPerSecond: 20,
      retryLimit: 1,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
      random: () => 0,
    });

    await expect(provider.getDatasetMetadata("development")).resolves.toMatchObject({
      revision: "100",
    });
    expect(metadataAttempts).toBe(2);
    expect(retryBodyCancelled).toBe(true);
    expect(delays).toContain(1_000);
  });

  it("cancels a non-retryable response body before throwing", async () => {
    let responseBodyCancelled = false;
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      cancellableErrorResponse(400, {}, () => {
        responseBodyCancelled = true;
      }),
    );
    const provider = new EdmontonSocrataPermitProvider({
      fetch: fetchImplementation,
      requestsPerSecond: 20,
      retryLimit: 0,
      sleep: async () => undefined,
    });

    await expect(provider.getDatasetMetadata("development")).rejects.toMatchObject({ status: 400 });
    expect(responseBodyCancelled).toBe(true);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("cancels a response whose declared size exceeds the configured limit", async () => {
    let responseBodyCancelled = false;
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      cancellableErrorResponse(200, { "content-length": "100001" }, () => {
        responseBodyCancelled = true;
      }),
    );
    const provider = new EdmontonSocrataPermitProvider({
      fetch: fetchImplementation,
      maxResponseBytes: 100_000,
      retryLimit: 0,
      sleep: async () => undefined,
    });

    await expect(provider.getDatasetMetadata("development")).rejects.toThrow(
      "configured size limit",
    );
    expect(responseBodyCancelled).toBe(true);
  });

  it("holds an already queued concurrent request behind Retry-After", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T00:00:00.000Z"));
    try {
      let metadataAttempts = 0;
      let releaseFirstResponse: ((response: Response) => void) | undefined;
      const fetchImplementation = vi.fn<typeof fetch>((input) => {
        const url = new URL(String(input));
        if (url.pathname.startsWith("/api/views/")) {
          metadataAttempts += 1;
          if (metadataAttempts === 1) {
            return new Promise<Response>((resolve) => {
              releaseFirstResponse = resolve;
            });
          }
          return Promise.resolve(jsonResponse(metadata("development")));
        }
        return Promise.resolve(jsonResponse([{ count: "0" }]));
      });
      const provider = new EdmontonSocrataPermitProvider({
        fetch: fetchImplementation,
        requestsPerSecond: 20,
        retryLimit: 1,
        random: () => 0,
      });

      const firstRequest = provider.getDatasetMetadata("development");
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImplementation).toHaveBeenCalledTimes(1);

      const concurrentRequest = provider.getDatasetMetadata("development");
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImplementation).toHaveBeenCalledTimes(1);

      releaseFirstResponse?.(jsonResponse({}, 429, { "retry-after": "1" }));
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchImplementation).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImplementation.mock.calls.length).toBeGreaterThanOrEqual(2);
      await vi.runAllTimersAsync();
      await expect(Promise.all([firstRequest, concurrentRequest])).resolves.toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a missing occupancy column before importing data", async () => {
    const withoutOccupancy = requiredColumns.building.filter(
      (column) => column.fieldName !== "occupancy_granted_date",
    );
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse(metadata("building", 100, withoutOccupancy)),
    );
    await expect(
      providerWithFetch(fetchImplementation).getDatasetMetadata("building"),
    ).rejects.toBeInstanceOf(ProviderSchemaError);
  });

  it("fails a snapshot if its revision changes before completion", async () => {
    let metadataCalls = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/api/views/")) {
        metadataCalls += 1;
        return jsonResponse(metadata("development", metadataCalls === 1 ? 100 : 101));
      }
      if (url.searchParams.get("$select") === "count(*) as count") {
        return jsonResponse([{ count: "1" }]);
      }
      return jsonResponse([
        {
          city_file_number: "DP-REVISION",
          permit_type: "Development Permit",
          permit_date: "2026-01-01T00:00:00.000",
          address: "1 TEST STREET NW",
        },
      ]);
    });

    const consume = async () => {
      for await (const page of providerWithFetch(fetchImplementation).pages({
        dataset: "development",
        pageSize: 100,
      })) {
        expect(page.revision).toBe("100");
      }
    };
    await expect(consume()).rejects.toBeInstanceOf(ProviderRevisionChangedError);
  });

  it("allows only the official HTTPS host", () => {
    expect(
      () => new EdmontonSocrataPermitProvider({ baseUrl: "http://data.edmonton.ca/resource" }),
    ).toThrow(ProviderConfigurationError);
    expect(
      () => new EdmontonSocrataPermitProvider({ baseUrl: "https://example.com/resource" }),
    ).toThrow(ProviderConfigurationError);
  });

  it("cancels a streamed response before it can exceed the byte limit", async () => {
    let requestNumber = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async () => {
      requestNumber += 1;
      if (requestNumber === 1) return jsonResponse(metadata("development"));
      if (requestNumber === 2) return jsonResponse([{ count: "1" }]);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(60_000));
          controller.enqueue(new Uint8Array(60_000));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = new EdmontonSocrataPermitProvider({
      fetch: fetchImplementation,
      maxResponseBytes: 100_000,
      requestsPerSecond: 20,
      retryLimit: 0,
      sleep: async () => undefined,
    });

    await expect(
      provider.fetchPage({ dataset: "development", expectedRevision: "100" }),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });
});
