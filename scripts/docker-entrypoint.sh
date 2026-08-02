#!/bin/sh
set -eu

umask 027

role="${1:-web}"
if [ "$#" -gt 0 ]; then
  shift
fi

run_script() {
  script_name="$1"
  shift
  exec npm run "$script_name" -- "$@"
}

case "$role" in
  web)
    run_script "${WEB_SCRIPT:-start}" "$@"
    ;;
  worker)
    run_script "${WORKER_SCRIPT:-jobs:worker}" "$@"
    ;;
  scheduler)
    run_script "${SCHEDULER_SCRIPT:-jobs:scheduler}" "$@"
    ;;
  migrate)
    run_script "${MIGRATION_SCRIPT:-prisma:migrate:deploy}" "$@"
    ;;
  *)
    exec "$role" "$@"
    ;;
esac

