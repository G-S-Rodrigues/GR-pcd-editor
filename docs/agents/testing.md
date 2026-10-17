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
bash tests/launcher/test_launcher.sh                # launcher, stub docker
bash tests/launcher/test_launcher_smoke.sh          # launcher, real Docker
```

- `verify` runs `scripts/verify.sh` (`pytest -q`).
- `lint` runs `scripts/lint.sh`: `ruff check`, `ruff format --check`,
  `shellcheck` on scripts and container tests, `tsc --noEmit`.
- The container tier needs Docker, curl and python3, uses project
  `gr-pcd-ctest-*` and port 18080 (override with `CTEST_PORT`), and removes
  only its own volume. The missing-data-dir refusal test (host-side `[ -d ]`
  check, nonzero exit, no directory created) is now LCH-01/LCH-26:
  Compose ignores `create_host_path: false`.
- `tests/launcher/test_launcher.sh` (LCH-01..19d) needs bash and python3 and
  uses a stub `docker`; it takes an optional ID filter (`... LCH-05`).
  `test_launcher_smoke.sh` (LCH-20..27) uses the real daemon, project
  `gr-pcd-ltest-*`, port 18081 (`LTEST_PORT`); never run it with the container
  tier at the same time.
- Single test: `docker compose -f docker/compose.yaml --profile checks run --rm verify scripts/verify.sh tests/unit/test_paths.py -k be_02`.
- Test IDs: `BE-` backend, `CTR-` container (`LCH-` launcher, later `PCD-`, `GEO-`,
  `UI-`). Name tests `test_be_02_...`.
- Ready gate: bootstrap contract + the three Compose commands + container tier + both
  launcher scripts.
