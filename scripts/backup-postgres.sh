#!/bin/sh
set -eu

umask 077

compose_file="${COMPOSE_FILE:-docker-compose.yml}"
backup_dir="${BACKUP_DIR:-./backups}"

case "$backup_dir" in
  ""|/)
    printf '%s\n' "Refusing to use an empty or root backup directory." >&2
    exit 1
    ;;
esac

mkdir -p "$backup_dir"
chmod 0700 "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$backup_dir/edmonton-infill-$timestamp-$$.dump"
partial_path="$backup_path.partial"

cleanup() {
  rm -f "$partial_path"
}
trap cleanup EXIT HUP INT TERM

docker compose -f "$compose_file" exec -T db sh -ec \
  'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --compress=6' \
  >"$partial_path"

docker compose -f "$compose_file" exec -T db pg_restore --list \
  <"$partial_path" >/dev/null

mv "$partial_path" "$backup_path"
trap - EXIT HUP INT TERM

printf 'Backup written and verified: %s\n' "$backup_path"
