#!/usr/bin/env bash
# Browser smoke: real headless Chromium (Playwright image) against the app image.
# Separate compose profile `smoke`; not part of `verify`. Needs network once to pull images.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker/compose.yaml -p gr-pcd-smoke --profile smoke)
OUT="$(mktemp -d)"
cleanup() { "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true; rm -rf "$OUT"; }
trap cleanup EXIT
export SMOKE_OUT="$OUT"
chmod 777 "$OUT"
"${COMPOSE[@]}" build smoke-app
"${COMPOSE[@]}" up --wait -d smoke-app
rc=0
"${COMPOSE[@]}" run --rm smoke "$@" || rc=$?
if [ "${SMOKE_UPDATE_SCREENSHOT:-0}" = "1" ] && [ -f "$OUT/editor.png" ]; then
  mkdir -p docs/images
  cp "$OUT/editor.png" docs/images/editor.png
fi
exit "$rc"
