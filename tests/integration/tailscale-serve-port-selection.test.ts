import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const selectorPath = fileURLToPath(
  new URL("../../scripts/select-tailscale-serve-port.sh", import.meta.url),
);
const hasMacPlistTools =
  process.platform === "darwin" && existsSync("/usr/bin/plutil") && existsSync("/usr/bin/xmllint");

describe.skipIf(!hasMacPlistTools)("Tailscale Serve HTTPS port selection", () => {
  let fixtureDirectory: string;
  let statusPath: string;

  beforeEach(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), "infill-tailscale-port-test-"));
    statusPath = join(fixtureDirectory, "serve-status.json");
  });

  afterEach(async () => {
    await rm(fixtureDirectory, { force: true, recursive: true });
  });

  async function selectPort(
    status: unknown,
    options: { dnsName?: string; raw?: boolean; startPort?: string } = {},
  ) {
    await writeFile(statusPath, options.raw ? String(status) : JSON.stringify(status));

    return execFileAsync(
      "/bin/sh",
      [
        selectorPath,
        statusPath,
        options.dnsName ?? "infill.example-tailnet.ts.net.",
        options.startPort ?? "443",
      ],
      {
        env: {
          ...process.env,
          INFILL_PLUTIL_BIN: "/usr/bin/plutil",
          INFILL_XMLLINT_BIN: "/usr/bin/xmllint",
        },
      },
    );
  }

  async function verifyRoute(
    status: unknown,
    options: { dnsName?: string; port?: string; target?: string } = {},
  ) {
    await writeFile(statusPath, JSON.stringify(status));

    return execFileAsync(
      "/bin/sh",
      [
        selectorPath,
        "--verify-route",
        statusPath,
        options.dnsName ?? "infill.example-tailnet.ts.net.",
        options.port ?? "443",
        options.target ?? "http://127.0.0.1:8080",
      ],
      {
        env: {
          ...process.env,
          INFILL_PLUTIL_BIN: "/usr/bin/plutil",
          INFILL_XMLLINT_BIN: "/usr/bin/xmllint",
        },
      },
    );
  }

  it("keeps the requested HTTPS port when Serve has no TCP listeners", async () => {
    const result = await selectPort({ TCP: {}, Web: {} });

    expect(result.stdout).toBe("443\n");
    expect(result.stderr).toBe("");
  });

  it("uses the fallback range when a background Serve listener owns port 443", async () => {
    const result = await selectPort({
      TCP: { "443": { HTTPS: true } },
      Web: {
        "nightscout.example-tailnet.ts.net:443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:8080" } },
        },
      },
    });

    expect(result.stdout).toBe("9443\n");
  });

  it("does not claim an unmarked route even when its DNS and proxy happen to match", async () => {
    const result = await selectPort({
      TCP: { "443": { HTTPS: true } },
      Web: {
        "infill.example-tailnet.ts.net:443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:8080" } },
        },
      },
    });

    expect(result.stdout).toBe("9443\n");
  });

  it("finds TCP listeners nested under foreground configuration", async () => {
    const result = await selectPort({
      Foreground: {
        session: {
          TCP: { "443": { HTTPS: true } },
        },
      },
    });

    expect(result.stdout).toBe("9443\n");
  });

  it("skips fallback ports owned by nested services", async () => {
    const result = await selectPort({
      TCP: { "443": { HTTPS: true } },
      Services: {
        "svc:nightscout": {
          TCP: { "9443": { HTTPS: true } },
        },
      },
    });

    expect(result.stdout).toBe("9444\n");
  });

  it("verifies the exact managed background proxy and HTTPS listener", async () => {
    const result = await verifyRoute({
      TCP: { "443": { HTTPS: true } },
      Web: {
        "infill.example-tailnet.ts.net:443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:8080" } },
        },
      },
    });

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("rejects a route owned by another target", async () => {
    await expect(
      verifyRoute({
        TCP: { "443": { HTTPS: true } },
        Web: {
          "infill.example-tailnet.ts.net:443": {
            Handlers: { "/": { Proxy: "http://127.0.0.1:8088" } },
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("expected private Tailscale Serve route"),
    });
  });

  it("does not claim a matching foreground route as installer-managed", async () => {
    await expect(
      verifyRoute({
        Foreground: {
          session: {
            TCP: { "443": { HTTPS: true } },
            Web: {
              "infill.example-tailnet.ts.net:443": {
                Handlers: { "/": { Proxy: "http://127.0.0.1:8080" } },
              },
            },
          },
        },
      }),
    ).rejects.toMatchObject({ code: 1, stdout: "" });
  });

  it("rejects malformed status JSON", async () => {
    await expect(selectPort('{"TCP":', { raw: true })).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("status file is not valid JSON"),
    });
  });

  it.each([
    { dnsName: "https://mini.example.ts.net", startPort: "443" },
    { dnsName: "mini..example.ts.net", startPort: "443" },
    { dnsName: "mini.example.ts.net", startPort: "0" },
    { dnsName: "mini.example.ts.net", startPort: "65536" },
  ])("rejects invalid DNS names and ports: %o", async ({ dnsName, startPort }) => {
    await expect(selectPort({}, { dnsName, startPort })).rejects.toMatchObject({
      code: 1,
      stdout: "",
    });
  });

  it("fails closed when all 200 fallback candidates are occupied", async () => {
    const occupied = Object.fromEntries(
      [443, ...Array.from({ length: 200 }, (_, index) => 9443 + index)].map((port) => [
        String(port),
        { HTTPS: true },
      ]),
    );

    await expect(selectPort({ TCP: occupied })).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining(
        "no unused Tailscale Serve HTTPS port found in 200 candidates from 9443",
      ),
    });
  });
});
