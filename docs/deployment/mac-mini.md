# Mac mini deployment

This is the supported MVP production path. It keeps PostgreSQL on a private Docker network, applies Prisma migrations before application processes start, and exposes only Caddy on the Mac mini.

## Service layout

| Service     | Responsibility                                                   | Host exposure                 |
| ----------- | ---------------------------------------------------------------- | ----------------------------- |
| `caddy`     | LAN HTTP and optional public HTTPS reverse proxy                 | TCP 80 and TCP/UDP 443        |
| `web`       | Next.js application and health endpoint                          | Docker networks only          |
| `worker`    | Import, matching, reclassification, alert, and data-quality work | Docker networks only          |
| `scheduler` | Enqueues recurring jobs                                          | Docker networks only          |
| `migrate`   | Applies pending Prisma migrations and exits                      | Docker networks only          |
| `db`        | PostgreSQL 17 with PostGIS                                       | Private database network only |

The application services can reach the internet for Edmonton Open Data and alert delivery. Only application services can reach the database network. There is deliberately no PostgreSQL `ports` entry in `docker-compose.yml`.

## 1. Prepare the Mac

1. Install current macOS updates and create a dedicated, non-administrator account to operate the tracker when practical.
2. Install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) and start it once. Confirm the Docker Desktop licence is appropriate for the person or organization operating the server.
3. In Docker Desktop settings, enable **Start Docker Desktop when you sign in**. Allocate at least 4 CPU cores, 8 GB of memory, and enough disk for database growth and retained images; 60 GB is a sensible initial floor.
4. In macOS Energy settings, prevent automatic sleep while the display is off. A sleeping Mac cannot import data, send alerts, or serve the site.
5. Install Git, either with the Xcode command-line tools or Homebrew.

Do not forward port 5432 on the router or add a database port mapping. If the site remains LAN-only, no router port forwarding is needed.

## 2. Clone and configure

Replace the placeholder with the repository's HTTPS or SSH clone URL:

```sh
git clone <repository-url> edmonton-infill-tracker
cd edmonton-infill-tracker
cp .env.example .env
chmod 600 .env
```

Edit `.env` and complete every value marked required. At minimum, review:

- `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`
- `AUTH_REQUIRED`, the application URL, initial administrator email, and strong seed passwords
- Edmonton Open Data base URL, dataset identifiers, optional Socrata application token, page size, and rate limit
- Mapbox public token and alert-provider credentials
- `SITE_ADDRESS` if a public domain will be used

Generate a URL-safe database password. Hex output avoids breaking the database URL assembled by Compose:

```sh
openssl rand -hex 32
```

Never commit `.env`. Keep a secure copy of the production values in a password manager.

For LAN-only use, leave `SITE_ADDRESS=:80`. The site will be available at `http://<mac-mini-lan-address>/`. Give the Mac mini a DHCP reservation so its LAN address remains stable.

## 3. Build and start

From the repository directory:

```sh
docker compose up -d --build
docker compose ps
```

The first command builds a native image for the Mac's CPU, initializes PostgreSQL and PostGIS, runs `prisma:migrate:deploy`, then starts the web, worker, scheduler, and Caddy services. No separate database configuration is required.

Wait until `db` and `web` show as healthy. Then check the service through Caddy:

```sh
curl --fail http://127.0.0.1/api/health
```

If startup fails, inspect the migration and application logs:

```sh
docker compose logs migrate
docker compose logs --tail=200 db web worker scheduler caddy
```

Do not run the development seed in production unless synthetic sample projects and the seed accounts are wanted. For a fresh local demonstration, run:

```sh
docker compose run --rm web npm run prisma:seed
```

Change any seeded placeholder passwords immediately.

## Routine commands

Apply migrations explicitly:

```sh
docker compose run --rm migrate
```

Start a historical import. The exact date flags are implemented by the `import:backfill` command:

```sh
docker compose run --rm worker npm run import:backfill -- --from 2020-01-01 --to 2026-07-31
```

Follow all logs or only one service:

```sh
docker compose logs --follow --tail=200
docker compose logs --follow worker
```

Restart one service without touching the database:

```sh
docker compose restart web
docker compose restart worker
docker compose restart scheduler
docker compose restart caddy
```

Inspect status and resource use:

```sh
docker compose ps
docker stats
```

Stop the application while preserving all volumes:

```sh
docker compose stop
```

Start it again:

```sh
docker compose start
```

Avoid `docker compose down --volumes`: it deletes the named PostgreSQL volume.

## Safe manual update

There is intentionally no GitHub-to-Mac automatic deployment in the MVP.

1. Read the release notes and confirm CI passed for the target commit.
2. Create and verify a database backup as described in [PostgreSQL backup and restore](../operations/postgres-backup.md).
3. Confirm the worktree is clean. Do not overwrite local edits.
4. Fetch and fast-forward, rebuild, apply migrations, and recreate services:

```sh
git status --short
git fetch --prune
git pull --ff-only
docker compose build --pull
docker compose pull caddy
docker compose run --rm migrate
docker compose up -d --remove-orphans
docker compose ps
curl --fail http://127.0.0.1/api/health
```

5. Review `docker compose logs --since=10m` and exercise login plus one project view.

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
