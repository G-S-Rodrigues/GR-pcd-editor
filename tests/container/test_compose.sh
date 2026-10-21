#!/usr/bin/env bash
# Container-tier checks CTR-01..05, CTR-07, CTR-08, CTR-09, CTR-10 and CTR-11 (CTR-06 went with the mounted folder).
# Needs docker, curl and python3.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
compose_file="$root/docker/compose.yaml"
port="${CTEST_PORT:-18080}"
project="gr-pcd-ctest-$$"
failed=0

for tool in docker curl python3; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "FAIL: required tool '$tool' not found on the host"
        exit 1
    fi
done

dc() {
    GR_PCD_PORT="$port" docker compose -p "$project" -f "$compose_file" "$@"
}

# shellcheck disable=SC2317 # invoked via trap
cleanup() {
    dc down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

pass() { echo "PASS $1"; }
fail() {
    echo "FAIL $1: $2"
    failed=1
}

# CTR-01 compose config (incl. user and labels)
if dc --profile checks --profile smoke config --format json | python3 -c '
import json, sys
port = sys.argv[1]
cfg = json.load(sys.stdin)["services"]
app = cfg["app"]
assert len(app["ports"]) == 1, app["ports"]
p = app["ports"][0]
assert p["host_ip"] == "127.0.0.1" and str(p["published"]) == port, p
assert p["target"] == 8080, p
vols = {v["target"]: v for v in app["volumes"]}
assert "/data" not in vols, vols
assert vols["/work"]["type"] == "volume"
assert "profiles" not in app
assert app["user"] == "10001:10001", app.get("user")
lab = app["labels"]
assert lab["gr-pcd.port"] == port, lab
assert "gr-pcd.data-dir" not in lab and lab["gr-pcd.user"] == "10001:10001", lab
for name in ("app", "smoke-app"):
    svc = cfg[name]
    assert svc["read_only"] is True and svc["init"] is True, name
    assert svc["pids_limit"] == 256 and svc["cap_drop"] == ["ALL"], name
    assert svc["security_opt"] == ["no-new-privileges:true"], name
    assert svc["mem_limit"] == svc["memswap_limit"], name
    assert "/data" not in {v["target"] for v in svc.get("volumes", [])}, name
for name in ("verify", "lint"):
    assert cfg[name]["profiles"] == ["checks"], name
' "$port" \
    && GR_PCD_UID=1234 GR_PCD_GID=5678 dc config --format json | python3 -c '
import json, sys
app = json.load(sys.stdin)["services"]["app"]
assert app["user"] == "1234:5678", app["user"]
assert app["labels"]["gr-pcd.user"] == "1234:5678", app["labels"]
'; then pass CTR-01; else fail CTR-01 "compose config"; fi

# CTR-02 up and healthy (build first: the image bakes in backend/)
dc build app >/dev/null 2>&1 || true
if dc up -d --wait --wait-timeout 60 app >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:$port/health" | grep -q '"status":"ok"' \
    && curl -fsS "http://127.0.0.1:$port/" | grep -q 'data-app="gr-pcd-editor"' \
    && dc port app 8080 | grep -q '^127\.0\.0\.1:'; then
    pass CTR-02
else
    fail CTR-02 "app did not become healthy / serve on 127.0.0.1"
fi

# CTR-03 unprivileged and /work writable
uid=$(dc exec -T app id -u 2>/dev/null || echo 0)
if [ "$uid" != "0" ] \
    && dc exec -T app sh -c 'echo m > /work/marker' >/dev/null 2>&1; then
    pass CTR-03
else
    fail CTR-03 "uid=$uid or /work not writable"
fi

# CTR-04 root filesystem read-only and no /data in the container
if ! dc exec -T app sh -c 'touch /rootfs-probe' >/dev/null 2>&1 \
    && ! dc exec -T app test -e /data >/dev/null 2>&1; then
    pass CTR-04
else
    fail CTR-04 "root filesystem writable or /data present"
fi

# CTR-05 work volume survives down + up
dc down >/dev/null 2>&1
if dc up -d --wait --wait-timeout 60 app >/dev/null 2>&1 \
    && [ "$(dc exec -T app cat /work/marker 2>/dev/null)" = "m" ]; then
    pass CTR-05
else
    fail CTR-05 "marker lost after recreate"
fi

# CTR-09 process bounds: memory (no swap beyond it), pids, init
cid=$(dc ps -q app 2>/dev/null || true)
bounds=$(docker inspect -f '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.PidsLimit}} {{.HostConfig.Init}}' "$cid" 2>/dev/null || true)
if [ "$bounds" = "6442450944 6442450944 256 true" ]; then
    pass CTR-09
else
    fail CTR-09 "mem/swap/pids/init = '$bounds'"
fi

# CTR-10 /tmp tmpfs is capped (counts against the memory limit) and the app sends security headers
tmpfs=$(docker inspect -f '{{index .HostConfig.Tmpfs "/tmp"}}' "$cid" 2>/dev/null || true)
hdrs=$(curl -sS -D - -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null | tr -d '\r' | tr '[:upper:]' '[:lower:]' || true)
if printf '%s' "$tmpfs" | grep -q 'size=256m' \
    && printf '%s' "$hdrs" | grep -q "^content-security-policy: default-src 'self'" \
    && printf '%s' "$hdrs" | grep -q '^x-frame-options: deny'; then
    pass CTR-10
else
    fail CTR-10 "tmpfs='$tmpfs' or security headers missing"
fi

# CTR-08 public port reaches the app, Host guard, no mounted listing
mounted=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/mounted" || true)
evil=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' \
    "http://127.0.0.1:$port/api/session" || true)
if [ "$(dc config --format json | python3 -c '
import json, sys
print(json.load(sys.stdin)["services"]["app"]["environment"]["GR_PCD_PUBLIC_PORT"])
')" = "$port" ] \
    && [ "$evil" = "403" ] \
    && [ "$mounted" != "200" ]; then
    pass CTR-08
else
    fail CTR-08 "public port env, Host guard (got $evil) or /api/mounted (got $mounted)"
fi

# CTR-11 a work volume with sub folders left by another uid (root, 0755) still opens a file
vol=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/work"}}{{.Name}}{{end}}{{end}}' "$cid" 2>/dev/null || true)
pcd=$(mktemp)
python3 - "$pcd" <<'PY'
import struct, sys
n = 100
head = (
    "VERSION .7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\n"
    f"WIDTH {n}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS {n}\nDATA binary\n"
)
body = b"".join(struct.pack("<fff", i, i % 7, i / 9) for i in range(n))
open(sys.argv[1], "wb").write(head.encode() + body)
PY
if [ -n "$vol" ]; then
    docker run --rm -u 0 --entrypoint sh -v "$vol:/work" gr-pcd-visualizer:local -c \
        'mkdir -p /work/uploads /work/sessions /work/exports /work/session-archives; chown 0:0 /work/uploads /work/sessions /work/exports /work/session-archives; chmod 755 /work/uploads /work/sessions /work/exports /work/session-archives' >/dev/null 2>&1 || true
fi
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST --data-binary "@$pcd" \
    -H 'Content-Type: application/octet-stream' \
    "http://127.0.0.1:$port/api/session/upload?upload_id=0123456789abcdef0123456789abcdef&filename=t.pcd&replace=true" || true)
rm -f "$pcd"
# export, then download it: the file lands in exports.u<uid> and must still be served
exp_code=000
exp_same=no
if [ "$code" = "200" ]; then
    job=$(curl -s -X POST -H 'Content-Type: application/json' \
        -d '{"format":"binary","scope":"active"}' "http://127.0.0.1:$port/api/session/export" |
        python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' || true)
    eid=""
    for _ in $(seq 1 100); do
        eid=$(curl -s "http://127.0.0.1:$port/api/jobs/$job" | python3 -c '
import json, sys
j = json.load(sys.stdin)
print((j.get("result") or {}).get("export_id", "") if j["status"] == "complete" else "")' || true)
        [ -n "$eid" ] && break
        sleep 0.2
    done
    if [ -n "$eid" ]; then
        out=$(mktemp)
        exp_code=$(curl -s -o "$out" -w '%{http_code}' "http://127.0.0.1:$port/api/exports/$eid" || true)
        disk=$(docker exec "$cid" sh -c "cat /work/exports.u*/$eid.pcd | sha256sum | cut -d' ' -f1" 2>/dev/null || true)
        got=$(sha256sum "$out" | cut -d' ' -f1)
        [ -n "$disk" ] && [ "$disk" = "$got" ] && exp_same=yes
        rm -f "$out"
    fi
fi
if [ -n "$vol" ] && [ "$code" = "200" ] && [ "$exp_code" = "200" ] && [ "$exp_same" = "yes" ]; then
    pass CTR-11
else
    fail CTR-11 "volume='$vol' upload=$code export download=$exp_code identical=$exp_same (stale root-owned /work dirs)"
fi

# CTR-07 failures propagate (AC-31), then clean runs pass
tree_copy='rm -rf /tmp/a && cp -r /app /tmp/a'
rc=0
dc --profile checks run --rm verify bash -c "$tree_copy \
    && printf 'def test_deliberate():\n    assert False\n' \
    > /tmp/a/tests/unit/test_deliberate_fail.py \
    && /tmp/a/scripts/verify.sh" >/dev/null 2>&1 || rc=$?
rc2=0
dc --profile checks run --rm lint bash -c "$tree_copy \
    && printf 'x=1;y = 2\n' >> /tmp/a/backend/gr_pcd/__init__.py \
    && /tmp/a/scripts/lint.sh" >/dev/null 2>&1 || rc2=$?
rc3=0
dc --profile checks run --rm verify >/dev/null 2>&1 || rc3=$?
rc4=0
dc --profile checks run --rm lint >/dev/null 2>&1 || rc4=$?
if [ "$rc" -ne 0 ] && [ "$rc2" -ne 0 ] && [ "$rc3" -eq 0 ] \
    && [ "$rc4" -eq 0 ]; then
    pass CTR-07
else
    fail CTR-07 "exit codes verify-bad=$rc lint-bad=$rc2 verify=$rc3 lint=$rc4"
fi

exit "$failed"
