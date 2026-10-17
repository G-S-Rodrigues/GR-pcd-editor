#!/usr/bin/env bash
# shellcheck disable=SC2034 # RC/OUT/ERR/failed are read by the sourcing tests
# Shared helpers for the launcher tests (sourced, not executed).
# Provides a stub `docker` so the launcher is tested without a daemon.

LCH_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LCH_SCRIPT="$LCH_ROOT/gr-pcd-visualizer.sh"
failed=0

pass() { echo "PASS $1"; }
fail() {
    echo "FAIL $1: $2"
    failed=1
}

# want <id> <filter>: true when no filter is given or the id matches it.
want() { [ -z "${2:-}" ] || [ "$1" = "$2" ]; }

# make_stub_bin <dir>: <dir>/bin holds the stub docker and symlinks to the
# few coreutils the launcher needs, so PATH can be fully controlled.
# Set STUB_NO_DOCKER=1 to leave docker out.
make_stub_bin() {
    local dir=$1 tool path
    mkdir -p "$dir/bin"
    for tool in id dirname cat rm mktemp sleep tail head tr sed grep cut uname; do
        path=$(command -v "$tool") || continue
        ln -sf "$path" "$dir/bin/$tool"
    done
    rm -f "$dir/bin/id"
    cat >"$dir/bin/id" <<'IDEOF'
#!/bin/bash
if [ -n "${STUB_ID_VALUE:-}" ]; then echo "$STUB_ID_VALUE"; else exec /usr/bin/id "$@"; fi
IDEOF
    chmod +x "$dir/bin/id"
    [ "${STUB_NO_DOCKER:-0}" = 1 ] && return 0
    cat >"$dir/bin/docker" <<'DOCKEREOF'
#!/bin/bash
# Stub docker: logs every call, behaviour is steered by STUB_* variables.
args="$*"
echo "docker $args" >>"$STUB_LOG"
echo "ENV GR_PCD_DATA_DIR=${GR_PCD_DATA_DIR-} GR_PCD_PORT=${GR_PCD_PORT-} GR_PCD_UID=${GR_PCD_UID-} GR_PCD_GID=${GR_PCD_GID-}" >>"$STUB_LOG"
case "$args" in
    "compose version"*)
        [ "${STUB_COMPOSE_VERSION:-2.40.0}" = fail ] && exit 1
        echo "${STUB_COMPOSE_VERSION:-2.40.0}" ;;
    "info"*)
        [ "${STUB_INFO_RC:-0}" != 0 ] && exit "$STUB_INFO_RC"
        echo 29.0.0 ;;
    "context inspect"*)
        echo "${STUB_CONTEXT_HOST:-unix:///var/run/docker.sock}" ;;
    "image inspect"*)
        [ "${STUB_IMAGE_PRESENT:-0}" = 1 ] || exit 1 ;;
    *" ps -aq"*)
        [ -n "${STUB_PS_ID:-}" ] && echo "$STUB_PS_ID"
        exit 0 ;;
    "inspect "*gr-pcd.data-dir*) echo "${STUB_LABEL_DATA-}" ;;
    "inspect "*gr-pcd.port*) echo "${STUB_LABEL_PORT-}" ;;
    "inspect "*gr-pcd.user*) echo "${STUB_LABEL_USER-}" ;;
    "inspect "*Health*) echo "${STUB_HEALTH:-healthy}" ;;
    *" build "*) exit 0 ;;
    *" up "*)
        sleep "${STUB_UP_SLEEP:-0}"
        [ -n "${STUB_UP_MSG:-}" ] && echo "$STUB_UP_MSG" >&2
        exit "${STUB_UP_RC:-0}" ;;
    *" logs "*) echo "stub container logs" ;;
    *" down"*) exit 0 ;;
esac
exit 0
DOCKEREOF
    chmod +x "$dir/bin/docker"
}

# make_opener <dir> <rc>: a stub xdg-open that logs its argument.
make_opener() {
    cat >"$1/bin/xdg-open" <<OPEOF
#!/bin/bash
echo "xdg-open \$*" >>"\$STUB_LOG"
exit $2
OPEOF
    chmod +x "$1/bin/xdg-open"
}

# free_port: print a currently free local TCP port.
free_port() {
    python3 -c '
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
'
}

# new_case: fresh tmp tree; sets T, STUB_LOG, DATA (a valid data dir).
new_case() {
    T=$(mktemp -d)
    chmod 755 "$T"
    STUB_LOG="$T/stub.log"
    : >"$STUB_LOG"
    export STUB_LOG
    DATA="$T/data"
    mkdir -p "$DATA"
    make_stub_bin "$T"
}

# run_launcher <cwd> args...: sets OUT, ERR, RC. Host PATH is replaced by the
# stub bin dir; the host DOCKER_HOST never leaks in.
run_launcher() {
    local cwd=$1
    shift
    RC=0
    (
        cd "$cwd" || exit 99
        unset DOCKER_HOST
        export PATH="$T/bin"
        export GR_PCD_PORT_PROBE_HOST=127.0.0.2
        exec /bin/bash "$LCH_SCRIPT" "$@"
    ) >"$T/out" 2>"$T/err" || RC=$?
    OUT=$(cat "$T/out")
    ERR=$(cat "$T/err")
}

docker_calls() { grep -c '^docker ' "$STUB_LOG" || true; }
