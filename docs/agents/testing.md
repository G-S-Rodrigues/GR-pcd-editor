# Testing

## Where commands run

There is no devcontainer. Commands run on the host and drive Docker; the
checks themselves run inside the `checks` image (no network). Host `npm` is a
Windows binary: use a node container for frontend lockfile work, e.g.
`docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/frontend:/w" -w /w node:22-bookworm npm install --save-exact <pkg>`.
Python lockfile: `uv add ...` on the host updates `pyproject.toml`/`uv.lock`.

## Checks

```sh
bash scripts/check-bootstrap-contract.sh            # never --staged after Part 1
docker compose -f docker/compose.yaml --profile checks build verify lint
docker compose -f docker/compose.yaml --profile checks run --rm verify
docker compose -f docker/compose.yaml --profile checks run --rm lint
bash tests/container/test_compose.sh                # container tier
```

- `verify` runs `scripts/verify.sh` (`pytest -q`).
- `lint` runs `scripts/lint.sh`: `ruff check`, `ruff format --check`,
  `shellcheck` on scripts and container tests, `tsc --noEmit`.
- The container tier needs Docker, curl and python3, uses project
  `gr-pcd-ctest-*` and port 18080 (override with `CTEST_PORT`), and removes
  only its own volume. The missing-data-dir refusal test (host-side `[ -d ]`
  check, nonzero exit, no directory created) is owned by part 3's launcher:
  Compose ignores `create_host_path: false`.
- Single test: `docker compose -f docker/compose.yaml --profile checks run --rm verify scripts/verify.sh tests/unit/test_paths.py -k be_02`.
- Test IDs: `BE-` backend, `CTR-` container (later `LCH-`, `PCD-`, `GEO-`,
  `UI-`). Name tests `test_be_02_...`.
- Ready gate: bootstrap contract + the three Compose commands + container tier.
