#!/usr/bin/env bash
# GR PCD Editor launcher: validates the port, starts the Compose stack and waits
# until the app is healthy. Exit codes: 0 ok, 1 startup/health failure,
# 2 usage or validation, 3 prerequisite, 4 port in use, 5 incompatible
# running instance, 130 interrupted.
set -euo pipefail

src=${BASH_SOURCE[0]}
case $src in
    */*) root=$(cd -P -- "${src%/*}" && pwd -P) ;;
    *) root=$(pwd -P) ;;
esac
compose_file="$root/docker/compose.yaml"
image="gr-pcd-visualizer:local"

usage() {
    cat >&2 <<'USAGE'
Usage: gr-pcd-visualizer.sh [--port PORT] [--rebuild] [--no-browser]
       gr-pcd-visualizer.sh --stop

  --port PORT     local port, 1024-65535 (default: 8080)
  --rebuild       rebuild the image and recreate the container
  --no-browser    do not open a browser
  --stop          stop the app (work data is kept)
USAGE
}

die() {
    local rc=$1
    shift
    echo "error: $*" >&2
    exit "$rc"
}

die_usage() {
    echo "error: $*" >&2
    usage
    exit 2
}

validate_port() {
    local p=$1
    [[ $p =~ ^[0-9]{1,5}$ ]] || die_usage "invalid port '$p': expected an integer 1024-65535"
    if ((10#$p < 1024 || 10#$p > 65535)); then
        die_usage "invalid port '$p': expected an integer 1024-65535"
    fi
}

dc() { docker compose -f "$compose_file" "$@"; }

check_prereqs() {
    command -v docker >/dev/null 2>&1 \
        || die 3 "Docker CLI not found; install Docker Engine (https://docs.docker.com/engine/install/)"
    local ver major host
    ver=$(docker compose version --short 2>/dev/null) || ver=""
    major=${ver#v}
    major=${major%%.*}
    if ! [[ $major =~ ^[0-9]+$ ]] || ((major < 2)); then
        die 3 "Docker Compose v2 is required (found: ${ver:-none})"
    fi
    docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 \
        || die 3 "Docker daemon unavailable; start Docker and retry"
    if [ -n "${DOCKER_HOST:-}" ]; then
        host=$DOCKER_HOST
    else
        host=$(docker context inspect --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null) || host=""
    fi
    case $host in
        unix://*) ;;
        *) die 3 "local Docker context required (got '${host:-unknown}'); the editor is published on this machine's loopback" ;;
    esac
}

# shellcheck disable=SC2317 # invoked via trap
on_interrupt() {
    echo "interrupted; the server may still be running, stop it with: $0 --stop" >&2
    exit 130
}

# run_waitable <outfile|-> cmd...: run in the background and wait, so a
# trapped signal interrupts immediately. Output goes to outfile (or stderr).
run_waitable() {
    local out=$1
    shift
    local rc=0
    if [ "$out" = - ]; then
        "$@" >&2 &
    else
        "$@" >"$out" 2>&1 &
    fi
    wait $! || rc=$?
    return "$rc"
}

label() { docker inspect --format "{{index .Config.Labels \"$1\"}}" "$2" 2>/dev/null || true; }

port_in_use() {
    (exec 3<>"/dev/tcp/${GR_PCD_PORT_PROBE_HOST:-127.0.0.1}/$1") 2>/dev/null
}

open_browser() {
    local url=$1 c
    for c in xdg-open sensible-browser open; do
        [ "$c" = open ] && [[ ${OSTYPE:-} != darwin* ]] && continue
        if command -v "$c" >/dev/null 2>&1; then
            "$c" "$url" >/dev/null 2>&1 || echo "warning: could not open a browser; open $url yourself" >&2
            return 0
        fi
    done
    echo "warning: no browser opener found; open $url yourself" >&2
}

main() {
    local port=8080 port_set=0 rebuild=0 stop=0 browser=1
    while [ $# -gt 0 ]; do
        case $1 in
            --data-dir)
                die_usage "--data-dir was removed: open files from your computer with the editor's Open button"
                ;;
            --port)
                [ $# -ge 2 ] || die_usage "--port needs a value"
                port=$2
                port_set=1
                shift 2
                ;;
            --rebuild) rebuild=1; shift ;;
            --no-browser) browser=0; shift ;;
            --stop) stop=1; shift ;;
            -h | --help) usage; exit 0 ;;
            *) die_usage "unknown option: $1" ;;
        esac
    done

    local uid gid
    uid=$(id -u)
    gid=$(id -g)
    if [ "$uid" = 0 ]; then
        echo "warning: running as root; the app will run as uid 10001" >&2
        uid=10001
        gid=10001
    fi
    export GR_PCD_UID=$uid GR_PCD_GID=$gid

    if [ "$stop" = 1 ]; then
        if [ "$port_set" = 1 ] || [ "$rebuild" = 1 ]; then
            die_usage "--stop cannot be combined with --port or --rebuild"
        fi
        check_prereqs
        export GR_PCD_PORT=$port
        dc down >&2
        exit 0
    fi

    validate_port "$port"
    local timeout=${GR_PCD_WAIT_TIMEOUT:-120}
    [[ $timeout =~ ^[0-9]+$ ]] || die_usage "GR_PCD_WAIT_TIMEOUT must be a number of seconds"
    check_prereqs

    export GR_PCD_PORT=$port
    local url="http://localhost:$port" user="$uid:$gid" cid own=0
    local ready="GR PCD Editor is ready: $url"

    cid=$(dc ps -aq app 2>/dev/null | head -n1) || cid=""
    if [ -n "$cid" ]; then
        local r_port r_user health
        r_port=$(label gr-pcd.port "$cid")
        r_user=$(label gr-pcd.user "$cid")
        if [ "$r_port" != "$port" ] || [ "$r_user" != "$user" ]; then
            {
                echo "error: GR PCD Editor is already set up with different settings."
                echo "  running:   port=$r_port user=$r_user"
                echo "  requested: port=$port user=$user"
                echo "Stop it first with: $0 --stop"
            } >&2
            exit 5
        fi
        own=1 # same settings: a bound port is this instance's own
        health=$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null) || health=""
        # a container left running an older image is not reused (ids unknown: reuse)
        local c_image t_image
        c_image=$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null) || c_image=""
        t_image=$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null) || t_image=""
        if [ -n "$c_image" ] && [ -n "$t_image" ] && [ "$c_image" != "$t_image" ]; then
            health=stale-image
        fi
        # an earlier build bound a data folder (label gr-pcd.data-dir): recreate it
        if [ -n "$(label gr-pcd.data-dir "$cid")" ]; then
            health=legacy-mount
        fi
        if [ "$health" = healthy ] && [ "$rebuild" = 0 ]; then
            echo "$ready"
            [ "$browser" = 1 ] && open_browser "$url"
            exit 0
        fi
    fi

    if [ "$own" = 0 ] && port_in_use "$port"; then
        die 4 "port $port is in use; choose another with --port"
    fi

    trap on_interrupt INT TERM
    if [ "$rebuild" = 1 ] || ! docker image inspect "$image" >/dev/null 2>&1; then
        run_waitable - docker compose -f "$compose_file" build app \
            || die 1 "image build failed"
    fi

    local log rc=0
    log=$(mktemp)
    # shellcheck disable=SC2064
    trap "rm -f '$log'" EXIT
    run_waitable "$log" docker compose -f "$compose_file" up -d --wait --wait-timeout "$timeout" app || rc=$?
    if [ "$rc" -ne 0 ]; then
        cat "$log" >&2
        if grep -qi 'port is already allocated' "$log"; then
            die 4 "port $port is in use; choose another with --port"
        fi
        dc logs --tail 40 app >&2 || true
        die 1 "GR PCD Editor did not become healthy within ${timeout}s (logs above)"
    fi
    trap - INT TERM
    echo "$ready"
    [ "$browser" = 1 ] && open_browser "$url"
    exit 0
}

main "$@"
