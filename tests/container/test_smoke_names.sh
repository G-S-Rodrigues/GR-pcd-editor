#!/usr/bin/env bash
# CTR-12: scripts/smoke.sh takes its compose project and image name from
# GR_PCD_SMOKE_PROJECT / GR_PCD_SMOKE_IMAGE (defaults gr-pcd-smoke and
# gr-pcd-visualizer:smoke), so two concurrent smoke runs do not collide.
# Static: reads `docker compose config`, starts nothing.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
failed=0
img() { docker compose -f "$root/docker/compose.yaml" --profile smoke config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["smoke-app"]["image"])'; }
ok() { echo "PASS CTR-12 $1"; }
bad() { echo "FAIL CTR-12 $1: $2"; failed=1; }

[ "$(env -u GR_PCD_SMOKE_IMAGE bash -c "$(declare -f img); root='$root'; img")" = "gr-pcd-visualizer:smoke" ] \
    && ok "default image" || bad "default image" "compose smoke-app image is not gr-pcd-visualizer:smoke"
[ "$(GR_PCD_SMOKE_IMAGE=gr-pcd-visualizer:smoke-x bash -c "$(declare -f img); root='$root'; img")" = "gr-pcd-visualizer:smoke-x" ] \
    && ok "image from env" || bad "image from env" "GR_PCD_SMOKE_IMAGE is not used by compose"
grep -q 'GR_PCD_SMOKE_PROJECT:-gr-pcd-smoke}' "$root/scripts/smoke.sh" \
    && grep -q 'GR_PCD_SMOKE_IMAGE:-gr-pcd-visualizer:smoke}' "$root/scripts/smoke.sh" \
    && grep -q -- '-p "\$PROJECT"' "$root/scripts/smoke.sh" \
    && ! grep -q -- '-p gr-pcd-smoke' "$root/scripts/smoke.sh" \
    && ok "smoke.sh defaults and -p" || bad "smoke.sh" "project/image defaults or -p \$PROJECT missing"
exit "$failed"
