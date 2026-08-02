#!/bin/sh

set -eu

script_name=${0##*/}
max_candidates=200
max_port=65535

fail() {
  printf '%s: %s\n' "$script_name" "$*" >&2
  exit 1
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

if [ "$#" -ne 2 ]; then
  fail "usage: $script_name HTTP_START_PORT HTTPS_START_PORT"
fi

if ! http_start_port=$(normalize_port "$1"); then
  fail "HTTP start port must be an integer from 1 to $max_port"
fi

if ! https_start_port=$(normalize_port "$2"); then
  fail "HTTPS start port must be an integer from 1 to $max_port"
fi

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

docker_bin=${INFILL_DOCKER_BIN:-docker}
if docker_published_ports=$("$docker_bin" ps --format '{{.Ports}}' 2>/dev/null); then
  :
else
  docker_published_ports=
fi

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

select_http_port() {
  candidate=$1
  checked=0

  while [ "$candidate" -le "$max_port" ] && [ "$checked" -lt "$max_candidates" ]; do
    if ! tcp_port_in_use "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi

    candidate=$((candidate + 1))
    checked=$((checked + 1))
  done

  return 1
}

select_https_port() {
  candidate=$1
  reserved_http_port=$2
  checked=0

  while [ "$candidate" -le "$max_port" ] && [ "$checked" -lt "$max_candidates" ]; do
    if [ "$candidate" -ne "$reserved_http_port" ] &&
      ! tcp_port_in_use "$candidate" &&
      ! udp_port_in_use "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi

    candidate=$((candidate + 1))
    checked=$((checked + 1))
  done

  return 1
}

if ! http_port=$(select_http_port "$http_start_port"); then
  fail "no free HTTP port found in the next $max_candidates candidates from $http_start_port"
fi

if ! https_port=$(select_https_port "$https_start_port" "$http_port"); then
  fail "no free HTTPS port found in the next $max_candidates candidates from $https_start_port"
fi

printf '%s %s\n' "$http_port" "$https_port"
