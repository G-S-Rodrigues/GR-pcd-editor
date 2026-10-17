#!/usr/bin/env bash
# Launcher tests LCH-01..LCH-19d against a stub docker (host, no daemon).
# Needs bash and python3. Optional argument: one test ID, e.g. LCH-05.
set -uo pipefail
# shellcheck source=tests/launcher/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
only=${1:-}
URL_RE='http://localhost'

# no_url: stdout never carries the ready line
no_url() { ! grep -q "$URL_RE" "$T/out"; }
log_has() { grep -q -- "$1" "$STUB_LOG"; }

if want LCH-01 "$only"; then
    new_case
    run_launcher "$T" --data-dir "$T/does-not-exist"
    if [ "$RC" = 2 ] && grep -q "$T/does-not-exist" "$T/err" \
        && grep -q "does not exist" "$T/err" && [ ! -e "$T/does-not-exist" ] \
        && [ ! -s "$STUB_LOG" ] && no_url; then pass LCH-01
    else fail LCH-01 "rc=$RC err=$ERR"; fi
fi

if want LCH-02 "$only"; then
    new_case
    : >"$T/afile"
    run_launcher "$T" --data-dir "$T/afile"
    if [ "$RC" = 2 ] && [ ! -s "$STUB_LOG" ] && no_url; then pass LCH-02
    else fail LCH-02 "rc=$RC err=$ERR"; fi
fi

if want LCH-03 "$only"; then
    new_case
    chmod 000 "$DATA"
    if [ -r "$DATA" ]; then
        fail LCH-03 "directory still readable; run as non-root"
    else
        run_launcher "$T" --data-dir "$DATA"
        if [ "$RC" = 2 ] && grep -q "not readable" "$T/err" \
            && [ ! -s "$STUB_LOG" ]; then pass LCH-03
        else fail LCH-03 "rc=$RC err=$ERR"; fi
    fi
    chmod 755 "$DATA"
fi

if want LCH-04 "$only"; then
    new_case
    bad=0
    for p in abc 0 80 70000 ""; do
        run_launcher "$T" --data-dir "$DATA" --port "$p"
        { [ "$RC" = 2 ] && no_url && [ ! -s "$STUB_LOG" ]; } || bad=1
    done
    run_launcher "$T" --data-dir "$DATA" --port
    [ "$RC" = 2 ] || bad=1
    run_launcher "$T" --bogus
    { [ "$RC" = 2 ] && grep -qi usage "$T/err"; } || bad=1
    if [ "$bad" = 0 ]; then pass LCH-04; else fail LCH-04 "a bad input was accepted"; fi
fi

if want LCH-05 "$only"; then
    new_case
    mkdir -p "$T/my maps" "$T/elsewhere"
    run_launcher "$T/elsewhere" --data-dir "../my maps" --no-browser
    canon=$(cd "$T/my maps" && pwd -P)
    if [ "$RC" = 0 ] && grep -q "ENV GR_PCD_DATA_DIR=$canon GR_PCD_PORT" "$STUB_LOG" \
        && grep -q -- "-f $LCH_ROOT/docker/compose.yaml" "$STUB_LOG"; then pass LCH-05
    else fail LCH-05 "rc=$RC log=$(grep ENV "$STUB_LOG" | head -2)"; fi
fi

if want LCH-06 "$only"; then
    new_case
    # shellcheck disable=SC2016 # the literal $( ) must not expand
    meta="$T/"'a b;$(touch PWNED)'"'\"x"
    mkdir -p "$meta"
    run_launcher "$T" --data-dir "$meta" --no-browser
    canon=$(cd "$meta" && pwd -P)
    if [ "$RC" = 0 ] && grep -qF "ENV GR_PCD_DATA_DIR=$canon GR_PCD_PORT" "$STUB_LOG" \
        && [ ! -e "$T/PWNED" ] && [ ! -e PWNED ] && [ ! -e "$meta/PWNED" ]; then pass LCH-06
    else fail LCH-06 "rc=$RC"; fi
fi

if want LCH-07 "$only"; then
    new_case
    run_launcher "$DATA" --no-browser
    canon=$(cd "$DATA" && pwd -P)
    if [ "$RC" = 0 ] && grep -q "ENV GR_PCD_DATA_DIR=$canon GR_PCD_PORT" "$STUB_LOG"; then pass LCH-07
    else fail LCH-07 "rc=$RC"; fi
fi

if want LCH-08 "$only"; then
    STUB_NO_DOCKER=1 new_case
    run_launcher "$T" --data-dir "$DATA"
    if [ "$RC" = 3 ] && grep -qi docker "$T/err" && grep -qi install "$T/err" \
        && no_url; then pass LCH-08
    else fail LCH-08 "rc=$RC err=$ERR"; fi
fi

if want LCH-09 "$only"; then
    new_case
    bad=0
    for v in fail 1.29.2; do
        STUB_COMPOSE_VERSION=$v run_launcher "$T" --data-dir "$DATA"
        { [ "$RC" = 3 ] && grep -q "Compose v2" "$T/err" && no_url; } || bad=1
    done
    if [ "$bad" = 0 ]; then pass LCH-09; else fail LCH-09 "rc=$RC err=$ERR"; fi
fi

if want LCH-10 "$only"; then
    new_case
    STUB_INFO_RC=1 run_launcher "$T" --data-dir "$DATA"
    if [ "$RC" = 3 ] && grep -qi "daemon" "$T/err" && no_url; then pass LCH-10
    else fail LCH-10 "rc=$RC err=$ERR"; fi
fi

if want LCH-11 "$only"; then
    new_case
    bad=0
    STUB_CONTEXT_HOST=ssh://box run_launcher "$T" --data-dir "$DATA"
    { [ "$RC" = 3 ] && grep -q "local Docker context" "$T/err"; } || bad=1
    DOCKER_HOST_TEST=tcp://x
    RC=0
    (
        cd "$T" || exit 99
        # shellcheck disable=SC2031 # intentional: scoped to this subshell
        export PATH="$T/bin" DOCKER_HOST=$DOCKER_HOST_TEST
        exec /bin/bash "$LCH_SCRIPT" --data-dir "$DATA"
    ) >"$T/out" 2>"$T/err" || RC=$?
    { [ "$RC" = 3 ] && grep -q "local Docker context" "$T/err"; } || bad=1
    if [ "$bad" = 0 ]; then pass LCH-11; else fail LCH-11 "remote context accepted"; fi
fi

if want LCH-12 "$only"; then
    new_case
    run_launcher "$T" --data-dir "$DATA" --no-browser
    b=$(grep -n ' build app' "$STUB_LOG" | head -1 | cut -d: -f1)
    u=$(grep -n ' up -d --wait --wait-timeout 120 app' "$STUB_LOG" | head -1 | cut -d: -f1)
    last=$(tail -n1 "$T/out")
    ok=0
    [ "$RC" = 0 ] && [ -n "$b" ] && [ -n "$u" ] && [ "$b" -lt "$u" ] \
        && [ "$last" = "GR PCD Editor is ready: http://localhost:8080" ] \
        && grep -q 'GR_PCD_PORT=8080' "$STUB_LOG" && ok=1
    p2=$(free_port)
    run_launcher "$T" --data-dir "$DATA" --port "$p2" --no-browser
    [ "$(tail -n1 "$T/out")" = "GR PCD Editor is ready: http://localhost:$p2" ] \
        && grep -q "GR_PCD_PORT=$p2" "$STUB_LOG" || ok=0
    if [ "$ok" = 1 ]; then pass LCH-12; else fail LCH-12 "rc=$RC out=$OUT"; fi
fi

if want LCH-13 "$only"; then
    new_case
    export STUB_IMAGE_PRESENT=1
    run_launcher "$T" --data-dir "$DATA" --no-browser
    nobuild=0
    log_has ' build ' || nobuild=1
    : >"$STUB_LOG"
    run_launcher "$T" --data-dir "$DATA" --no-browser --rebuild
    if [ "$nobuild" = 1 ] && log_has ' build app' && ! log_has 'no-cache'; then pass LCH-13
    else fail LCH-13 "nobuild=$nobuild"; fi
    unset STUB_IMAGE_PRESENT
fi

if want LCH-14 "$only"; then
    new_case
    STUB_UP_RC=1 STUB_UP_MSG="timed out waiting" GR_PCD_WAIT_TIMEOUT=3 \
        run_launcher "$T" --data-dir "$DATA" --no-browser
    if [ "$RC" = 1 ] && log_has 'logs --tail 40 app' \
        && log_has '--wait-timeout 3 app' && no_url \
        && grep -q "timed out waiting" "$T/err"; then pass LCH-14
    else fail LCH-14 "rc=$RC err=$ERR"; fi
fi

if want LCH-15 "$only"; then
    new_case
    STUB_UP_RC=1 STUB_UP_MSG="Bind for 127.0.0.1:8080 failed: port is already allocated" \
        run_launcher "$T" --data-dir "$DATA" --no-browser
    if [ "$RC" = 4 ] && no_url; then pass LCH-15; else fail LCH-15 "rc=$RC"; fi
fi

if want LCH-16 "$only"; then
    new_case
    port=$(free_port)
    python3 - "$port" "$T/ready" <<'PYEOF' &
import socket, sys, time
s = socket.socket()
s.bind(("127.0.0.2", int(sys.argv[1])))
s.listen(1)
open(sys.argv[2], "w").close()
time.sleep(15)
PYEOF
    lp=$!
    for _ in $(seq 50); do [ -e "$T/ready" ] && break; sleep 0.1; done
    run_launcher "$T" --data-dir "$DATA" --no-browser --port "$port"
    kill "$lp" 2>/dev/null
    wait "$lp" 2>/dev/null
    if [ "$RC" = 4 ] && grep -q -- '--port' "$T/err" && ! log_has ' build ' \
        && ! log_has ' up ' && no_url; then pass LCH-16
    else fail LCH-16 "rc=$RC err=$ERR"; fi
fi

if want LCH-17 "$only"; then
    new_case
    canon=$(cd "$DATA" && pwd -P)
    me="$(id -u):$(id -g)"
    export STUB_PS_ID=abc123 STUB_LABEL_DATA="$canon" STUB_LABEL_PORT=8080 \
        STUB_LABEL_USER="$me" STUB_HEALTH=healthy
    run_launcher "$T" --data-dir "$DATA" --no-browser
    ok=0
    [ "$RC" = 0 ] && grep -q "$URL_RE:8080" "$T/out" && ! log_has ' build ' \
        && ! log_has ' up ' && ok=1
    : >"$STUB_LOG"
    run_launcher "$T" --data-dir "$DATA" --no-browser --rebuild
    { log_has ' build app' && log_has ' up '; } || ok=0
    unset STUB_PS_ID STUB_LABEL_DATA STUB_LABEL_PORT STUB_LABEL_USER STUB_HEALTH
    if [ "$ok" = 1 ]; then pass LCH-17; else fail LCH-17 "reuse wrong ok=$ok"; fi
fi

if want LCH-18 "$only"; then
    new_case
    canon=$(cd "$DATA" && pwd -P)
    user="$(id -u):$(id -g)"
    bad=0
    for variant in port data user; do
        d=$canon p=8080 u=$user
        case $variant in
            port) p=9999 ;;
            data) d=/some/other/dir ;;
            user) u=4242:4242 ;;
        esac
        : >"$STUB_LOG"
        STUB_PS_ID=abc123 STUB_LABEL_DATA=$d STUB_LABEL_PORT=$p STUB_LABEL_USER=$u \
            run_launcher "$T" --data-dir "$DATA" --no-browser
        { [ "$RC" = 5 ] && grep -q -- '--stop' "$T/err" && no_url \
            && ! log_has ' up ' && grep -q "$d" "$T/err"; } || bad=1
    done
    if [ "$bad" = 0 ]; then pass LCH-18; else fail LCH-18 "variant mishandled rc=$RC"; fi
fi

if want LCH-19 "$only"; then
    new_case
    run_launcher "$T" --stop
    ok=0
    [ "$RC" = 0 ] && log_has ' down' && ! grep -qE ' -v|volume' "$STUB_LOG" && ok=1
    run_launcher "$T" --stop --port 9000
    [ "$RC" = 2 ] || ok=0
    if [ "$ok" = 1 ]; then pass LCH-19; else fail LCH-19 "rc=$RC"; fi
fi

if want LCH-19b "$only"; then
    new_case
    make_opener "$T" 0
    run_launcher "$T" --data-dir "$DATA"
    c1=$(grep -c '^xdg-open' "$STUB_LOG" || true)
    : >"$STUB_LOG"
    run_launcher "$T" --data-dir "$DATA" --no-browser
    c2=$(grep -c '^xdg-open' "$STUB_LOG" || true)
    make_opener "$T" 1
    run_launcher "$T" --data-dir "$DATA"
    rc3=$RC
    rm -f "$T/bin/xdg-open"
    run_launcher "$T" --data-dir "$DATA"
    if [ "$c1" = 1 ] && [ "$c2" = 0 ] && [ "$rc3" = 0 ] && [ "$RC" = 0 ] \
        && grep -q "$URL_RE" "$T/out"; then pass LCH-19b
    else fail LCH-19b "c1=$c1 c2=$c2 rc3=$rc3 rc=$RC"; fi
fi

if want LCH-19c "$only"; then
    new_case
    STUB_ID_VALUE=1000 run_launcher "$T" --data-dir "$DATA" --no-browser
    ok=0
    grep -q 'GR_PCD_UID=1000 GR_PCD_GID=1000' "$STUB_LOG" && ok=1
    : >"$STUB_LOG"
    STUB_ID_VALUE=0 run_launcher "$T" --data-dir "$DATA" --no-browser
    { grep -q 'GR_PCD_UID=10001 GR_PCD_GID=10001' "$STUB_LOG" \
        && grep -qi root "$T/err"; } || ok=0
    if [ "$ok" = 1 ]; then pass LCH-19c; else fail LCH-19c "uid wiring"; fi
fi

if want LCH-19d "$only"; then
    new_case
    rc=$(STUB_UP_SLEEP=30 python3 - "$T" "$LCH_SCRIPT" "$DATA" <<'PYEOF'
import os, signal, subprocess, sys, time
t, script, data = sys.argv[1:4]
env = dict(os.environ, PATH=t + "/bin", GR_PCD_PORT_PROBE_HOST="127.0.0.2")
env.pop("DOCKER_HOST", None)
p = subprocess.Popen(
    ["/bin/bash", script, "--data-dir", data, "--no-browser"],
    stdout=open(t + "/out", "w"), stderr=open(t + "/err", "w"), env=env,
    start_new_session=True,
    preexec_fn=lambda: signal.signal(signal.SIGINT, signal.SIG_DFL),
)
time.sleep(2)
p.send_signal(signal.SIGINT)
try:
    rc = p.wait(timeout=10)
except subprocess.TimeoutExpired:
    rc = "timeout"
try:
    os.killpg(p.pid, signal.SIGKILL)
except ProcessLookupError:
    pass
print(rc)
PYEOF
    )
    if [ "$rc" = 130 ] && grep -q -- '--stop' "$T/err" \
        && ! grep -qE ' (down|stop)' "$STUB_LOG"; then pass LCH-19d
    else fail LCH-19d "rc=$rc err=$(cat "$T/err")"; fi
fi

exit "$failed"
