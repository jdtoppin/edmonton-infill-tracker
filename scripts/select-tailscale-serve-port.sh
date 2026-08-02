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

port_is_occupied() {
  candidate=$1
  xpath="boolean(//key[. = 'TCP']/following-sibling::*[1][self::dict]/key[string-length(.) > 0 and translate(., '0123456789', '') = '' and number(.) = $candidate])"

  if ! occupied=$("$xmllint_bin" --xpath "$xpath" "$status_xml_file" 2>/dev/null); then
    fail "could not inspect Tailscale Serve status"
  fi

  [ "$occupied" = "true" ]
}

if [ "$mode" = "verify" ]; then
  host_port="$dns_name:$start_port"
  route_xpath="count(/plist/dict/key[. = 'Web']/following-sibling::dict[1]/key[. = '$host_port']/following-sibling::dict[1]/key[. = 'Handlers']/following-sibling::dict[1]/key[. = '/']/following-sibling::dict[1]/key[. = 'Proxy']/following-sibling::string[1][. = '$proxy_target'])"
  https_xpath="boolean(/plist/dict/key[. = 'TCP']/following-sibling::dict[1]/key[. = '$start_port']/following-sibling::dict[1]/key[. = 'HTTPS']/following-sibling::true[1])"

  route_count=$("$xmllint_bin" --xpath "$route_xpath" "$status_xml_file" 2>/dev/null) ||
    fail "could not verify the Tailscale Serve proxy route"
  https_enabled=$("$xmllint_bin" --xpath "$https_xpath" "$status_xml_file" 2>/dev/null) ||
    fail "could not verify the Tailscale Serve HTTPS listener"
  [ "$route_count" = "1" ] && [ "$https_enabled" = "true" ] ||
    fail "the expected private Tailscale Serve route is not configured"
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
