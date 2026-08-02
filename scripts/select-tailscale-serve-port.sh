#!/bin/sh

set -eu

script_name=${0##*/}
fallback_start_port=9443
max_candidates=200
max_port=65535

fail() {
  printf '%s: %s\n' "$script_name" "$*" >&2
  exit 1
}

is_executable() {
  case "$1" in
    */*) [ -x "$1" ] ;;
    *) command -v "$1" >/dev/null 2>&1 ;;
  esac
}

normalize_port() {
  port=$1

  case "$port" in
    "" | *[!0-9]*) return 1 ;;
  esac

  while [ "${port#0}" != "$port" ]; do
    port=${port#0}
  done
  [ -n "$port" ] || port=0

  if [ "$port" -lt 1 ] || [ "$port" -gt "$max_port" ]; then
    return 1
  fi

  printf '%s\n' "$port"
}

valid_dns_name() {
  name=$1

  # Tailscale reports fully qualified DNS names with a trailing dot. Accept
  # that canonical form, but validate the labels without the root dot.
  case "$name" in
    *.) name=${name%.} ;;
  esac

  case "$name" in
    "" | *[!A-Za-z0-9.-]* | .* | *..*) return 1 ;;
  esac

  [ "${#name}" -le 253 ] || return 1

  previous_ifs=$IFS
  IFS=.
  set -- $name
  IFS=$previous_ifs

  for label do
    case "$label" in
      "" | -* | *-) return 1 ;;
    esac
    [ "${#label}" -le 63 ] || return 1
  done

  return 0
}

mode=select
case "$#" in
  2)
    [ "$1" = "--docker-port-status" ] ||
      fail "usage: $script_name [--verify-route] SERVE_STATUS_JSON_FILE DNS_NAME PORT [PROXY_TARGET]"
    mode=docker_port_status
    shift
    ;;
  3) ;;
  5)
    [ "$1" = "--verify-route" ] ||
      fail "usage: $script_name [--verify-route] SERVE_STATUS_JSON_FILE DNS_NAME PORT [PROXY_TARGET]"
    mode=verify
    shift
    ;;
  *)
    fail "usage: $script_name [--verify-route] SERVE_STATUS_JSON_FILE DNS_NAME PORT [PROXY_TARGET]"
    ;;
esac

docker_bin=${INFILL_DOCKER_BIN:-docker}
docker_published_ports=

inspect_docker_ports() {
  docker_published_ports=
  # NetworkSettings.Ports can be empty after a container stops, while the port
  # it needs on restart remains in HostConfig.PortBindings. Inspect the saved
  # configuration of every container so a failed restart is still detected.
  docker_container_ids=$("$docker_bin" ps --all --quiet 2>/dev/null) || return 1
  for docker_container_id in $docker_container_ids; do
    container_published_ports=$("$docker_bin" inspect --format \
      '{{range $containerPort, $bindings := .HostConfig.PortBindings}}{{range $bindings}}{{if .HostPort}}{{printf "%s->%s\n" .HostPort $containerPort}}{{end}}{{end}}{{end}}' \
      "$docker_container_id" 2>/dev/null) || return 1
    [ -n "$container_published_ports" ] || continue
    if [ -z "$docker_published_ports" ]; then
      docker_published_ports=$container_published_ports
    else
      docker_published_ports="$docker_published_ports
$container_published_ports"
    fi
  done
}

docker_port_in_use() {
  expected_protocol=$1
  expected_port=$2

  [ -n "$docker_published_ports" ] || return 1

  for published_binding in $docker_published_ports; do
    published_binding=${published_binding%,}

    case "$published_binding" in
      *"->"*"/$expected_protocol") ;;
      *) continue ;;
    esac

    host_binding=${published_binding%%->*}
    published_port=${host_binding##*:}

    case "$published_port" in
      *-*)
        range_start=${published_port%%-*}
        range_end=${published_port#*-}
        case "$range_start:$range_end" in
          *[!0-9:]*) continue ;;
        esac
        if [ -n "$range_start" ] &&
          [ -n "$range_end" ] &&
          [ "$expected_port" -ge "$range_start" ] &&
          [ "$expected_port" -le "$range_end" ]; then
          return 0
        fi
        ;;
      "$expected_port") return 0 ;;
    esac
  done

  return 1
}

if [ "$mode" = "docker_port_status" ]; then
  if ! docker_status_port=$(normalize_port "$1"); then
    fail "port must be an integer from 1 to $max_port"
  fi
  inspect_docker_ports || fail "Docker published ports could not be inspected"

  if docker_port_in_use tcp "$docker_status_port" ||
    docker_port_in_use udp "$docker_status_port"; then
    printf '%s\n' in-use
  else
    printf '%s\n' free
  fi
  exit 0
fi

status_json_file=$1
dns_name=$2

if [ ! -f "$status_json_file" ] || [ ! -r "$status_json_file" ]; then
  fail "Tailscale Serve status file is not a readable file"
fi

if ! valid_dns_name "$dns_name"; then
  fail "DNS name is not valid"
fi
dns_name=${dns_name%.}

if ! start_port=$(normalize_port "$3"); then
  fail "start port must be an integer from 1 to $max_port"
fi

if [ "$mode" = "verify" ]; then
  proxy_target=$4
  case "$proxy_target" in
    http://127.0.0.1:*) proxy_port=${proxy_target#http://127.0.0.1:} ;;
    *) fail "proxy target must be an exact http://127.0.0.1:PORT URL" ;;
  esac
  if ! normalized_proxy_port=$(normalize_port "$proxy_port"); then
    fail "proxy target must contain a valid port"
  fi
  [ "$proxy_target" = "http://127.0.0.1:$normalized_proxy_port" ] ||
    fail "proxy target must not contain a path or extra URL components"
fi

if [ "$mode" = "select" ]; then
  if [ -n "${INFILL_LSOF_BIN:-}" ]; then
    lsof_bin=$INFILL_LSOF_BIN
  elif [ -x /usr/sbin/lsof ]; then
    lsof_bin=/usr/sbin/lsof
  elif lsof_bin=$(command -v lsof 2>/dev/null); then
    :
  else
    fail "lsof is required to check host ports"
  fi

  if [ ! -x "$lsof_bin" ] && ! command -v "$lsof_bin" >/dev/null 2>&1; then
    fail "lsof command is not executable: $lsof_bin"
  fi

  # Docker Desktop publishes container ports through its own networking layer,
  # so retain lsof as a second check but fail closed if Docker's bindings cannot
  # be inspected reliably.
  inspect_docker_ports || fail "Docker published ports could not be inspected"
fi

plutil_bin=${INFILL_PLUTIL_BIN:-/usr/bin/plutil}
xmllint_bin=${INFILL_XMLLINT_BIN:-/usr/bin/xmllint}

if ! is_executable "$plutil_bin"; then
  fail "plutil is required to inspect Tailscale Serve status"
fi

if ! is_executable "$xmllint_bin"; then
  fail "xmllint is required to inspect Tailscale Serve status"
fi

# plutil also accepts plist input. Requiring a JSON object before conversion keeps
# this interface strict and makes a truncated or unrelated status file fail
# closed instead of being mistaken for an empty Tailscale configuration.
first_content_line=$(
  LC_ALL=C sed -e 's/^[[:space:]]*//' -e '/^$/d' -e 'q' "$status_json_file"
)
case "$first_content_line" in
  \{*) ;;
  *) fail "Tailscale Serve status file is not a valid JSON object" ;;
esac

if ! "$plutil_bin" -convert json -o /dev/null -- "$status_json_file" >/dev/null 2>&1; then
  fail "Tailscale Serve status file is not valid JSON"
fi

status_xml_file=$(mktemp "${TMPDIR:-/tmp}/infill-serve-status.XXXXXX") ||
  fail "could not create a temporary status file"
cleanup() {
  rm -f "$status_xml_file"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

if ! "$plutil_bin" -convert xml1 -o "$status_xml_file" -- "$status_json_file" \
  >/dev/null 2>&1; then
  fail "could not parse Tailscale Serve status JSON"
fi

if [ "$("$xmllint_bin" --xpath 'boolean(/plist/dict)' "$status_xml_file" 2>/dev/null)" != "true" ]; then
  fail "Tailscale Serve status JSON must contain an object"
fi

tailscale_port_is_occupied() {
  candidate=$1
  xpath="boolean(//key[. = 'TCP']/following-sibling::*[1][self::dict]/key[string-length(.) > 0 and translate(., '0123456789', '') = '' and number(.) = $candidate])"

  if ! occupied=$("$xmllint_bin" --xpath "$xpath" "$status_xml_file" 2>/dev/null); then
    fail "could not inspect Tailscale Serve status"
  fi

  [ "$occupied" = "true" ]
}

tcp_port_in_use() {
  if docker_port_in_use tcp "$1"; then
    return 0
  fi

  if "$lsof_bin" -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then
    return 0
  else
    lsof_status=$?
  fi
  [ "$lsof_status" -eq 1 ] || fail "lsof could not inspect TCP port $1"
  return 1
}

udp_port_in_use() {
  if docker_port_in_use udp "$1"; then
    return 0
  fi

  if "$lsof_bin" -nP -iUDP:"$1" >/dev/null 2>&1; then
    return 0
  else
    lsof_status=$?
  fi
  [ "$lsof_status" -eq 1 ] || fail "lsof could not inspect UDP port $1"
  return 1
}

port_is_occupied() {
  tailscale_port_is_occupied "$1" || tcp_port_in_use "$1" || udp_port_in_use "$1"
}

if [ "$mode" = "verify" ]; then
  host_port="$dns_name:$start_port"
  route_xpath="count(/plist/dict/key[. = 'Web']/following-sibling::dict[1]/key[. = '$host_port']/following-sibling::dict[1]/key[. = 'Handlers']/following-sibling::dict[1]/key[. = '/']/following-sibling::dict[1]/key[. = 'Proxy']/following-sibling::string[1][. = '$proxy_target'])"
  handler_count_xpath="count(/plist/dict/key[. = 'Web']/following-sibling::dict[1]/key[. = '$host_port']/following-sibling::dict[1]/key[. = 'Handlers']/following-sibling::dict[1]/key)"
  https_xpath="boolean(/plist/dict/key[. = 'TCP']/following-sibling::dict[1]/key[. = '$start_port']/following-sibling::dict[1]/key[. = 'HTTPS']/following-sibling::true[1])"

  route_count=$("$xmllint_bin" --xpath "$route_xpath" "$status_xml_file" 2>/dev/null) ||
    fail "could not verify the Tailscale Serve proxy route"
  handler_count=$("$xmllint_bin" --xpath "$handler_count_xpath" "$status_xml_file" 2>/dev/null) ||
    fail "could not verify exclusive ownership of the Tailscale Serve port"
  https_enabled=$("$xmllint_bin" --xpath "$https_xpath" "$status_xml_file" 2>/dev/null) ||
    fail "could not verify the Tailscale Serve HTTPS listener"
  [ "$route_count" = "1" ] && [ "$handler_count" = "1" ] &&
    [ "$https_enabled" = "true" ] ||
    fail "the expected private Tailscale Serve route is not the sole handler on this port"
  exit 0
fi

if ! port_is_occupied "$start_port"; then
  printf '%s\n' "$start_port"
  exit 0
fi

candidate=$fallback_start_port
checked=0
while [ "$candidate" -le "$max_port" ] && [ "$checked" -lt "$max_candidates" ]; do
  if ! port_is_occupied "$candidate"; then
    printf '%s\n' "$candidate"
    exit 0
  fi

  candidate=$((candidate + 1))
  checked=$((checked + 1))
done

fail "no unused Tailscale Serve HTTPS port found in $max_candidates candidates from $fallback_start_port"
