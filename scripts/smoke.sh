#!/usr/bin/env bash
# Browser smoke: real headless Chromium (Playwright image) against the app image.
# Separate compose profile `smoke`; not part of `verify`. Needs network once to pull images.
set -euo pipefail
cd "$(dirname "$0")/.."
# Per-run names (defaults unchanged) so two concurrent smoke runs do not collide:
# GR_PCD_SMOKE_PROJECT is the compose project, GR_PCD_SMOKE_IMAGE the smoke-app image tag.
# GR_PCD_SHOTS_PCD (optional, README shots tool): an absolute path to a PCD, mounted read-only at /in/cloud.pcd.
# Absolute because Docker reads a relative -v source as a named volume; checked before any docker call.
RUN_ARGS=()
if [ -n "${GR_PCD_SHOTS_PCD:-}" ]; then
  case "$GR_PCD_SHOTS_PCD" in
    /*) ;;
    *) echo "GR_PCD_SHOTS_PCD must be an absolute path: $GR_PCD_SHOTS_PCD" >&2; exit 2 ;;
  esac
  [ -f "$GR_PCD_SHOTS_PCD" ] || { echo "GR_PCD_SHOTS_PCD is not a file: $GR_PCD_SHOTS_PCD" >&2; exit 2; }
  RUN_ARGS=(-v "$GR_PCD_SHOTS_PCD:/in/cloud.pcd:ro" -e GR_PCD_SHOTS_PCD=/in/cloud.pcd)
fi
PROJECT="${GR_PCD_SMOKE_PROJECT:-gr-pcd-smoke}"
export GR_PCD_SMOKE_IMAGE="${GR_PCD_SMOKE_IMAGE:-gr-pcd-visualizer:smoke}"
COMPOSE=(docker compose -f docker/compose.yaml -p "$PROJECT" --profile smoke)
OUT="$(mktemp -d)"
# shellcheck disable=SC2317  # invoked through trap
cleanup() { "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true; rm -rf "$OUT"; }
trap cleanup EXIT
export SMOKE_OUT="$OUT"
chmod 777 "$OUT"
"${COMPOSE[@]}" build smoke-app
"${COMPOSE[@]}" up --wait -d smoke-app
rc=0
"${COMPOSE[@]}" run --rm "${RUN_ARGS[@]}" smoke "$@" || rc=$?
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
