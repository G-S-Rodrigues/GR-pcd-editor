#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ruff check backend tests
ruff format --check backend tests
shellcheck gr-pcd-visualizer.sh scripts/*.sh tests/container/*.sh tests/launcher/*.sh
(cd frontend && node node_modules/typescript/bin/tsc --noEmit)
