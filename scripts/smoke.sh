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
# compose still binds a /data source until 8-3 removes it; keep it an empty folder
export SMOKE_DATA="$OUT/data"
mkdir -p "$SMOKE_DATA"
chmod 755 "$SMOKE_DATA"
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
