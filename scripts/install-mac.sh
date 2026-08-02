#!/bin/sh
set -eu

umask 077

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_dir=$(CDPATH= cd -P "$script_dir/.." && pwd)
env_file="$repo_dir/.env"
temporary_files=""
terminal_echo_off=0
new_install=0

cleanup() {
  if [ "$terminal_echo_off" -eq 1 ]; then
    stty echo 2>/dev/null || true
  fi
  if [ -n "$temporary_files" ]; then
    saved_ifs=$IFS
    IFS='
'
    for temporary_file in $temporary_files; do
      rm -f "$temporary_file"
    done
    IFS=$saved_ifs
  fi
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'Install stopped: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required. $2"
}

new_temporary_file() {
  temporary_file=$(mktemp "${TMPDIR:-/tmp}/edmonton-infill.XXXXXX") || exit 1
  remember_temporary_file "$temporary_file"
}

remember_temporary_file() {
  if [ -z "$temporary_files" ]; then
    temporary_files=$1
  else
    temporary_files="$temporary_files
$1"
  fi
}

run_tailscale() {
  TAILSCALE_BE_CLI=1 "$tailscale_bin" "$@"
}

env_value() {
  key=$1
  awk -v prefix="$key=" '
    index($0, prefix) == 1 { value = substr($0, length(prefix) + 1); found = 1 }
    END { if (found) print value }
  ' "$env_file"
}

set_env_value() {
  key=$1
  value=$2
  new_temporary_file
  env_temporary_file=$temporary_file
  awk -v prefix="$key=" -v replacement="$key=$value" '
    index($0, prefix) == 1 {
      if (!replaced) print replacement
      replaced = 1
      next
    }
    { print }
    END { if (!replaced) print replacement }
  ' "$env_file" >"$env_temporary_file"
  chmod 0600 "$env_temporary_file"
  mv "$env_temporary_file" "$env_file"
}

validate_port() {
  port_name=$1
  port_value=$2
  case "$port_value" in
    ""|*[!0-9]*) die "$port_name must be a numeric TCP port in .env." ;;
  esac
  [ "$port_value" -ge 1 ] && [ "$port_value" -le 65535 ] ||
    die "$port_name must be between 1 and 65535."
}

select_available_local_ports() {
  running_caddy_id=$(docker compose ps --status running --quiet caddy 2>/dev/null || true)
  if [ -n "$running_caddy_id" ]; then
    say "Keeping local ports $http_port and $https_port; this install's Caddy is already running on them."
    return
  fi

  selected_ports=$(sh "$script_dir/select-mac-ports.sh" "$http_port" "$https_port") ||
    die "no free loopback port pair was found near $http_port and $https_port. Stop the conflicting service or set free HTTP_PORT and HTTPS_PORT values in .env, then rerun."
  selected_http_port=${selected_ports%% *}
  selected_https_port=${selected_ports#* }
  validate_port HTTP_PORT "$selected_http_port"
  validate_port HTTPS_PORT "$selected_https_port"
  [ "$selected_http_port" != "$selected_https_port" ] ||
    die "the automatic port check returned the same HTTP and HTTPS port."

  if [ "$selected_http_port" != "$http_port" ]; then
    say "Local HTTP port $http_port is already in use; using $selected_http_port for this app."
    set_env_value HTTP_PORT "$selected_http_port"
    http_port=$selected_http_port
  fi
  if [ "$selected_https_port" != "$https_port" ]; then
    say "Local HTTPS port $https_port is already in use; using $selected_https_port for this app."
    set_env_value HTTPS_PORT "$selected_https_port"
    https_port=$selected_https_port
  fi
}

assert_no_funnel() {
  serve_status_file=$1
  /usr/bin/plutil -convert json -o /dev/null -- "$serve_status_file" >/dev/null 2>&1 ||
    die "Tailscale returned an unreadable Funnel status; update Tailscale before continuing."
  new_temporary_file
  funnel_plist_file=$temporary_file
  /usr/bin/plutil -convert xml1 -o "$funnel_plist_file" -- \
    "$serve_status_file" >/dev/null 2>&1 ||
    die "Tailscale Funnel status could not be inspected safely."
  invalid_funnel_count=$(/usr/bin/xmllint --nonet --xpath \
    'count(//key[text()="AllowFunnel"][not(following-sibling::*[1][self::dict])]) + count(//key[text()="AllowFunnel"]/following-sibling::*[1][self::dict]/*[not(self::key or self::true or self::false)])' \
    "$funnel_plist_file" 2>/dev/null) ||
    die "Tailscale Funnel status could not be inspected safely."
  [ "$invalid_funnel_count" = "0" ] ||
    die "Tailscale returned an unrecognized Funnel status; update Tailscale before continuing."
  enabled_funnel_count=$(/usr/bin/xmllint --nonet --xpath \
    'count(//key[text()="AllowFunnel"]/following-sibling::*[1][self::dict]/true)' \
    "$funnel_plist_file" 2>/dev/null) ||
    die "Tailscale Funnel status could not be inspected safely."
  [ "$enabled_funnel_count" = "0" ] ||
    die "Tailscale Funnel is enabled on this Mac. Review it with 'tailscale funnel status' and disable it before installing; this installer never changes Funnel configuration."
}

app_url_for_serve_port() {
  if [ "$1" -eq 443 ]; then
    printf 'https://%s\n' "$dns_name"
  else
    printf 'https://%s:%s\n' "$dns_name" "$1"
  fi
}

select_tailscale_serve_port() {
  serve_status_file=$1
  original_serve_target="http://127.0.0.1:$original_http_port"
  managed_serve_route_matches=false
  if [ "$tailscale_serve_managed" = "true" ] &&
    sh "$script_dir/select-tailscale-serve-port.sh" --verify-route \
      "$serve_status_file" "$dns_name" "$serve_port" "$original_serve_target" \
      >/dev/null 2>&1; then
    managed_serve_route_matches=true
  fi

  managed_port_docker_status=free
  if [ "$managed_serve_route_matches" = "true" ]; then
    managed_port_docker_status=$(sh "$script_dir/select-tailscale-serve-port.sh" \
      --docker-port-status "$serve_port") ||
      die "Docker's published ports could not be checked before reusing the tracker's Tailscale route."
    case "$managed_port_docker_status" in
      free|in-use) ;;
      *) die "Docker returned an unrecognized port-availability result." ;;
    esac
  fi

  if [ "$managed_serve_route_matches" = "true" ] &&
    [ "$managed_port_docker_status" = "free" ]; then
    selected_serve_port=$serve_port
  else
    selected_serve_port=$(sh "$script_dir/select-tailscale-serve-port.sh" \
      "$serve_status_file" "$dns_name" "$serve_port") ||
      die "a safe Tailscale Serve HTTPS port could not be selected without changing another route."
  fi

  if [ "$selected_serve_port" != "$serve_port" ]; then
    if [ "$managed_serve_route_matches" = "true" ]; then
      previous_managed_serve_port=$serve_port
      say "Moving the tracker's verified Tailscale route from HTTPS port $previous_managed_serve_port to $selected_serve_port because another Docker service publishes the old port."

      new_temporary_file
      current_serve_status_file=$temporary_file
      run_tailscale serve status --json >"$current_serve_status_file" 2>/dev/null ||
        die "Tailscale Serve state could not be rechecked before moving the tracker's route."
      sh "$script_dir/select-tailscale-serve-port.sh" --verify-route \
        "$current_serve_status_file" "$dns_name" "$previous_managed_serve_port" \
        "$original_serve_target" >/dev/null 2>&1 ||
        die "the existing Tailscale route changed during installation, so it was left untouched. Rerun the installer to inspect it again."
      run_tailscale serve --https="$previous_managed_serve_port" --yes off ||
        die "the tracker's previous Tailscale route could not be removed safely. No unrelated route was changed."
      new_temporary_file
      removed_serve_status_file=$temporary_file
      run_tailscale serve status --json >"$removed_serve_status_file" 2>/dev/null ||
        die "Tailscale Serve state could not be verified after moving the tracker's previous route."
      if sh "$script_dir/select-tailscale-serve-port.sh" --verify-route \
        "$removed_serve_status_file" "$dns_name" "$previous_managed_serve_port" \
        "$original_serve_target" >/dev/null 2>&1; then
        die "the tracker's previous Tailscale route is still active; stop and inspect 'tailscale serve status' before rerunning."
      fi
    else
      say "HTTPS port $serve_port is unavailable or is not an exclusively tracker-managed Tailscale route; leaving existing services unchanged and using $selected_serve_port for this app."
    fi
    serve_port=$selected_serve_port
    tailscale_serve_managed=false
  fi

  app_url=$(app_url_for_serve_port "$serve_port")
  set_env_value TAILSCALE_SERVE_HTTPS_PORT "$serve_port"
  set_env_value TAILSCALE_SERVE_MANAGED "$tailscale_serve_managed"
  set_env_value APP_URL "$app_url"
}

read_secret() {
  prompt=$1
  printf '%s' "$prompt"
  terminal_echo_off=1
  stty -echo
  IFS= read -r secret_reply
  stty echo
  terminal_echo_off=0
  printf '\n'
}

prompt_admin_password() {
  while :; do
    read_secret "Administrator password (16+ characters, 72-byte maximum; input is hidden): "
    admin_password=$secret_reply
    password_bytes=$(LC_ALL=C printf '%s' "$admin_password" | wc -c | awk '{ print $1 }')
    if [ "${#admin_password}" -lt 16 ] || [ "$password_bytes" -gt 72 ]; then
      say "The password must contain at least 16 characters and no more than 72 UTF-8 bytes."
      continue
    fi
    read_secret "Confirm administrator password: "
    [ "$admin_password" = "$secret_reply" ] && break
    say "The passwords did not match."
  done
  unset secret_reply password_bytes
}

configure_new_env() {
  new_install=1
  say "Creating a protected production .env from .env.example."
  final_env_file=$env_file
  candidate_env_file=$(mktemp "$repo_dir/.env.install.XXXXXX") || exit 1
  remember_temporary_file "$candidate_env_file"
  cp "$repo_dir/.env.example" "$candidate_env_file"
  env_file=$candidate_env_file
  chmod 0600 "$env_file"

  while :; do
    printf 'Administrator email: '
    IFS= read -r admin_email
    case "$admin_email" in
      ""|*[!A-Za-z0-9._%+@-]*|*@*@*|@*|*@)
        say "Use a conventional email address containing only letters, numbers, . _ % + - and one @."
        ;;
      *@*.*) break ;;
      *) say "Enter a complete email address." ;;
    esac
  done

  prompt_admin_password

  database_password=$(openssl rand -hex 32)
  set_env_value APP_URL "$app_url"
  set_env_value AUTH_REQUIRED true
  set_env_value NODE_ENV production
  set_env_value POSTGRES_PASSWORD "$database_password"
  set_env_value DATABASE_URL \
    "postgresql://infill:$database_password@localhost:5432/infill?schema=public"
  set_env_value INITIAL_ADMIN_EMAIL "$admin_email"
  set_env_value INITIAL_ADMIN_PASSWORD ""
  set_env_value RESET_INITIAL_ADMIN_PASSWORD false
  set_env_value HOST_BIND_ADDRESS 127.0.0.1
  set_env_value HTTP_PORT 8080
  set_env_value HTTPS_PORT 8443
  set_env_value SITE_ADDRESS :80
  set_env_value UPSTREAM_FORWARDED_PROTO https
  set_env_value TAILSCALE_SERVE_HTTPS_PORT 443
  set_env_value TAILSCALE_SERVE_MANAGED false

  unset database_password
  mv "$env_file" "$final_env_file"
  env_file=$final_env_file
}

validate_existing_env() {
  say "Keeping the existing .env secrets and account settings. Only private hosting settings and the legacy shipped scheduler interval may be adjusted."
  chmod 0600 "$env_file"

  scheduler_interval=$(env_value SCHEDULER_INTERVAL_MS)
  case "$scheduler_interval" in
    ""|3600000)
      say "Setting the scheduler to the restart-safe daily default."
      set_env_value SCHEDULER_INTERVAL_MS 86400000
      ;;
    *[!0-9]*)
      die "existing SCHEDULER_INTERVAL_MS must be a whole number of milliseconds."
      ;;
    *)
      [ "$scheduler_interval" -ge 3600000 ] && [ "$scheduler_interval" -le 31536000000 ] ||
        die "existing SCHEDULER_INTERVAL_MS must be between 3600000 (one hour) and 31536000000 (one year)."
      ;;
  esac

  [ "$(env_value HOST_BIND_ADDRESS)" = "127.0.0.1" ] ||
    die "existing .env must set HOST_BIND_ADDRESS=127.0.0.1. The installer will not overwrite it."
  [ "$(env_value SITE_ADDRESS)" = ":80" ] ||
    die "existing .env must set SITE_ADDRESS=:80 for Tailscale TLS termination."
  if [ -z "$(env_value UPSTREAM_FORWARDED_PROTO)" ]; then
    say "Adding the HTTPS forwarding scheme required behind Tailscale Serve."
    set_env_value UPSTREAM_FORWARDED_PROTO https
  fi
  [ "$(env_value UPSTREAM_FORWARDED_PROTO)" = "https" ] ||
    die "existing .env must set UPSTREAM_FORWARDED_PROTO=https behind Tailscale Serve."
  [ "$(env_value AUTH_REQUIRED)" = "true" ] ||
    die "existing .env must set AUTH_REQUIRED=true."
  postgres_password=$(env_value POSTGRES_PASSWORD)
  [ "${#postgres_password}" -ge 24 ] ||
    die "existing POSTGRES_PASSWORD is missing or shorter than 24 characters. Rotate it deliberately before continuing."
  case "$postgres_password" in
    replace-*) die "existing POSTGRES_PASSWORD is still a placeholder." ;;
  esac

  admin_email=$(env_value INITIAL_ADMIN_EMAIL)
  [ -n "$admin_email" ] || die "existing .env must set INITIAL_ADMIN_EMAIL."
  case "$admin_email" in
    admin@example.com|admin@example.test) die "INITIAL_ADMIN_EMAIL is still a placeholder." ;;
  esac
  [ -z "$(env_value INITIAL_ADMIN_PASSWORD)" ] ||
    die "clear INITIAL_ADMIN_PASSWORD after bootstrapping; administrator passwords are not retained in .env."
  [ "$(env_value RESET_INITIAL_ADMIN_PASSWORD)" = "false" ] ||
    die "existing .env must set RESET_INITIAL_ADMIN_PASSWORD=false."
}

[ "$(uname -s)" = "Darwin" ] || die "this guided installer supports macOS only."
[ -t 0 ] || die "run this guided installer from an interactive Terminal session."
[ -f "$repo_dir/docker-compose.yml" ] || die "docker-compose.yml is missing from the repository root."

require_command awk "Install the macOS command-line tools."
require_command curl "Install the macOS command-line tools."
require_command docker "Install and start Docker Desktop, then enable its CLI tools."
require_command grep "Install the macOS command-line tools."
require_command lsof "Install the macOS command-line tools."
require_command mktemp "Install the macOS command-line tools."
require_command openssl "Install the macOS command-line tools."
require_command xmllint "Install the macOS command-line tools."

if command -v tailscale >/dev/null 2>&1; then
  tailscale_bin=$(command -v tailscale)
elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
  tailscale_bin=/Applications/Tailscale.app/Contents/MacOS/Tailscale
else
  die "install Tailscale, sign in, and enable its CLI before rerunning."
fi

docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
docker info >/dev/null 2>&1 || die "Docker Desktop is not running or is not available to this user."

new_temporary_file
tailscale_status_file=$temporary_file
run_tailscale status --json >"$tailscale_status_file" 2>/dev/null ||
  die "Tailscale is not running and signed in. Open Tailscale, sign in, then rerun."
dns_name=$(/usr/bin/plutil -extract Self.DNSName raw -o - "$tailscale_status_file" 2>/dev/null || true)
dns_name=${dns_name%.}
case "$dns_name" in
  ""|*[!A-Za-z0-9.-]*|*.ts.net.*) die "Tailscale did not report a valid tailnet DNS name." ;;
  *.ts.net) ;;
  *) die "Tailscale DNS name does not end in .ts.net; enable MagicDNS/HTTPS before continuing." ;;
esac
app_url="https://$dns_name"

new_temporary_file
serve_status_file=$temporary_file
run_tailscale funnel status --json >"$serve_status_file" 2>/dev/null ||
  die "the installed Tailscale CLI cannot verify Funnel state. Update Tailscale first."
assert_no_funnel "$serve_status_file"

cd "$repo_dir"
if [ -f "$env_file" ]; then
  validate_existing_env
else
  configure_new_env
fi

http_port=$(env_value HTTP_PORT)
https_port=$(env_value HTTPS_PORT)
validate_port HTTP_PORT "$http_port"
validate_port HTTPS_PORT "$https_port"
[ "$http_port" != "$https_port" ] || die "HTTP_PORT and HTTPS_PORT must be different."
original_http_port=$http_port
select_available_local_ports

serve_port=$(env_value TAILSCALE_SERVE_HTTPS_PORT)
[ -n "$serve_port" ] || serve_port=443
validate_port TAILSCALE_SERVE_HTTPS_PORT "$serve_port"
tailscale_serve_managed=$(env_value TAILSCALE_SERVE_MANAGED)
[ -n "$tailscale_serve_managed" ] || tailscale_serve_managed=false
case "$tailscale_serve_managed" in
  true|false) ;;
  *) die "TAILSCALE_SERVE_MANAGED must be true or false." ;;
esac
configured_app_url=$(app_url_for_serve_port "$serve_port")
[ "$(env_value APP_URL)" = "$configured_app_url" ] ||
  die "existing APP_URL must equal $configured_app_url for the configured Tailscale HTTPS port. Edit .env deliberately, then rerun."

new_temporary_file
tailscale_serve_status_file=$temporary_file
run_tailscale serve status --json >"$tailscale_serve_status_file" 2>/dev/null ||
  die "the installed Tailscale CLI cannot inspect existing Serve routes. Update Tailscale first."
select_tailscale_serve_port "$tailscale_serve_status_file"

say "Validating the private Docker configuration."
docker compose config >/dev/null
say "Building and starting the application. Existing containers and named volumes are preserved."
docker compose up -d --build

attempt=0
until curl --fail --silent --show-error "http://127.0.0.1:$http_port/api/health" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    die "the local health check did not become ready. Run './scripts/infill logs web'."
  fi
  sleep 2
done

say "Creating or promoting the configured administrator without loading demo data."
if [ "$new_install" -eq 1 ]; then
  INITIAL_ADMIN_PASSWORD="$admin_password" \
    docker compose run --rm --no-deps -e INITIAL_ADMIN_PASSWORD web npm run admin:bootstrap
  unset admin_password
else
  new_temporary_file
  bootstrap_output_file=$temporary_file
  if docker compose run --rm --no-deps web npm run admin:bootstrap \
    >"$bootstrap_output_file" 2>&1; then
    cat "$bootstrap_output_file"
  elif grep -Fq \
    "INITIAL_ADMIN_PASSWORD is required to create the first administrator." \
    "$bootstrap_output_file"; then
    say "The existing installation has no configured administrator yet. This can happen when a first install is interrupted."
    prompt_admin_password
    INITIAL_ADMIN_PASSWORD="$admin_password" \
      docker compose run --rm --no-deps -e INITIAL_ADMIN_PASSWORD web npm run admin:bootstrap
    unset admin_password
  else
    cat "$bootstrap_output_file" >&2
    die "administrator bootstrap failed. Resolve the reported error, then rerun the installer."
  fi
fi

say "Publishing loopback port $http_port to this tailnet on private Tailscale HTTPS port $serve_port."
run_tailscale serve --https="$serve_port" --bg --yes "http://127.0.0.1:$http_port"
set_env_value TAILSCALE_SERVE_MANAGED true
new_temporary_file
verified_serve_status_file=$temporary_file
run_tailscale funnel status --json >"$verified_serve_status_file" 2>/dev/null ||
  die "Tailscale Funnel state could not be verified after configuring Serve."
assert_no_funnel "$verified_serve_status_file"
new_temporary_file
verified_route_status_file=$temporary_file
run_tailscale serve status --json >"$verified_route_status_file" 2>/dev/null ||
  die "Tailscale Serve state could not be verified after publishing the app."
sh "$script_dir/select-tailscale-serve-port.sh" --verify-route \
  "$verified_route_status_file" "$dns_name" "$serve_port" \
  "http://127.0.0.1:$http_port" ||
  die "Tailscale did not report the exact private proxy route requested by the installer."

say ""
say "Edmonton Infill Tracker is ready at $app_url"
say "No PostgreSQL or application port is exposed beyond loopback; Tailscale Funnel was not enabled."
say "Use './scripts/infill status' for health and './scripts/infill help' for operator commands."
