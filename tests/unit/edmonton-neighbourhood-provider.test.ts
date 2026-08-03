import { describe, expect, it, vi } from "vitest";

import {
  EdmontonSocrataNeighbourhoodProvider,
  NeighbourhoodProviderConfigurationError,
  NeighbourhoodProviderResponseError,
  NeighbourhoodProviderSchemaError,
} from "../../src/providers/edmonton-neighbourhoods";

function jsonResponse(value: unknown, headers: HeadersInit = {}): Response {
  const body = JSON.stringify(value);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(body.length),
      ...headers,
    },
  });
}

const currentRows = [
  {
    number: "1151",
    name_mixed: "  Wîhkwêntôwin  ",
    latitude: "53.5432",
    longitude: "-113.5234",
  },
  {
    number: "5480",
    name_mixed: "Queen Alexandra",
    latitude: "53.5123",
    longitude: "-113.5012",
  },
];

describe("Edmonton current neighbourhood provider", () => {
  it("fetches only the fixed City dataset and normalizes its complete response", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => jsonResponse(currentRows));
    const provider = new EdmontonSocrataNeighbourhoodProvider({
      fetch: fetchImplementation,
      appToken: "test-token",
      minimumRows: 2,
      maximumRows: 10,
    });

    await expect(provider.fetchCurrentNeighbourhoods()).resolves.toEqual([
      {
        cityNeighbourhoodId: "1151",
        name: "Wîhkwêntôwin",
        latitude: 53.5432,
        longitude: -113.5234,
      },
      {
        cityNeighbourhoodId: "5480",
        name: "Queen Alexandra",
        latitude: 53.5123,
        longitude: -113.5012,
      },
    ]);

    const [request, init] = fetchImplementation.mock.calls[0] ?? [];
    const url = new URL(String(request));
    expect(url.origin).toBe("https://data.edmonton.ca");
    expect(url.pathname).toBe("/resource/3b6m-fezs.json");
    expect(url.searchParams.get("$select")).toBe("number,name_mixed,latitude,longitude");
    expect(url.searchParams.get("$order")).toBe("number ASC");
    expect(url.searchParams.get("$limit")).toBe("11");
    expect(new Headers(init?.headers).get("X-App-Token")).toBe("test-token");
    expect(init?.redirect).toBe("error");
  });

  it("rejects non-City origins before making a request", () => {
    expect(
      () => new EdmontonSocrataNeighbourhoodProvider({ baseUrl: "https://example.com" }),
    ).toThrow(NeighbourhoodProviderConfigurationError);
  });

  it("rejects partial snapshots, duplicate IDs, and out-of-region coordinates", async () => {
    const cases = [
      [currentRows.slice(0, 1), "unsafe row count"],
      [[currentRows[0], { ...currentRows[1], number: "1151" }], "repeated ID"],
      [[currentRows[0], { ...currentRows[1], latitude: "45.0" }], "invalid latitude"],
    ] as const;

    for (const [rows, message] of cases) {
      const provider = new EdmontonSocrataNeighbourhoodProvider({
        fetch: async () => jsonResponse(rows),
        minimumRows: 2,
        maximumRows: 10,
      });
      await expect(provider.fetchCurrentNeighbourhoods()).rejects.toThrow(message);
    }
  });

  it("rejects oversized responses before parsing them", async () => {
    const provider = new EdmontonSocrataNeighbourhoodProvider({
      fetch: async () =>
        jsonResponse(currentRows, {
          "content-length": "5000",
        }),
      minimumRows: 2,
      maximumRows: 10,
      maxResponseBytes: 100,
    });

    await expect(provider.fetchCurrentNeighbourhoods()).rejects.toBeInstanceOf(
      NeighbourhoodProviderResponseError,
    );
  });

  it("bounds a stalled request with its own timeout", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async (_request, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const provider = new EdmontonSocrataNeighbourhoodProvider({
      fetch: fetchImplementation,
      minimumRows: 1,
      maximumRows: 10,
      requestTimeoutMs: 10,
    });

    await expect(provider.fetchCurrentNeighbourhoods()).rejects.toThrow("timed out");
  });

  it("rejects undocumented response fields rather than silently trusting schema drift", async () => {
    const provider = new EdmontonSocrataNeighbourhoodProvider({
      fetch: async () => jsonResponse(currentRows.map((row) => ({ ...row, unexpected: true }))),
      minimumRows: 2,
      maximumRows: 10,
    });

    await expect(provider.fetchCurrentNeighbourhoods()).rejects.toBeInstanceOf(
      NeighbourhoodProviderSchemaError,
    );
  });
});
