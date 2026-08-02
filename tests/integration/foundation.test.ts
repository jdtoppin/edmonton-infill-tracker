import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("self-hosted foundation", () => {
  it("keeps PostgreSQL private while exposing the web through Caddy", async () => {
    const compose = await readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8");
    expect(compose).toContain("internal: true");
    expect(compose).not.toMatch(/\n\s+ports:\n\s+- ["']?5432/);
    expect(compose).toContain("/api/health");
  });

  it("declares idempotency constraints in the persistent model", async () => {
    const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
    expect(schema).toContain("@@unique([sourceProvider, sourceRecordIdentifier])");
    expect(schema).toContain("idempotencyKey");
    expect(schema).toContain("tokenHash");
  });

  it("keeps the guided Mac install private and non-destructive", async () => {
    const [
      installer,
      operator,
      backup,
      bootstrap,
      packageJson,
      environmentExample,
      dockerIgnore,
      viteConfig,
      continuousIntegration,
    ] = await Promise.all([
      readFile(new URL("../../scripts/install-mac.sh", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/infill", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/backup-postgres.sh", import.meta.url), "utf8"),
      readFile(new URL("../../src/cli/bootstrap-admin.ts", import.meta.url), "utf8"),
      readFile(new URL("../../package.json", import.meta.url), "utf8"),
      readFile(new URL("../../.env.example", import.meta.url), "utf8"),
      readFile(new URL("../../.dockerignore", import.meta.url), "utf8"),
      readFile(new URL("../../vite.config.ts", import.meta.url), "utf8"),
      readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"),
    ]);

    expect(installer).toContain("set_env_value HOST_BIND_ADDRESS 127.0.0.1");
    expect(installer).toContain("set_env_value HTTP_PORT 8080");
    expect(installer).toContain("set_env_value HTTPS_PORT 8443");
    expect(installer).toContain("TAILSCALE_BE_CLI=1");
    expect(installer).toContain("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
    expect(installer).toContain("run_tailscale()");
    expect(installer).not.toMatch(/(^|\n)tailscale\(\) \{/);
    expect(installer).toContain("run_tailscale status --json");
    expect(installer).toContain("serve --bg --yes");
    expect(installer).not.toContain("funnel --bg");
    expect(installer).not.toContain("plutil -lint");
    expect(installer).toContain("plutil -convert json -o /dev/null");
    expect(installer).toContain("/usr/bin/xmllint --nonet --xpath");
    expect(installer).toContain('text()="AllowFunnel"');
    expect(installer).not.toContain("prisma:seed");
    expect(installer).toContain('set_env_value INITIAL_ADMIN_PASSWORD ""');
    expect(operator).not.toMatch(/down\s+--volumes|volume\s+rm/);
    expect(operator).not.toContain("plutil -lint");
    expect(operator).toContain("run_tailscale()");
    expect(operator).not.toMatch(/(^|\n)tailscale\(\) \{/);
    expect(operator).toContain('require_funnel_off "start services"');
    expect(operator).toContain('require_funnel_off "restart services"');
    expect(operator).toContain('require_funnel_off "update"');
    expect(operator).toContain("enabled_funnel_count");
    expect(operator).toContain('operator_lock_dir="$repo_dir/backups/.operator-lock"');
    expect(operator).toContain("validate_civil_date FROM");
    expect(operator).toContain("docker compose stop caddy web worker scheduler");
    expect(operator).toContain("git pull --ff-only");
    expect(operator).toContain("import FROM TO [DATASET]");
    expect(backup).toContain("$timestamp-$$.dump");
    expect(bootstrap).toContain("UserRole.ADMIN");
    expect(bootstrap).toContain("truncates(value)");
    expect(bootstrap).not.toContain("prisma:seed");
    expect(environmentExample).toMatch(/^INITIAL_ADMIN_PASSWORD=$/m);
    expect(JSON.parse(packageJson).scripts["admin:bootstrap"]).toContain("bootstrap-admin.ts");
    expect(viteConfig).toContain('from "./.openai/hosting.json"');
    expect(dockerIgnore).not.toMatch(/^\.openai$/m);
    expect(dockerIgnore).toMatch(/^\.openai\/\*$/m);
    expect(dockerIgnore).toMatch(/^!\.openai\/hosting\.json$/m);
    expect(continuousIntegration).toContain("docker build");
    expect(continuousIntegration).toContain("--target runtime");
  });
});
