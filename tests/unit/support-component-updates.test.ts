import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  discoverIncrementalUpdates,
  selectLatestIncrementalVersion,
  selectLatestSameMajorFromVersions,
  selectLatestSameMajorVersion,
} from "../../scripts/support-component-updates.mjs";

describe("support-component update policy", () => {
  it("selects stable same-major image updates without downgrading", () => {
    expect(
      selectLatestIncrementalVersion({
        current: "22.23.1",
        tags: [
          "22.23.0-bookworm-slim",
          "22.23.2-bookworm-slim",
          "22.24.0-bookworm-slim",
          "23.1.0-bookworm-slim",
          "22.25.0-rc.1-bookworm-slim",
          "22.99.0-alpine",
        ],
        suffix: "bookworm-slim",
        versionParts: 3,
      }),
    ).toBe("22.24.0");

    expect(
      selectLatestIncrementalVersion({
        current: "17.10",
        tags: ["17.8-bookworm", "17.9-bookworm", "18.1-bookworm"],
        suffix: "bookworm",
        versionParts: 2,
      }),
    ).toBe("17.10");
  });

  it("keeps automated Go updates on the pinned toolchain release line", () => {
    expect(
      selectLatestIncrementalVersion({
        current: "1.26.5",
        tags: ["1.26.6-alpine3.24", "1.27.1-alpine3.24", "1.26.7-rc.1-alpine3.24"],
        suffix: "alpine3.24",
        versionParts: 3,
        compatibilityParts: 2,
      }),
    ).toBe("1.26.6");
  });

  it("accepts only a newer stable npm release on the pinned major", () => {
    expect(
      selectLatestSameMajorVersion({
        current: "11.18.0",
        candidate: "11.19.0",
        versionParts: 3,
      }),
    ).toBe("11.19.0");
    expect(
      selectLatestSameMajorVersion({
        current: "11.19.0",
        candidate: "11.18.0",
        versionParts: 3,
      }),
    ).toBe("11.19.0");
    expect(() =>
      selectLatestSameMajorVersion({
        current: "11.19.0",
        candidate: "12.0.2",
        versionParts: 3,
      }),
    ).toThrow("same-major");
    expect(() =>
      selectLatestSameMajorVersion({
        current: "11.19.0",
        candidate: "11.20.0-beta.1",
        versionParts: 3,
      }),
    ).toThrow("same-major");
    expect(
      selectLatestSameMajorVersion({
        current: "5.0.7",
        candidate: "5.0.9",
        versionParts: 3,
      }),
    ).toBe("5.0.9");
  });

  it("selects the newest stable bundled dependency without crossing majors", () => {
    expect(
      selectLatestSameMajorFromVersions({
        current: "5.0.9",
        versions: ["5.0.8", "5.0.10", "5.1.0-beta.1", "6.0.0"],
        versionParts: 3,
      }),
    ).toBe("5.0.10");
    expect(
      selectLatestSameMajorFromVersions({
        current: "5.0.9",
        versions: ["4.0.4", "5.0.8", "6.0.0"],
        versionParts: 3,
      }),
    ).toBe("5.0.9");
  });

  it("discovers a same-major bundled dependency update from package metadata", async () => {
    const dockerTags = {
      node: "22.23.2-bookworm-slim",
      golang: "1.26.5-alpine3.24",
      caddy: "2.11.4-alpine",
      postgres: "17.10-bookworm",
    };
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/-/package/npm/dist-tags")) {
        return new Response(JSON.stringify({ "next-12": "12.0.2" }));
      }
      if (url === "https://registry.npmjs.org/brace-expansion") {
        return new Response(
          JSON.stringify({ versions: { "5.0.9": {}, "5.0.10": {}, "6.0.0": {} } }),
        );
      }
      if (url === "https://registry.npmjs.org/ip-address") {
        return new Response(
          JSON.stringify({ versions: { "10.3.1": {}, "10.3.2": {}, "11.0.0": {} } }),
        );
      }
      if (url === "https://registry.npmjs.org/tar") {
        return new Response(
          JSON.stringify({ versions: { "7.5.21": {}, "7.5.22": {}, "8.0.0": {} } }),
        );
      }
      if (url === "https://proxy.golang.org/golang.org/x/text/@v/list") {
        return new Response("v0.39.0\nv0.40.0\n");
      }
      if (url === "https://proxy.golang.org/google.golang.org/grpc/@v/list") {
        return new Response("v1.82.1\nv1.83.0\n");
      }
      const repository = Object.keys(dockerTags).find((name) =>
        url.includes(`/library/${name}/tags`),
      ) as keyof typeof dockerTags | undefined;
      if (!repository) return new Response("not found", { status: 404 });
      return new Response(
        JSON.stringify({
          results: [
            {
              name: dockerTags[repository],
              images: [{ architecture: "amd64" }, { architecture: "arm64" }],
            },
          ],
          next: null,
        }),
      );
    };

    const updates = await discoverIncrementalUpdates(
      {
        node: "22.23.2",
        npm: "12.0.2",
        npmBraceExpansion: "5.0.9",
        npmIpAddress: "10.3.1",
        npmTar: "7.5.21",
        caddyGo: "1.26.5",
        caddy: "2.11.4",
        caddyXText: "0.39.0",
        caddyGrpc: "1.82.1",
        postgres: "17.10",
      },
      fetchImpl,
    );

    expect(updates.npmBraceExpansion.latest).toBe("5.0.10");
    expect(updates.npmIpAddress.latest).toBe("10.3.2");
    expect(updates.npmTar.latest).toBe("7.5.22");
    expect(updates.caddyXText.latest).toBe("0.40.0");
    expect(updates.caddyGrpc.latest).toBe("1.83.0");
  });

  it("keeps coordinated support pins synchronized", async () => {
    const [
      dockerfile,
      compose,
      developmentCompose,
      caddyDockerfile,
      caddyGoMod,
      caddyGoSum,
      caddyMain,
      postgresDockerfile,
      ci,
      updater,
    ] = await Promise.all([
      readFile(new URL("../../Dockerfile", import.meta.url), "utf8"),
      readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8"),
      readFile(new URL("../../docker-compose.dev.yml", import.meta.url), "utf8"),
      readFile(new URL("../../deploy/caddy/Dockerfile", import.meta.url), "utf8"),
      readFile(new URL("../../deploy/caddy/go.mod", import.meta.url), "utf8"),
      readFile(new URL("../../deploy/caddy/go.sum", import.meta.url), "utf8"),
      readFile(new URL("../../deploy/caddy/main.go", import.meta.url), "utf8"),
      readFile(new URL("../../deploy/postgis/Dockerfile", import.meta.url), "utf8"),
      readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"),
      readFile(
        new URL("../../.github/workflows/support-component-updates.yml", import.meta.url),
        "utf8",
      ),
    ]);

    const nodeVersion = dockerfile.match(/^ARG NODE_VERSION=(\d+\.\d+\.\d+)$/m)?.[1];
    const npmVersion = dockerfile.match(/^ARG NPM_VERSION=(\d+\.\d+\.\d+)$/m)?.[1];
    const npmBraceExpansionVersion = dockerfile.match(
      /^ARG NPM_BRACE_EXPANSION_VERSION=(\d+\.\d+\.\d+)$/m,
    )?.[1];
    const npmIpAddressVersion = dockerfile.match(
      /^ARG NPM_IP_ADDRESS_VERSION=(\d+\.\d+\.\d+)$/m,
    )?.[1];
    const npmTarVersion = dockerfile.match(/^ARG NPM_TAR_VERSION=(\d+\.\d+\.\d+)$/m)?.[1];
    const postgresVersion = postgresDockerfile.match(/^FROM postgres:(\d+\.\d+)-bookworm$/m)?.[1];
    const caddyGoVersion = caddyDockerfile.match(/^ARG CADDY_GO_VERSION=(\d+\.\d+\.\d+)$/m)?.[1];
    const caddyVersion = caddyGoMod.match(
      /^\s*(?:require\s+)?github\.com\/caddyserver\/caddy\/v2 v(\d+\.\d+\.\d+)(?: \/\/ indirect)?$/m,
    )?.[1];
    const caddyXTextVersion = caddyGoMod.match(
      /^\s*golang\.org\/x\/text v(\d+\.\d+\.\d+)(?: \/\/ indirect)?$/m,
    )?.[1];
    const caddyGrpcVersion = caddyGoMod.match(
      /^\s*google\.golang\.org\/grpc v(\d+\.\d+\.\d+)(?: \/\/ indirect)?$/m,
    )?.[1];

    expect(nodeVersion).toBeTruthy();
    expect(npmVersion).toBeTruthy();
    expect(npmBraceExpansionVersion).toBeTruthy();
    expect(npmIpAddressVersion).toBeTruthy();
    expect(npmTarVersion).toBeTruthy();
    expect(postgresVersion).toBeTruthy();
    expect(caddyGoVersion).toBeTruthy();
    expect(caddyVersion).toBeTruthy();
    expect(caddyXTextVersion).toBeTruthy();
    expect(caddyGrpcVersion).toBeTruthy();
    for (const file of [compose, developmentCompose, ci, updater]) {
      expect(file).toContain(nodeVersion);
    }
    expect(ci.split(`node-version: ${nodeVersion}`).length - 1).toBe(5);
    expect(updater.split(`node-version: ${nodeVersion}`).length - 1).toBe(1);
    for (const file of [compose, developmentCompose]) {
      expect(file).toContain(`NPM_VERSION:-${npmVersion}`);
      expect(file).toContain(`POSTGIS_IMAGE_TAG:-${postgresVersion}-3`);
    }
    expect(dockerfile).toContain(`npm install --global "npm@\${NPM_VERSION}"`);
    expect(dockerfile).toContain(`"brace-expansion@\${NPM_BRACE_EXPANSION_VERSION}"`);
    expect(dockerfile).toContain(`"ip-address@\${NPM_IP_ADDRESS_VERSION}"`);
    expect(dockerfile).toContain(`"tar@\${NPM_TAR_VERSION}"`);
    expect(dockerfile).toContain(
      "/usr/local/lib/node_modules/npm/node_modules/brace-expansion/package.json",
    );
    expect(dockerfile).toContain(
      "/usr/local/lib/node_modules/npm/node_modules/ip-address/package.json",
    );
    expect(dockerfile).toContain("/usr/local/lib/node_modules/npm/node_modules/tar/package.json");
    expect(ci).toContain("expected_npm_brace_expansion");
    expect(ci).toContain("actual_npm_brace_expansion");
    expect(ci).toContain("expected_npm_ip_address");
    expect(ci).toContain("actual_npm_ip_address");
    expect(ci).toContain("expected_npm_tar");
    expect(ci).toContain("actual_npm_tar");
    expect(compose).toContain(`CADDY_GO_VERSION:-${caddyGoVersion}`);
    expect(caddyDockerfile).toContain(`golang:\${CADDY_GO_VERSION}-alpine3.24`);
    expect(caddyDockerfile).toContain("GOTOOLCHAIN=local");
    expect(caddyGoMod).toContain(`github.com/caddyserver/caddy/v2 v${caddyVersion}`);
    expect(caddyGoMod).toContain(`golang.org/x/text v${caddyXTextVersion}`);
    expect(caddyGoMod).toContain(`google.golang.org/grpc v${caddyGrpcVersion}`);
    expect(caddyGoSum.split("\n").length).toBeGreaterThan(500);
    expect(caddyDockerfile).toContain("COPY go.mod go.sum main.go ./");
    expect(caddyDockerfile).toContain("go mod verify");
    expect(caddyDockerfile).toContain("-mod=readonly");
    expect(caddyMain).toContain('caddycmd "github.com/caddyserver/caddy/v2/cmd"');
    expect(ci).toContain("docker build");
    expect(ci).toContain("deploy/caddy");
    expect(ci.split("edmonton-infill-caddy:security-scan").length - 1).toBe(4);
    expect(ci).toContain("caddy build-info");
  });

  it("opens support PRs only after the full CI run succeeds", async () => {
    const [workflow, updaterScript, ci, dependabot] = await Promise.all([
      readFile(
        new URL("../../.github/workflows/support-component-updates.yml", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../../scripts/support-component-updates.mjs", import.meta.url), "utf8"),
      readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"),
      readFile(new URL("../../.github/dependabot.yml", import.meta.url), "utf8"),
    ]);

    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain(".isCrossRepository == false");
    expect(workflow).toContain('startswith("codex/support-components-")');
    expect(workflow).toContain("if: steps.pending.outputs.exists != 'true'");
    expect(workflow).toContain('update_branch="codex/support-components-${GITHUB_RUN_ID}"');
    expect(workflow).toContain('gh workflow run ci.yml --ref "$UPDATE_BRANCH"');
    expect(workflow).toContain('gh run watch "$run_id" --exit-status');
    expect(workflow.indexOf("gh run watch")).toBeLessThan(workflow.indexOf("gh pr create"));
    expect(workflow).not.toMatch(/gh pr merge|auto-merge|docker compose up|scripts\/infill update/);
    expect(updaterScript).toContain('label: "Caddy Go toolchain"');
    expect(updaterScript).toContain('label: "Caddy golang.org/x/text"');
    expect(updaterScript).toContain('label: "Caddy google.golang.org/grpc"');
    expect(updaterScript).toContain('source: "go-module"');
    expect(updaterScript).toContain('label: "npm bundled brace-expansion"');
    expect(updaterScript).toContain('label: "npm bundled ip-address"');
    expect(updaterScript).toContain('label: "npm bundled tar"');
    expect(updaterScript).toContain(
      "`ARG NPM_BRACE_EXPANSION_VERSION=${npmBraceExpansionReplacement[0]}`",
    );
    expect(updaterScript).toContain("`ARG NPM_IP_ADDRESS_VERSION=${npmIpAddressReplacement[0]}`");
    expect(updaterScript).toContain("`ARG NPM_TAR_VERSION=${npmTarReplacement[0]}`");
    expect(ci).toContain("npm audit --audit-level=high");
    expect(ci).toContain("Container security");
    expect(ci).toContain("aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25");
    expect(workflow).toContain("deploy/caddy/Dockerfile");
    expect(workflow).toContain("deploy/caddy/go.mod");
    expect(workflow).toContain("deploy/caddy/go.sum");
    expect(workflow).toContain("go mod tidy");
    expect(workflow).toContain("go mod verify");
    expect(workflow).toContain("actions/setup-go@924ae3a1cded613372ab5595356fb5720e22ba16");
    expect(dependabot.match(/version-update:semver-major/g)).toHaveLength(3);
    expect(dependabot).toContain("package-ecosystem: gomod");
    expect(dependabot).toContain("directory: /deploy/caddy");
  });

  it("keeps PostGIS scanner exceptions path-scoped, explicit, and expiring", async () => {
    const [ci, ignoreFile] = await Promise.all([
      readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"),
      readFile(new URL("../../.github/trivyignore-postgis-gosu.yaml", import.meta.url), "utf8"),
    ]);
    const expectedIds = [
      "CVE-2025-61726",
      "CVE-2025-61729",
      "CVE-2025-68121",
      "CVE-2026-25679",
      "CVE-2026-27145",
      "CVE-2026-32280",
      "CVE-2026-32281",
      "CVE-2026-32283",
      "CVE-2026-33811",
      "CVE-2026-33814",
      "CVE-2026-33818",
      "CVE-2026-39820",
      "CVE-2026-39821",
      "CVE-2026-39822",
      "CVE-2026-39836",
      "CVE-2026-42499",
      "CVE-2026-42504",
      "CVE-2026-56853",
      "CVE-2026-56858",
      "CVE-2026-56859",
      "CVE-2026-56860",
      "CVE-2026-56862",
    ];
    const entries = ignoreFile.split(/^  - id: /m).slice(1);

    expect(ignoreFile).toContain("official gosu 1.19 amd64 binary");
    expect(ignoreFile).toContain(
      "52c8749d0142edd234e9d6bd5237dff2d81e71f43537e2f4f66f75dd4b243dd0",
    );
    expect(ignoreFile).toContain("govulncheck-with-excludes.sh reachability scan on 2026-08-25");
    expect(entries.map((entry) => entry.match(/^([^\n]+)/)?.[1])).toEqual(expectedIds);
    expect(entries).toHaveLength(expectedIds.length);
    for (const entry of entries) {
      expect(entry).toContain('paths:\n      - "usr/local/bin/gosu"');
      expect(entry).toContain("expired_at: 2026-09-15");
      expect(entry).toContain("statement:");
    }
    const newReachabilityEvidence = {
      "CVE-2026-33818": "encoding/asn1.Unmarshal",
      "CVE-2026-39821": "network or IDNA-processing",
      "CVE-2026-56853": "net/http or HTTP/2",
      "CVE-2026-56858": "html/template",
      "CVE-2026-56859": "encoding/xml",
      "CVE-2026-56860": "net/url",
      "CVE-2026-56862": "crypto/tls",
    };
    for (const [id, evidence] of Object.entries(newReachabilityEvidence)) {
      expect(entries.find((entry) => entry.startsWith(id))).toContain(evidence);
    }

    expect(ci.match(/trivyignores:/g)).toHaveLength(1);
    const postgisScan = ci
      .split("- name: Scan PostGIS image")[1]
      ?.split("- name: Scan Caddy image")[0];
    expect(postgisScan).toContain("trivyignores: .github/trivyignore-postgis-gosu.yaml");
    const caddyScan = ci.split("- name: Scan Caddy image")[1];
    expect(caddyScan).toContain("image-ref: edmonton-infill-caddy:security-scan");
    expect(caddyScan).not.toContain("trivyignores:");
  });
});
