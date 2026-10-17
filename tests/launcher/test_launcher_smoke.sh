#!/usr/bin/env bash
# Launcher smoke tests LCH-20..LCH-25, LCH-27 against the real Docker daemon.
# Needs docker, curl, python3. Uses project gr-pcd-ltest-* and port
# ${LTEST_PORT:-18081}. Do not run concurrently with the container tier.
set -uo pipefail
# shellcheck source=tests/launcher/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

for tool in docker curl python3; do
    command -v "$tool" >/dev/null 2>&1 || { echo "FAIL: '$tool' not found"; exit 1; }
done
if [ "$(id -u)" = 0 ]; then echo "FAIL: run as a non-root user"; exit 1; fi

port="${LTEST_PORT:-18081}"
export COMPOSE_PROJECT_NAME="gr-pcd-ltest-$$"
tmp=$(mktemp -d)
chmod 755 "$tmp"
mkdir -p "$tmp/cwd"

dc() {
    GR_PCD_PORT="$port" docker compose -f "$LCH_ROOT/docker/compose.yaml" "$@"
}
# shellcheck disable=SC2317 # invoked via trap
cleanup() {
    dc down -v --remove-orphans >/dev/null 2>&1 || true
    [ -n "${lp:-}" ] && kill "$lp" 2>/dev/null
    rm -rf "$tmp"
}
trap cleanup EXIT

# launch args...: run the launcher from another cwd; sets RC OUT ERR.
launch() {
    RC=0
    (cd "$tmp/cwd" && bash "$LCH_SCRIPT" --no-browser "$@") >"$tmp/out" 2>"$tmp/err" || RC=$?
    ERR=$(tail -n 20 "$tmp/err")
}
cid() { dc ps -aq app | head -n1; }

launch --port "$port"
if [ "$RC" = 0 ] && [ "$(tail -n1 "$tmp/out")" = "GR PCD Editor is ready: http://localhost:$port" ] \
    && curl -fsS "http://127.0.0.1:$port/health" | grep -q '"status":"ok"' \
    && ! dc exec -T app test -e /data; then
    pass LCH-20
else fail LCH-20 "rc=$RC err=$ERR"; fi

if [ "$(dc exec -T app id -u)" = "$(id -u)" ] \
    && dc exec -T app sh -c 'echo m >/work/marker'; then
    pass LCH-21
else fail LCH-21 "uid mismatch or /work not writable"; fi

if dc port app 8080 | grep -q '^127\.0\.0\.1:'; then
    pass LCH-22
else fail LCH-22 "not loopback-only"; fi

id1=$(cid)
launch --port "$port"
rc_a=$RC
launch --port "$((port + 1))"
if [ "$rc_a" = 0 ] && [ "$(cid)" = "$id1" ] && [ "$RC" = 5 ] \
    && grep -q -- '--stop' "$tmp/err"; then pass LCH-23
else fail LCH-23 "reuse rc=$rc_a conflict rc=$RC"; fi

launch --stop
stopped=0
[ "$RC" = 0 ] && [ -z "$(dc ps -aq app)" ] \
    && docker volume inspect "${COMPOSE_PROJECT_NAME}_work" >/dev/null 2>&1 && stopped=1
launch --port "$port"
if [ "$stopped" = 1 ] && [ "$RC" = 0 ] \
    && [ "$(dc exec -T app cat /work/marker)" = m ]; then pass LCH-24
else fail LCH-24 "stopped=$stopped rc=$RC"; fi

launch --port "$port" --rebuild
if [ "$RC" = 0 ] && curl -fsS "http://127.0.0.1:$port/health" | grep -q '"status":"ok"' \
    && [ "$(dc exec -T app cat /work/marker)" = m ]; then
    pass LCH-25
else fail LCH-25 "rc=$RC err=$ERR"; fi

launch --stop >/dev/null

python3 - "$port" "$tmp/ready" <<'PYEOF' &
import socket, sys, time
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", int(sys.argv[1])))
s.listen(1)
open(sys.argv[2], "w").close()
time.sleep(30)
PYEOF
lp=$!
for _ in $(seq 50); do [ -e "$tmp/ready" ] && break; sleep 0.1; done
launch --port "$port"
if [ "$RC" = 4 ] && [ -z "$(dc ps -aq app)" ]; then pass LCH-27
else fail LCH-27 "rc=$RC err=$ERR"; fi

exit "$failed"
