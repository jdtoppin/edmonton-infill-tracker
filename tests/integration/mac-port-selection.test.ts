import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const selectorPath = fileURLToPath(new URL("../../scripts/select-mac-ports.sh", import.meta.url));

describe("Mac host port selection", () => {
  let fixtureDirectory: string;
  let fakeDockerPath: string;
  let fakeLsofPath: string;

  beforeEach(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), "infill-port-test-"));
    fakeDockerPath = join(fixtureDirectory, "docker");
    fakeLsofPath = join(fixtureDirectory, "lsof");
    await writeFile(
      fakeDockerPath,
      `#!/bin/sh
if [ "\${INFILL_FAKE_DOCKER_FAIL:-0}" = 1 ]; then
  exit 1
fi

[ "\${1:-}" = ps ] || exit 2
printf '%s\n' "\${INFILL_FAKE_DOCKER_PORTS:-}"
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

  async function selectPorts(
    httpStart: string,
    httpsStart: string,
    busy: {
      dockerFails?: boolean;
      dockerPorts?: string;
      lsofFails?: boolean;
      tcp?: string;
      udp?: string;
    } = {},
  ) {
    return execFileAsync("/bin/sh", [selectorPath, httpStart, httpsStart], {
      env: {
        ...process.env,
        INFILL_DOCKER_BIN: fakeDockerPath,
        INFILL_FAKE_DOCKER_FAIL: busy.dockerFails ? "1" : "0",
        INFILL_FAKE_DOCKER_PORTS: busy.dockerPorts ?? "",
        INFILL_FAKE_LSOF_FAIL: busy.lsofFails ? "1" : "0",
        INFILL_FAKE_TCP_BUSY: busy.tcp ?? "",
        INFILL_FAKE_UDP_BUSY: busy.udp ?? "",
        INFILL_LSOF_BIN: fakeLsofPath,
      },
    });
  }

  it("keeps the requested defaults when both ports are free", async () => {
    const result = await selectPorts("8080", "8443");

    expect(result.stdout).toBe("8080 8443\n");
    expect(result.stderr).toBe("");
  });

  it("advances HTTP and HTTPS independently for TCP and UDP conflicts", async () => {
    const result = await selectPorts("8080", "8443", {
      tcp: "8080",
      udp: "8443",
    });

    expect(result.stdout).toBe("8081 8444\n");
    expect(result.stderr).toBe("");
  });

  it("treats a TCP listener as an HTTPS conflict", async () => {
    const result = await selectPorts("8080", "8443", { tcp: "8443" });

    expect(result.stdout).toBe("8080 8444\n");
  });

  it("detects wildcard TCP and UDP ports published by Docker", async () => {
    const result = await selectPorts("8080", "8443", {
      dockerPorts:
        "0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 0.0.0.0:8443->443/udp, [::]:8443->443/udp",
    });

    expect(result.stdout).toBe("8081 8444\n");
    expect(result.stderr).toBe("");
  });

  it("falls back to lsof when Docker port inspection fails", async () => {
    const result = await selectPorts("8080", "8443", {
      dockerFails: true,
      tcp: "8080",
    });

    expect(result.stdout).toBe("8081 8443\n");
    expect(result.stderr).toBe("");
  });

  it("fails closed when lsof cannot inspect a port", async () => {
    await expect(selectPorts("8080", "8443", { lsofFails: true })).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("lsof could not inspect TCP port 8080"),
    });
  });

  it("makes equal starting ports distinct", async () => {
    const result = await selectPorts("8080", "8080");

    expect(result.stdout).toBe("8080 8081\n");
  });

  it.each([
    ["not-a-port", "8443"],
    ["0", "8443"],
    ["8080", "65536"],
  ])("rejects invalid or out-of-range ports (%s, %s)", async (http, https) => {
    await expect(selectPorts(http, https)).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("must be an integer from 1 to 65535"),
    });
  });

  it("stops after checking 200 candidates", async () => {
    const occupiedPorts = Array.from({ length: 200 }, (_, index) => 10000 + index).join(",");

    await expect(selectPorts("10000", "8443", { tcp: occupiedPorts })).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining(
        "no free HTTP port found in the next 200 candidates from 10000",
      ),
    });
  });

  it("does not scan past port 65535", async () => {
    await expect(selectPorts("65535", "8443", { tcp: "65535" })).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("from 65535"),
    });
  });
});
