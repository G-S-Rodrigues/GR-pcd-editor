#!/usr/bin/env bash
# Container-tier checks CTR-01..05, CTR-07, CTR-08 and CTR-09 (CTR-06 is LCH-01/LCH-26).
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

tmp=$(mktemp -d)
data_dir="$tmp/data"
mkdir -p "$data_dir/maps dir"
chmod 755 "$tmp" "$data_dir" "$data_dir/maps dir"
echo "synthetic source record" >"$data_dir/maps dir/source.txt"
chmod 644 "$data_dir/maps dir/source.txt"
printf 'synthetic' >"$data_dir/scan.pcd"
chmod 644 "$data_dir/scan.pcd"
src_sha=$(sha256sum "$data_dir/maps dir/source.txt" | cut -d' ' -f1)

dc() {
    GR_PCD_DATA_DIR="$data_dir" GR_PCD_PORT="$port" \
        docker compose -p "$project" -f "$compose_file" "$@"
}

# shellcheck disable=SC2317 # invoked via trap
cleanup() {
    dc down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$tmp"
}
trap cleanup EXIT

pass() { echo "PASS $1"; }
fail() {
    echo "FAIL $1: $2"
    failed=1
}

# CTR-01 compose config (incl. user and labels)
if dc --profile checks config --format json | python3 -c '
import json, sys
port = sys.argv[1]
cfg = json.load(sys.stdin)["services"]
app = cfg["app"]
assert len(app["ports"]) == 1, app["ports"]
p = app["ports"][0]
assert p["host_ip"] == "127.0.0.1" and str(p["published"]) == port, p
assert p["target"] == 8080, p
vols = {v["target"]: v for v in app["volumes"]}
assert vols["/data"]["type"] == "bind" and vols["/data"]["read_only"] is True
assert vols["/work"]["type"] == "volume"
assert "profiles" not in app
assert app["user"] == "10001:10001", app.get("user")
lab = app["labels"]
assert lab["gr-pcd.port"] == port, lab
assert lab["gr-pcd.data-dir"] and lab["gr-pcd.user"] == "10001:10001", lab
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

# CTR-04 /data read-only
after=$(sha256sum "$data_dir/maps dir/source.txt" | cut -d' ' -f1)
if ! dc exec -T app sh -c 'touch "/data/maps dir/x"' >/dev/null 2>&1 \
    && [ "$after" = "$src_sha" ] && [ ! -e "$data_dir/maps dir/x" ]; then
    pass CTR-04
else
    fail CTR-04 "/data was writable or source changed"
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

# CTR-08 public port reaches the app, Host guard, read-only mount listing
evil=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' \
    "http://127.0.0.1:$port/api/session" || true)
if [ "$(dc config --format json | python3 -c '
import json, sys
print(json.load(sys.stdin)["services"]["app"]["environment"]["GR_PCD_PUBLIC_PORT"])
')" = "$port" ] \
    && [ "$evil" = "403" ] \
    && curl -fsS "http://127.0.0.1:$port/api/mounted" \
    | python3 -c '
import json, sys
names = [e["name"] for e in json.load(sys.stdin)["entries"]]
assert names == ["maps dir", "scan.pcd"], names
'; then
    pass CTR-08
else
    fail CTR-08 "public port env, Host guard (got $evil) or /data listing"
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
