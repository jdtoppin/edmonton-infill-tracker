import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("self-hosted foundation", () => {
  it("keeps PostgreSQL private while exposing the web through Caddy", async () => {
    const compose = await readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8");
    expect(compose).toContain("internal: true");
    expect(compose).not.toMatch(/\n\s+ports:\n\s+- ["']?5432/);
    expect(compose).not.toContain("/var/run/docker.sock");
    expect(compose).toContain("/api/health");
  });

  it("keeps the browser basemap token-free and runtime-configurable", async () => {
    const [environmentExample, compose, dockerfile, continuousIntegration] = await Promise.all([
      readFile(new URL("../../.env.example", import.meta.url), "utf8"),
      readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8"),
      readFile(new URL("../../Dockerfile", import.meta.url), "utf8"),
      readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"),
    ]);

    expect(environmentExample).toMatch(
      /^MAP_TILE_URL=https:\/\/vector\.openstreetmap\.org\/shortbread_v1\/\{z\}\/\{x\}\/\{y\}\.mvt$/m,
    );
    expect(environmentExample).toMatch(/^MAP_STYLE_URL=$/m);

    for (const file of [environmentExample, compose, dockerfile, continuousIntegration]) {
      expect(file).not.toContain("NEXT_PUBLIC_MAPBOX_TOKEN");
      expect(file).not.toContain("mapbox://");
    }
  });

  it("keeps application updates behind the guarded host command", async () => {
    const [compose, dockerfile, operator, installer, updateStatus, updatePage, updateCommand] =
      await Promise.all([
        readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8"),
        readFile(new URL("../../Dockerfile", import.meta.url), "utf8"),
        readFile(new URL("../../scripts/infill", import.meta.url), "utf8"),
        readFile(new URL("../../scripts/install-mac.sh", import.meta.url), "utf8"),
        readFile(new URL("../../src/services/admin/update-status.ts", import.meta.url), "utf8"),
        readFile(new URL("../../app/(workspace)/admin/updates/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../../components/admin/update-command.tsx", import.meta.url), "utf8"),
      ]);

    expect(compose).toContain("APP_BUILD_SHA: ${APP_BUILD_SHA:-unknown}");
    expect(compose).not.toContain("/var/run/docker.sock");
    expect(dockerfile).toContain('ARG APP_BUILD_SHA="unknown"');
    expect(operator).toContain('APP_BUILD_SHA="$app_build_sha" docker compose build --pull');
    expect(operator).toContain('[ "${#app_build_sha}" -eq 40 ]');
    expect(operator).toContain('""|*[!0-9a-f]*)');
    expect(operator).toContain('checkout_ref" = "refs/heads/main');
    expect(operator).toContain(
      "https://github.com/jdtoppin/edmonton-infill-tracker.git|git@github.com:jdtoppin/edmonton-infill-tracker.git",
    );
    expect(operator).toContain("git fetch --prune --no-tags origin refs/heads/main");
    expect(operator).toContain("git merge --ff-only FETCH_HEAD");
    expect(installer).toContain('APP_BUILD_SHA="$app_build_sha" docker compose up -d --build');
    expect(installer).toContain('[ "${#app_build_sha}" -eq 40 ]');
    expect(updateStatus).toContain('UPDATE_REPOSITORY = "jdtoppin/edmonton-infill-tracker"');
    expect(updateStatus).not.toMatch(/child_process|exec\(|spawn\(/);
    expect(updatePage).toContain("<UpdateCommand />");
    expect(updateCommand).toContain('./scripts/infill update"');
  });

  it("rechecks authorization at every sensitive page data boundary", async () => {
    const workspacePages = await Promise.all(
      [
        "../../app/(workspace)/page.tsx",
        "../../app/(workspace)/projects/page.tsx",
        "../../app/(workspace)/projects/[projectId]/page.tsx",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );
    const adminPages = await Promise.all(
      [
        "../../app/(workspace)/admin/failures/page.tsx",
        "../../app/(workspace)/admin/health/page.tsx",
        "../../app/(workspace)/admin/imports/page.tsx",
        "../../app/(workspace)/admin/updates/page.tsx",
        "../../app/(workspace)/admin/projects/[projectId]/events/[permitEventId]/raw/page.tsx",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

    for (const page of workspacePages) expect(page).toContain("requireUser(");
    for (const page of adminPages) expect(page).toContain("requireAdmin(");
  });

  it("preserves the public HTTPS scheme across the Tailscale loopback proxy", async () => {
    const [caddyfile, compose, installer, operator, environmentExample] = await Promise.all([
      readFile(new URL("../../deploy/Caddyfile.example", import.meta.url), "utf8"),
      readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/install-mac.sh", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/infill", import.meta.url), "utf8"),
      readFile(new URL("../../.env.example", import.meta.url), "utf8"),
    ]);

    expect(caddyfile).toContain("header_up X-Forwarded-Proto {$UPSTREAM_FORWARDED_PROTO:http}");
    expect(compose).toContain("UPSTREAM_FORWARDED_PROTO: ${UPSTREAM_FORWARDED_PROTO:-http}");
    expect(compose).toContain('VINEXT_TRUST_PROXY: "1"');
    expect(installer).toContain("set_env_value UPSTREAM_FORWARDED_PROTO https");
    expect(operator).toContain("UPSTREAM_FORWARDED_PROTO");
    expect(environmentExample).toMatch(/^UPSTREAM_FORWARDED_PROTO=http$/m);
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
      portSelector,
      tailscalePortSelector,
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
      readFile(new URL("../../scripts/select-mac-ports.sh", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/select-tailscale-serve-port.sh", import.meta.url), "utf8"),
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
    expect(installer).toContain('sh "$script_dir/select-mac-ports.sh"');
    expect(installer).toContain('set_env_value HTTP_PORT "$selected_http_port"');
    expect(installer).toContain('set_env_value HTTPS_PORT "$selected_https_port"');
    expect(portSelector).toContain('-iTCP:"$1"');
    expect(portSelector).toContain('-iUDP:"$1"');
    expect(installer).toContain("set_env_value TAILSCALE_SERVE_HTTPS_PORT 443");
    expect(installer).toContain('set_env_value TAILSCALE_SERVE_MANAGED "$tailscale_serve_managed"');
    expect(installer).toContain('""|3600000)');
    expect(installer).toContain("set_env_value SCHEDULER_INTERVAL_MS 86400000");
    expect(installer).toContain("31536000000 (one year)");
    expect(environmentExample).toMatch(/^SCHEDULER_INTERVAL_MS=86400000$/m);
    expect(installer).toContain('sh "$script_dir/select-tailscale-serve-port.sh"');
    expect(installer).toContain('--docker-port-status "$serve_port"');
    expect(installer).toContain('serve --https="$previous_managed_serve_port" --yes off');
    expect(installer).toContain(
      '"$current_serve_status_file" "$dns_name" "$previous_managed_serve_port"',
    );
    expect(installer.indexOf('"$current_serve_status_file" "$dns_name"')).toBeLessThan(
      installer.indexOf('serve --https="$previous_managed_serve_port" --yes off'),
    );
    expect(tailscalePortSelector).toContain("fallback_start_port=9443");
    expect(tailscalePortSelector).toContain("HostConfig.PortBindings");
    expect(tailscalePortSelector).toContain("ps --all --quiet");
    expect(tailscalePortSelector).toContain("docker_port_in_use tcp");
    expect(tailscalePortSelector).toContain('tcp_port_in_use "$1"');
    expect(tailscalePortSelector).toContain('udp_port_in_use "$1"');
    expect(tailscalePortSelector).toContain("following-sibling::*[1][self::dict]");
    expect(installer).toContain("TAILSCALE_BE_CLI=1");
    expect(installer).toContain("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
    expect(installer).toContain("run_tailscale()");
    expect(installer).not.toMatch(/(^|\n)tailscale\(\) \{/);
    expect(installer).toContain("run_tailscale status --json");
    expect(installer).toContain('serve --https="$serve_port" --bg --yes');
    expect(installer).not.toContain("serve reset");
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
    expect(operator).toContain('require_local_ports_available "start services"');
    expect(operator).toContain('require_local_ports_available "restart services"');
    expect(operator).toContain('require_local_ports_available "update"');
    expect(operator).toContain("enabled_funnel_count");
    expect(operator).toContain('operator_lock_dir="$repo_dir/backups/.operator-lock"');
    expect(operator).toContain("validate_civil_date FROM");
    expect(operator).toContain("docker compose stop caddy web worker scheduler");
    expect(operator).not.toContain("git pull --ff-only");
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
    expect(dockerIgnore).toMatch(/^playwright\/\.auth$/m);
    expect(continuousIntegration).toContain("playwright/.auth/*");
    expect(continuousIntegration).toContain("docker build");
    expect(continuousIntegration).toContain("--target runtime");
    expect(continuousIntegration).toContain("Mac installer safety");
    expect(continuousIntegration).toContain("runs-on: macos-15");
  });
});
