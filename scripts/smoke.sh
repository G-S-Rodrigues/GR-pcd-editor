#!/usr/bin/env bash
# Browser smoke: real headless Chromium (Playwright image) against the app image.
# Separate compose profile `smoke`; not part of `verify`. Needs network once to pull images.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker/compose.yaml -p gr-pcd-smoke --profile smoke)
OUT="$(mktemp -d)"
# shellcheck disable=SC2317  # invoked through trap
cleanup() { "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true; rm -rf "$OUT"; }
trap cleanup EXIT
export SMOKE_OUT="$OUT"
chmod 777 "$OUT"
# synthetic mounted folder (ASCII PCD, nine points) for the mounted-browser check
export SMOKE_DATA="$OUT/data"
mkdir -p "$SMOKE_DATA/maps"
chmod 755 "$SMOKE_DATA" "$SMOKE_DATA/maps"
{
  printf '# .PCD v.7 - synthetic\nVERSION .7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\n'
  printf 'WIDTH 9\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS 9\nDATA ascii\n'
  for i in 0 1 2 3 4 5 6 7 8; do printf '%s %s 0\n' "$i" "$((i % 3))"; done
} >"$SMOKE_DATA/maps/nine.pcd"
chmod 644 "$SMOKE_DATA/maps/nine.pcd"
"${COMPOSE[@]}" build smoke-app
"${COMPOSE[@]}" up --wait -d smoke-app
rc=0
"${COMPOSE[@]}" run --rm smoke "$@" || rc=$?
if [ "${SMOKE_UPDATE_SCREENSHOT:-0}" = "1" ] && [ -f "$OUT/editor.png" ]; then
  mkdir -p docs/images
  cp "$OUT/editor.png" docs/images/editor.png
fi
if [ "${SMOKE_UPDATE_SCREENSHOT:-0}" = "1" ] && [ -f "$OUT/viewcube.png" ]; then
  mkdir -p docs/images
  cp "$OUT/viewcube.png" docs/images/viewcube.png
fi
# optional: keep every screenshot the smoke wrote (for looking at them)
if [ -n "${SMOKE_SHOTS_DIR:-}" ]; then
  mkdir -p "$SMOKE_SHOTS_DIR"
  cp "$OUT"/*.png "$SMOKE_SHOTS_DIR"/ 2>/dev/null || true
fi
exit "$rc"
