#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python -m pytest -q "$@"
(cd frontend && node node_modules/vitest/vitest.mjs run)
