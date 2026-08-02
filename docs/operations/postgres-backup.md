# PostgreSQL backup and restore

The PostgreSQL named volume is durable across container recreation, but it is not a backup. Use logical `pg_dump` backups so data can be restored into a clean compatible PostgreSQL/PostGIS instance.

The database contains user accounts, saved searches, and alert history in addition to public permit records. Treat every backup as sensitive and encrypt off-host copies.

## Create and verify a backup

Run the bundled helper from the repository root:

```sh
sh scripts/backup-postgres.sh
```

It writes a private, timestamped custom-format dump under `./backups`, verifies that `pg_restore` can read its catalogue, and only then publishes the final filename. Override the destination when needed:

```sh
BACKUP_DIR=/Volumes/EncryptedBackups/infill sh scripts/backup-postgres.sh
```

The external volume should be encrypted and mounted before the job starts. The helper refuses an empty or root destination, creates the directory with mode `0700`, and creates files with a private umask.

List a backup catalogue without restoring it:

```sh
docker compose exec -T db pg_restore --list < backups/edmonton-infill-YYYYMMDDTHHMMSSZ.dump
```

A readable catalogue is necessary but not sufficient. At least quarterly, restore the newest backup into a disposable environment and verify row counts, login, a project timeline, and PostGIS queries.

## Suggested schedule and retention

- Create one backup daily after imports have completed.
- Keep at least 14 daily, 8 weekly, and 12 monthly recovery points if disk capacity permits.
- Copy backups to a second encrypted device or encrypted remote destination.
- Monitor the backup command's exit status and file size; a zero-byte or unexpectedly small file is an incident.

On macOS, schedule the helper with a user LaunchAgent or another local scheduler that runs only after Docker Desktop is available. Use an absolute repository path as its working directory and send standard output/error to files that are reviewed. Do not put database passwords in the scheduler definition; Compose reads the protected `.env` file from the repository directory.

## Restore after data loss

Restore replaces the current database. Confirm the exact backup filename, take one last backup when possible, and stop every service that can write data:

```sh
docker compose stop caddy web worker scheduler
```

Recreate the application database. This is destructive to the current database contents:

```sh
docker compose exec -T db sh -ec 'dropdb --if-exists --force --username="$POSTGRES_USER" --maintenance-db=postgres "$POSTGRES_DB" && createdb --username="$POSTGRES_USER" --maintenance-db=postgres "$POSTGRES_DB"'
```

Restore the selected custom-format dump:

```sh
docker compose exec -T db sh -ec 'exec pg_restore --exit-on-error --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' < backups/edmonton-infill-YYYYMMDDTHHMMSSZ.dump
```

Apply any migrations from the checked-out application version, then restart and verify:

```sh
docker compose run --rm migrate
docker compose up -d web worker scheduler caddy
docker compose ps
curl --fail http://127.0.0.1/api/health
```

Review recent logs and validate representative records before reopening public access.

## PostgreSQL major upgrades

Do not change the database container from PostgreSQL 17 to a later major version in place. Create a verified logical backup, start a new empty volume with the new major version, restore, run migrations, validate PostGIS and application behavior, and retain the old volume until acceptance is complete.
