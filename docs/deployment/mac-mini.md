# Mac mini deployment

This is the supported MVP production path. It keeps PostgreSQL on a private Docker network, applies Prisma migrations before application processes start, and keeps Caddy on loopback. Tailscale Serve publishes that loopback service only to the owner's tailnet.

## Service layout

| Service     | Responsibility                                                   | Host exposure                 |
| ----------- | ---------------------------------------------------------------- | ----------------------------- |
| `caddy`     | Loopback HTTP target for Tailscale Serve                         | `127.0.0.1` only              |
| `web`       | Next.js application and health endpoint                          | Docker networks only          |
| `worker`    | Import, matching, reclassification, alert, and data-quality work | Docker networks only          |
| `scheduler` | Enqueues recurring jobs                                          | Docker networks only          |
| `migrate`   | Applies pending Prisma migrations and exits                      | Docker networks only          |
| `db`        | PostgreSQL 17 with PostGIS                                       | Private database network only |

The application services can reach the internet for Edmonton Open Data and alert delivery. Only application services can reach the database network. There is deliberately no PostgreSQL `ports` entry in `docker-compose.yml`. The checked-in `VINEXT_TRUST_PROXY=1` setting is a non-secret description of this topology: it lets the web runtime preserve Caddy's HTTPS scheme for redirects. The `web` service remains Docker-only, Caddy replaces `X-Forwarded-Proto`, and forwarded hostnames are not trusted.

Permit jobs use a database-enforced conflict key plus a renewable worker lease. If the worker is killed, the next worker reclaims the expired job and closes its interrupted import run before retrying; a queued backfill cannot overlap a scheduled import. The scheduler records its daily cadence in `JobRun`, so restarting its container does not enqueue another import before the persisted deadline.

## 1. Prepare the Mac

1. Install current macOS updates and create a dedicated, non-administrator account to operate the tracker when practical.
2. Install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) and start it once. Confirm the Docker Desktop licence is appropriate for the person or organization operating the server.
3. In Docker Desktop settings, enable **Start Docker Desktop when you sign in**. Allocate at least 4 CPU cores, 8 GB of memory, and enough disk for database growth and retained images; 60 GB is a sensible initial floor.
4. In macOS Energy settings, prevent automatic sleep while the display is off. A sleeping Mac cannot import data, send alerts, or serve the site.
5. Install Git, either with the Xcode command-line tools or Homebrew.
6. Install [Tailscale for macOS](https://tailscale.com/download/mac), sign in to the intended tailnet, and enable MagicDNS and HTTPS certificates. The installer detects both `/usr/local/bin/tailscale` and the App Store application's bundled CLI.

Do not forward any router ports and do not add a database port mapping. Tailscale Serve makes the app available only inside the tailnet and applies the tailnet access policy.

## 2. Clone and run the guided installer

```sh
git clone https://github.com/jdtoppin/edmonton-infill-tracker.git
cd edmonton-infill-tracker
./scripts/infill install
```

The installer performs these steps and stops with an actionable message rather than weakening a security check:

- verifies macOS, Docker Desktop/Compose, and a signed-in Tailscale CLI;
- derives the exact tailnet DNS name before writing `APP_URL`;
- checks the existing Tailscale configuration and refuses to continue if Funnel is enabled;
- creates `.env` with mode `0600` only when it is absent, using a generated 64-character database password;
- prompts invisibly for the initial administrator password, passes it only to the one-time bootstrap container, and never prints or stores it;
- checks both TCP and UDP listeners, starts with `127.0.0.1:8080` and `127.0.0.1:8443`, and automatically selects the next free loopback ports when another local app already uses either one;
- builds the stack, applies migrations, and creates or promotes only the configured administrator;
- inspects existing Tailscale Serve routes, saved Docker bindings (including stopped containers), and host TCP/UDP listeners; it keeps unrelated routes unchanged and publishes the tracker on HTTPS `443` when free or the first genuinely unused dedicated port starting at `9443`;
- tells the application that Tailscale terminated HTTPS before the private loopback hop, so sign-in redirects never downgrade to plain HTTP;
- verifies the exact private proxy route and confirms Funnel remains off.

The administrator bootstrap is idempotent. Rerunning the installer promotes/reactivates the same normalized email without replacing its password. If a first install was interrupted after `.env` was saved but before the administrator was created, the rerun detects the missing account and asks for the password again; that recovery password remains ephemeral. `./scripts/infill bootstrap-admin` prompts for a new hidden password and deliberately creates, promotes, or resets that administrator without storing the password in `.env`.

When `.env` already exists, the installer preserves its secrets and account settings and changes its file permissions to `0600`. It changes only the local-port or Tailscale URL settings needed to avoid an unavailable port, plus a missing scheduler interval or the exact legacy shipped hourly value (`3600000`), which becomes the daily default (`86400000`). Other custom intervals from one hour through one year are preserved; unsafe values are rejected. It validates `HOST_BIND_ADDRESS=127.0.0.1`, `SITE_ADDRESS=:80`, `AUTH_REQUIRED=true`, the Tailscale-derived `APP_URL`, and a non-placeholder database password before touching containers. Existing Docker containers, named volumes, and unrelated Tailscale routes are preserved. A second Caddy container is safe as long as its host ports differ; the installer selects those ports without stopping or changing the other stack.

For the release that changes the shipped cadence from hourly to daily, run `./scripts/infill backup`, update the checkout with `git pull --ff-only`, and then run `./scripts/infill install` once instead of the older `update` command. That preserves the normal backup-first safeguard, loads the new installer, migrates only the exact legacy default, and rebuilds the stack without removing named volumes.

Never commit `.env`. Keep the administrator password in a password manager. Do not enable Tailscale Funnel: Funnel is public internet exposure, while Serve remains restricted by tailnet grants.

## 3. Verify and operate

The installer prints the private `https://...ts.net` URL after local health, administrator bootstrap, Serve, and Funnel checks pass. Verify it at any time:

```sh
./scripts/infill status
```

The production installer never runs `prisma:seed`; that command creates synthetic permits, projects, and a standard user. Use it only in a disposable development environment.

The operator command intentionally exposes a small set of guarded routines. `start`, `restart`, and `update` fail closed unless the Tailscale CLI confirms every background and foreground Funnel configuration is off; an unrecognized Funnel response is also rejected. They also verify that a stopped tracker can reclaim its configured local ports and direct the operator back to the guided installer if another app took one. `stop` remains available even when those checks cannot run. `update` creates a verified database backup, refuses a dirty Git checkout, fast-forwards, rebuilds, stops application-facing services, migrates while PostgreSQL stays running, restarts, and checks health. `import` validates real calendar dates, their order, and the dataset argument before queuing the existing worker job.

```sh
./scripts/infill start
./scripts/infill stop
./scripts/infill restart
./scripts/infill logs
./scripts/infill logs worker
./scripts/infill backup
./scripts/infill update
./scripts/infill import 2020-01-01 2026-07-31 all
./scripts/infill bootstrap-admin
```

`stop` preserves every named volume. All commands refuse to operate if `.env` no longer binds to `127.0.0.1` or if Caddy is no longer configured for loopback HTTP behind Tailscale. Start, restart, update, import, backup, and administrator bootstrap share an atomic operator lock. This prevents a second shell from starting or writing through application code during an update migration, while `stop` stays unlocked for containment. If the Mac loses power and leaves `backups/.operator-lock` behind, first confirm no guarded operator command is running, then remove the lock's `pid` file and the empty lock directory before retrying.

## Routine commands

For a planned release, use `./scripts/infill update`. During manual recovery, stop the application-facing services before applying a migration explicitly:

```sh
docker compose stop caddy web worker scheduler
docker compose run --rm migrate
```

Queue a historical import:

```sh
./scripts/infill import 2020-01-01 2026-07-31 all
```

The running worker processes it. Replace `all` with `development` or `building` to limit a backfill.

Follow all logs or only one service:

```sh
docker compose logs --follow --tail=200
docker compose logs --follow worker
```

Restart the application services without touching the database:

```sh
./scripts/infill restart
```

Inspect status and resource use:

```sh
docker compose ps
docker stats
```

Stop the application while preserving all volumes:

```sh
./scripts/infill stop
```

Start it again:

```sh
./scripts/infill start
```

Avoid `docker compose down --volumes`: it deletes the named PostgreSQL volume.

## Safe manual update

There is intentionally no GitHub-to-Mac automatic deployment in the MVP.

Node.js, npm, npm's bundled `brace-expansion` security override, Caddy, Caddy's Go toolchain and
security-patched Go dependencies, and PostgreSQL pins are checked weekly by the `Support component
updates` workflow. It considers stable same-major releases only, updates every coordinated
deployment pin together, audits the npm lockfile, pushes an isolated `codex/` proposal branch, and
dispatches the complete CI workflow. A pull request is opened only after that run passes; it is never
merged or deployed automatically. npm package minor/patch updates, GitHub Actions, and Caddy's
remaining transitive Go dependencies are proposed separately by Dependabot, while major releases
remain deliberate review work.

The regular CI workflow also runs weekly even when source code has not changed. It fails on high or
critical npm advisories and on fixed high or critical vulnerabilities found in the built application,
custom PostGIS, or source-pinned Caddy images. The Caddy image is rebuilt from the tagged standard
module set with reviewed Go dependency overrides instead of inheriting a stale release binary. Its
complete module graph and checksums are committed; the build verifies that graph and compiles in
read-only module mode. Its minimal runtime receives current Alpine security packages at build time.
The scanner action is commit-pinned and does not receive a
third-party credential. GitHub Actions must be permitted to create pull requests for the proposal
step; if repository policy disables that permission, the workflow leaves its tested proposal branch
and fails visibly instead of bypassing the policy.

The PostGIS scan has a separate, path-scoped, expiring exception file for audited Go
standard-library reports against the upstream `gosu` privilege-drop binary. This follows `gosu`'s
published reachability policy; it does not hide any new finding or any finding in PostgreSQL,
PostGIS, Debian, the application image, or Caddy. The weekly CI run fails when the exception expires
so it must be reviewed again.

Administrators can open **Administration → Application updates** to compare the compiled commit
with the fixed public `jdtoppin/edmonton-infill-tracker` main branch and copy the command below. The
page does not receive a GitHub credential and cannot run a command, select another repository/ref,
access Docker, or write to the checkout. This keeps host control outside a browser-accessible
container while still making update availability visible in the product. Builds created by the
guided installer or update command carry only their non-secret Git commit SHA for this comparison.

After reading the release notes and confirming CI passed, update with one command:

```sh
./scripts/infill update
```

It first confirms Funnel is off, refuses a dirty checkout, creates and verifies a backup, fast-forwards only, and rebuilds while the current app remains available. It then stops `caddy`, `web`, `worker`, and `scheduler`, leaves PostgreSQL running, applies migrations, confirms Funnel is still off, recreates services without deleting volumes, and checks local/Tailscale health. Review `./scripts/infill logs` afterward and exercise login plus one project view.

Because reviewed support-component pins live in the repository, the same update command rebuilds the
application, custom PostGIS image, and source-pinned Caddy image with the tested
Node.js/npm/PostgreSQL/Caddy releases, replaces npm's bundled `brace-expansion` with the reviewed
fixed version, and compiles Caddy with the reviewed Go security dependency pins. It does not discover
or install an unreviewed runtime version on the Mac mini.

If migration fails, the update exits with PostgreSQL running and all application-facing services stopped. Do not manually start the previous application against a possibly changed schema. Review the migration output and database logs, correct the cause, and rerun `./scripts/infill update`. To roll back instead, restore the verified pre-update backup before checking out, rebuilding, and starting the previous known-good version. A Funnel verification failure after migration also leaves application-facing services stopped; disable Funnel or restore Tailscale status access, then use `./scripts/infill start`.

Database migrations are forward-only. If an update changes the schema and must be rolled back, stop application processes, restore the pre-update database backup, check out the previous known-good commit, rebuild, and start it. Do not point older application code at a newly migrated database without confirming schema compatibility.

## Development containers

The development stack has a distinct project name and volumes, so it cannot accidentally reuse production data. It publishes PostgreSQL and the app to loopback only:

```sh
docker compose -f docker-compose.dev.yml up --build
```

Use `docker compose -f docker-compose.dev.yml down` to stop it. Do not combine the production and development Compose files with multiple `-f` arguments; the development file is a complete stack, not a merge overlay.

## Operational checklist

- Keep macOS, Docker Desktop, container images, and npm dependencies patched.
- Keep Docker Desktop running and the Mac awake; verify scheduled jobs after a reboot.
- Back up daily and test a restore at least quarterly.
- Copy encrypted backups off the Mac mini; a local disk failure otherwise removes the app and its backups together.
- Monitor disk usage and capped container logs.
- Review failed imports, job history, and data-quality warnings regularly.
- Never expose PostgreSQL, the Docker socket, or admin/import routes directly to the internet.
