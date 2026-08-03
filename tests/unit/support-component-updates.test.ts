import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { selectLatestIncrementalVersion } from "../../scripts/support-component-updates.mjs";

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
    const postgresVersion = postgresDockerfile.match(/^FROM postgres:(\d+\.\d+)-bookworm$/m)?.[1];
    const caddyVersion = compose.match(/^\s+image: caddy:(\d+\.\d+\.\d+)-alpine$/m)?.[1];

    expect(nodeVersion).toBeTruthy();
    expect(postgresVersion).toBeTruthy();
    expect(caddyVersion).toBeTruthy();
    for (const file of [compose, developmentCompose, ci, updater]) {
      expect(file).toContain(nodeVersion);
    }
    expect(ci.split(`node-version: ${nodeVersion}`).length - 1).toBe(5);
    expect(updater.split(`node-version: ${nodeVersion}`).length - 1).toBe(1);
    for (const file of [compose, developmentCompose]) {
      expect(file).toContain(`POSTGIS_IMAGE_TAG:-${postgresVersion}-3`);
    }
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
    expect(ci).toContain("npm audit --audit-level=high");
    expect(ci).toContain("Container security");
    expect(ci).toContain("aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25");
    expect(dependabot.match(/version-update:semver-major/g)).toHaveLength(2);
  });
});
