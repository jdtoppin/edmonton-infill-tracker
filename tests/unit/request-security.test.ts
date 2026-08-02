import { afterEach, describe, expect, it, vi } from "vitest";

import { requestOriginIsAllowed } from "../../src/lib/request-security";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("request origin validation", () => {
  it("accepts the configured public origin behind Tailscale HTTPS termination", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://infill.example-tailnet.ts.net");
    const request = new Request("http://web:3000/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://infill.example-tailnet.ts.net",
        host: "web:3000",
        "x-forwarded-proto": "http",
      },
    });

    expect(requestOriginIsAllowed(request)).toBe(true);
  });

  it("rejects spoofed and missing production origins", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://infill.example-tailnet.ts.net");
    expect(
      requestOriginIsAllowed(
        new Request("http://web:3000/api/auth/login", {
          method: "POST",
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toBe(false);
    expect(
      requestOriginIsAllowed(
        new Request("http://web:3000/api/auth/login", {
          method: "POST",
        }),
      ),
    ).toBe(false);
  });

  it("uses the direct request origin during local development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const request = new Request("http://127.0.0.1:3000/api/auth/login", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
    });
    expect(requestOriginIsAllowed(request)).toBe(true);
  });
});
