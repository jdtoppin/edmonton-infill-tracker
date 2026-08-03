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
        caddy: "2.11.4",
        postgres: "17.10",
      },
      fetchImpl,
    );

    expect(updates.npmBraceExpansion.latest).toBe("5.0.10");
  });

  it("keeps coordinated support pins synchronized", async () => {
    const [dockerfile, compose, developmentCompose, postgresDockerfile, ci, updater] =
      await Promise.all([
        readFile(new URL("../../Dockerfile", import.meta.url), "utf8"),
        readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8"),
        readFile(new URL("../../docker-compose.dev.yml", import.meta.url), "utf8"),
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
    const postgresVersion = postgresDockerfile.match(/^FROM postgres:(\d+\.\d+)-bookworm$/m)?.[1];
    const caddyVersion = compose.match(/^\s+image: caddy:(\d+\.\d+\.\d+)-alpine$/m)?.[1];

    expect(nodeVersion).toBeTruthy();
    expect(npmVersion).toBeTruthy();
    expect(npmBraceExpansionVersion).toBeTruthy();
    expect(postgresVersion).toBeTruthy();
    expect(caddyVersion).toBeTruthy();
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
    expect(dockerfile).toContain(
      "/usr/local/lib/node_modules/npm/node_modules/brace-expansion/package.json",
    );
    expect(ci).toContain("expected_npm_brace_expansion");
    expect(ci).toContain("actual_npm_brace_expansion");
    expect(ci).toContain(`docker pull caddy:${caddyVersion}-alpine`);
    expect(ci.split(`caddy:${caddyVersion}-alpine`).length - 1).toBe(3);
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
    expect(updaterScript).toContain(
      "[`caddy:${current.caddy}-alpine`, `caddy:${latest.caddy}-alpine`, 3]",
    );
    expect(updaterScript).toContain('label: "npm bundled brace-expansion"');
    expect(updaterScript).toContain(
      "`ARG NPM_BRACE_EXPANSION_VERSION=${npmBraceExpansionReplacement[0]}`",
    );
    expect(ci).toContain("npm audit --audit-level=high");
    expect(ci).toContain("Container security");
    expect(ci).toContain("aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25");
    expect(dependabot.match(/version-update:semver-major/g)).toHaveLength(2);
  });
});
