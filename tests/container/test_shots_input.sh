#!/usr/bin/env bash
# CTR-13: scripts/smoke.sh mounts one optional PCD read-only at /in/cloud.pcd when GR_PCD_SHOTS_PCD names an
# absolute existing file (the README shots tool), exits 2 before any docker call otherwise, and is unchanged when unset.
# Static: `docker` is a recording stub on PATH, nothing is started.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
failed=0
ok() { echo "PASS CTR-13 $1"; }
bad() { echo "FAIL CTR-13 $1: $2"; failed=1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
log="$work/docker.log"
cat > "$work/bin/docker" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$log"
exit 0
STUB
chmod +x "$work/bin/docker"

# run_smoke <cwd> <VAR=value|-> args...: runs smoke.sh under the stub; sets rc and leaves the argv log in \$log.
run_smoke() {
    local cwd=$1 shots=$2
    shift 2
    : > "$log"
    rc=0
    if [ "$shots" = "-" ]; then
        (cd "$cwd" && env -u GR_PCD_SHOTS_PCD -u SMOKE_SHOTS_DIR -u SMOKE_UPDATE_SCREENSHOT -u GR_PCD_SMOKE_PROJECT -u GR_PCD_SMOKE_IMAGE \
            PATH="$work/bin:$PATH" bash "$root/scripts/smoke.sh" "$@") >/dev/null 2>&1 || rc=$?
    else
        (cd "$cwd" && env -u SMOKE_SHOTS_DIR -u SMOKE_UPDATE_SCREENSHOT -u GR_PCD_SMOKE_PROJECT -u GR_PCD_SMOKE_IMAGE \
            GR_PCD_SHOTS_PCD="$shots" PATH="$work/bin:$PATH" bash "$root/scripts/smoke.sh" "$@") >/dev/null 2>&1 || rc=$?
    fi
}
run_line() { grep ' run --rm ' "$log" || true; }

# 1. unset: the run line is exactly the old one (guard leg)
run_smoke "$work" - npx playwright test --workers=1
want='compose -f docker/compose.yaml -p gr-pcd-smoke --profile smoke run --rm smoke npx playwright test --workers=1'
if [ "$rc" = 0 ] && [ "$(run_line)" = "$want" ]; then ok "unset: run line unchanged"; else bad "unset" "rc=$rc run line: $(run_line)"; fi

# 2. missing file: exit 2, no docker call
run_smoke "$work" /nonexistent/x.pcd npx playwright test
if [ "$rc" = 2 ] && [ ! -s "$log" ]; then ok "missing: exit 2, no docker call"; else bad "missing" "exit $rc, $(wc -l < "$log") docker calls"; fi

# 3. relative path (a relative -v source would be a named volume): exit 2, no docker call
: > "$work/x.pcd"
run_smoke "$work" x.pcd npx playwright test
if [ "$rc" = 2 ] && [ ! -s "$log" ]; then ok "relative: exit 2, no docker call"; else bad "relative" "exit $rc, $(wc -l < "$log") docker calls"; fi

# 4. absolute existing file: mounted read-only on the run line only
run_smoke "$work" "$work/x.pcd" npx playwright test
line=$(run_line)
case "$line" in
    *" run --rm -v $work/x.pcd:/in/cloud.pcd:ro -e GR_PCD_SHOTS_PCD=/in/cloud.pcd smoke "*) mounted=1 ;;
    *) mounted=0 ;;
esac
others=$(grep -v ' run --rm ' "$log" | grep -c '/in/cloud.pcd' || true)
if [ "$rc" = 0 ] && [ "$mounted" = 1 ] && [ "$others" = 0 ]; then ok "file: mount on the run line only"; else bad "file" "no /in/cloud.pcd in the run line (rc=$rc): $line"; fi
exit "$failed"
