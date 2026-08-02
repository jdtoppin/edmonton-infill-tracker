import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  let fakeDockerPath: string;
  let fakeLsofPath: string;
  let statusPath: string;

  beforeEach(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), "infill-tailscale-port-test-"));
    fakeDockerPath = join(fixtureDirectory, "docker");
    fakeLsofPath = join(fixtureDirectory, "lsof");
    statusPath = join(fixtureDirectory, "serve-status.json");
    await writeFile(
      fakeDockerPath,
      `#!/bin/sh
if [ "\${INFILL_FAKE_DOCKER_FAIL:-0}" = 1 ]; then
  exit 1
fi

case "\${1:-}" in
  ps)
    case " $* " in
      *" --all "*) ;;
      *) exit 2 ;;
    esac
    case " $* " in
      *" --quiet "*) ;;
      *) exit 2 ;;
    esac
    printf '%s\n' "\${INFILL_FAKE_DOCKER_IDS:-}"
    ;;
  inspect)
    [ "\${2:-}" = --format ] || exit 2
    case "\${3:-}" in
      *HostConfig.PortBindings*) ;;
      *) exit 2 ;;
    esac
    [ -n "\${4:-}" ] || exit 2
    printf '%s\n' "\${INFILL_FAKE_DOCKER_PORTS:-}"
    ;;
  *) exit 2 ;;
esac
`,
      { mode: 0o700 },
    );
    await writeFile(
      fakeLsofPath,
      `#!/bin/sh
protocol=
port=

for argument in "$@"; do
  case "$argument" in
    -iTCP:*)
      protocol=TCP
      port=\${argument#-iTCP:}
      ;;
    -iUDP:*)
      protocol=UDP
      port=\${argument#-iUDP:}
      ;;
  esac
done

case "$protocol" in
  TCP) busy_ports=\${INFILL_FAKE_TCP_BUSY:-} ;;
  UDP) busy_ports=\${INFILL_FAKE_UDP_BUSY:-} ;;
  *) exit 2 ;;
esac

[ "\${INFILL_FAKE_LSOF_FAIL:-0}" != 1 ] || exit 2

case ",$busy_ports," in
  *",$port,"*) exit 0 ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o700 },
    );
    await chmod(fakeDockerPath, 0o700);
    await chmod(fakeLsofPath, 0o700);
  });

  afterEach(async () => {
    await rm(fixtureDirectory, { force: true, recursive: true });
  });

  async function selectPort(
    status: unknown,
    options: {
      dnsName?: string;
      dockerFails?: boolean;
      lsofFails?: boolean;
      dockerPorts?: string;
      raw?: boolean;
      startPort?: string;
      tcp?: string;
      udp?: string;
    } = {},
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
          INFILL_DOCKER_BIN: fakeDockerPath,
          INFILL_FAKE_DOCKER_FAIL: options.dockerFails ? "1" : "0",
          INFILL_FAKE_DOCKER_IDS: options.dockerPorts ? "stopped-nocturne" : "",
          INFILL_FAKE_DOCKER_PORTS: options.dockerPorts ?? "",
          INFILL_FAKE_LSOF_FAIL: options.lsofFails ? "1" : "0",
          INFILL_FAKE_TCP_BUSY: options.tcp ?? "",
          INFILL_FAKE_UDP_BUSY: options.udp ?? "",
          INFILL_LSOF_BIN: fakeLsofPath,
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
          INFILL_DOCKER_BIN: fakeDockerPath,
          INFILL_FAKE_DOCKER_PORTS: "",
          INFILL_FAKE_TCP_BUSY: "",
          INFILL_FAKE_UDP_BUSY: "",
          INFILL_LSOF_BIN: fakeLsofPath,
          INFILL_PLUTIL_BIN: "/usr/bin/plutil",
          INFILL_XMLLINT_BIN: "/usr/bin/xmllint",
        },
      },
    );
  }

  async function dockerPortStatus(
    port: string,
    dockerPorts: string,
    options: { dockerFails?: boolean } = {},
  ) {
    return execFileAsync("/bin/sh", [selectorPath, "--docker-port-status", port], {
      env: {
        ...process.env,
        INFILL_DOCKER_BIN: fakeDockerPath,
        INFILL_FAKE_DOCKER_FAIL: options.dockerFails ? "1" : "0",
        INFILL_FAKE_DOCKER_IDS: dockerPorts ? "stopped-nocturne" : "",
        INFILL_FAKE_DOCKER_PORTS: dockerPorts,
      },
    });
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

  it("skips Nocturne's saved 9443 binding even while its container is stopped", async () => {
    const result = await selectPort(
      {
        TCP: { "443": { HTTPS: true } },
        Web: {
          "nightscout.example-tailnet.ts.net:443": {
            Handlers: { "/": { Proxy: "http://127.0.0.1:8080" } },
          },
        },
      },
      {
        dockerPorts: "9443->443/tcp 9443->443/udp",
      },
    );

    expect(result.stdout).toBe("9444\n");
    expect(result.stderr).toBe("");
  });

  it("skips non-Docker TCP and UDP listeners when choosing a fallback", async () => {
    const result = await selectPort(
      { TCP: { "443": { HTTPS: true } } },
      { tcp: "9443", udp: "9444" },
    );

    expect(result.stdout).toBe("9445\n");
  });

  it("reports whether Docker already publishes a candidate port", async () => {
    const occupied = await dockerPortStatus("9443", "0.0.0.0:9443->443/tcp");
    const free = await dockerPortStatus("9444", "0.0.0.0:9443->443/tcp");

    expect(occupied.stdout).toBe("in-use\n");
    expect(free.stdout).toBe("free\n");
  });

  it("fails closed when Docker cannot confirm a managed port is free", async () => {
    await expect(dockerPortStatus("9443", "", { dockerFails: true })).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("Docker published ports could not be inspected"),
    });
  });

  it("fails closed when Docker cannot inspect fallback candidates", async () => {
    await expect(
      selectPort({ TCP: { "443": { HTTPS: true } } }, { dockerFails: true }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("Docker published ports could not be inspected"),
    });
  });

  it("fails closed when lsof cannot inspect a fallback candidate", async () => {
    await expect(
      selectPort({ TCP: { "443": { HTTPS: true } } }, { lsofFails: true }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("lsof could not inspect TCP port 9443"),
    });
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

  it("rejects managed-port ownership when another path shares the HTTPS listener", async () => {
    await expect(
      verifyRoute({
        TCP: { "443": { HTTPS: true } },
        Web: {
          "infill.example-tailnet.ts.net:443": {
            Handlers: {
              "/": { Proxy: "http://127.0.0.1:8080" },
              "/another-app": { Proxy: "http://127.0.0.1:9000" },
            },
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("sole handler"),
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
