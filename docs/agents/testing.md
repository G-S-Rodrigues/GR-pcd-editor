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

- `verify` runs `scripts/verify.sh` (`pytest -q`, then vitest: `frontend/src/**/*.test.ts`,
  node environment, XHR and `document` faked).
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
- Test IDs: `BE-` backend, `CTR-` container, `LCH-` launcher, `PCD-` `GEO-` `EDT-`
  `CLU-` `SES-` `API-` PCD processing (below), later `UI-`. Name tests
  `test_be_02_...`.
- Ready gate: bootstrap contract + the three Compose commands + container tier + both
  launcher scripts.

## PCD processing tests and tolerance policy

Test ID prefixes for part 5: `PCD-` (parse/write), `GEO-` (geometry), `EDT-`
(selection/protection/history), `CLU-` (cluster), `SES-` (session/export/
archive), `API-` (HTTP). Test bytes come from `tests/fixtures/pcdgen.py`,
which imports no production code.

Tolerance policy (single module `backend/gr_pcd/geometry/tolerance.py`): all
predicates run in float64 on the exact stored coordinates, boundaries are
inclusive, and preview and commit share one path. World-axis tests use eps 0;
rotated-box extents and polygon edges use an absolute 1e-9; the cluster
radius uses a relative 1e-12. Tests keep near-boundary gaps at exactly 0
(dyadic coordinates) or >= 1e-6.

Part 5 files: `tests/unit/test_cluster.py` (CLU-), `test_session_engine.py`
(SES-01..14, 28..30), `test_archive.py` (SES-22..27),
`tests/integration/test_export_roundtrip.py` (SES-15..21) and
`tests/integration/test_api_session.py` (API-01..31, over a generated scene).
Shared helpers: `tests/fixtures/pcdgen.py` (independent byte builders and the
FLOOR/GHOST scene) and `tests/fixtures/sessions.py`. Single file:
`... run --rm verify scripts/verify.sh tests/integration/test_api_session.py -k api_12`.
`tests/` and `backend/` are baked into the checks image: rebuild before every
`run`. Host-only runs (`uv run --frozen pytest`) fail BE-12/BE-13 because the
built static assets exist only in the image.

HTTP contract notes: asynchronous work (select, candidate, export, save) answers
202 with a job; a failed job carries `error.code` (for example `invalid_seed`,
`component_limit_reached`). `PcdError`/`EditError`/`GeometryError`/archive
errors map to 422, `memory_budget_exceeded` to 413, stale revisions to 409.

## Files tests (part 4)

IDs: `FIL-` backend (`tests/unit/test_{names,files_settings,mounted,uploads,cleanup}.py`,
`tests/integration/test_{files_api,origin,upload_abort}.py`; `BE-06` path guard),
`CTR-08` (public port, Host guard, `/data` listing in `test_compose.sh`),
`FE-F-` frontend (`frontend/src/files/*.test.ts`, fakes in `src/files/testing/`).
Tests build clients with `make_client(app)` from `tests/fixtures/sessions.py`
(Host `localhost:8080`, required by the `/api` Host/Origin guard). FIL-05 skips
only when run as root (chmod 000 cannot deny root); FIL-05b covers the 403
mapping with a monkeypatched `PermissionError`. FIL-25 runs a real uvicorn
thread to prove disconnect cleanup. Single frontend run: add the vitest args
by running `node node_modules/vitest/vitest.mjs run <file>` in `frontend/`.

## Smoke (browser, part 6)

`bash scripts/smoke.sh` builds the app image (tag `gr-pcd-visualizer:smoke`),
starts it under compose project `gr-pcd-smoke` (profile `smoke`, tmpfs `/work`,
no published port) and runs Playwright `mcr.microsoft.com/playwright:v1.64.1-noble`
with `network_mode: service:smoke-app`, so the page is `http://localhost:8080`
(the Host guard only allows loopback). `e2e/node_modules` is installed once
with `docker run ... node:22-bookworm npm ci` in `e2e/`. WebGL spike result:
headless Chromium creates WebGL 2 through SwiftShader with
`--use-angle=swiftshader --use-gl=angle --enable-unsafe-swiftshader
--ignore-gpu-blocklist` (no fallback needed). Not part of `verify`.

Smoke specs: `e2e/smoke.spec.ts` (E2E-01/02: picker, mounted folder, drop, views,
pivot reset/XYZ/pick, colour options; no console errors; the startup `GET /api/session`
answers 200 `{"no_session": true}` since 7a-6). The cloud is generated in
`e2e/synthetic.ts`; the mounted folder is generated by `scripts/smoke.sh`.
6c adds the "6c real UI" spec (E2E-03..09): box numbers and exact counts, global
protection, a stale preview after a filter change, apply/undo/redo, overlay and
split comparison with hold-`O`, the export dialog (the download event, the filename
`synthetic_cleaned.pcd` and the bytes re-parsed with an independent reader in
`e2e/synthetic.ts` against the fixture truth), the session download
(`*.pcdsession`) reopened through the picker (counts and colouring restored), and
a real `beforeunload` dialog on a second tab while edits are unsaved (none after
saving). `SMOKE_UPDATE_SCREENSHOT=1` copies the screenshot to `docs/images/editor.png`.
The beforeunload dialog needs a user gesture on the page and is checked on a
second tab because dismissing it on the working page closes it in headless Chromium.
Frontend single file: `docker run --rm -u "$(id -u):$(id -g)" -v "$PWD/frontend:/w" -w /w node:22-bookworm node node_modules/vitest/vitest.mjs run src/compare`
(the checks image is the gate; this is a fast loop that does not need a rebuild).
Frontend test IDs: `UI-01..26` (6a), `UI-30..79` (6b), `UI-80..95` (6c: compare,
export, save, persist, unsaved, tooltips), under `frontend/src/**`; backend render
`attr` tests are `API-40..43` in `tests/integration/test_api_session.py`.

## Part 7 additions (7a, 7b)

- Frontend IDs: `UI-100..115` (7a: invalidation, Box start, cluster, persistence,
  errors), `UI-120..125` (selection helpers), `UI-127..129` (headline, legend,
  budget label), `UI-130..133` (ViewCube, keys), `UI-134..135` (slice),
  `UI-140..141` (single key table: no duplicates, every documented key
  classifies to its handler, `?` toggles help), `UI-142` (handle size in
  pixels), `UI-143` (draft text and outline), `UI-144` (upload cancel),
  `UI-145` (a restored page keeps the view only: op, scope and tool are not
  restored), `UI-146` (start banner).
- Backend IDs: `API-50..53` (stale displayed selection, cluster partial result,
  `GET /api/session` answers 200 `{"no_session": true}` without a session, render
  sampled to the exact budget), `CLU-20..23`.
- Cluster timing target (`test_clu_22_room_timing`): whole synthetic room (300k
  points, r 0.5) in at most 3 s on the checks image (the ghost component in 1.5 s; tightened in 7c-1 from 12 s and 3 s); raise it only with a
  recorded measurement, never skip.
- Smoke: `E2E-10..19` (7a, 7b-1), `E2E-20` (help overlay: `?`, the button, Esc,
  typing a `?` in a field does nothing), `E2E-21` (no overflow and a viewport of
  at least 60 % of the width at 1280x720 and 1920x1080, with a field focused and
  each tool panel open; screenshots `layout-1280.png`, `layout-1920.png` go to
  the smoke output), `E2E-22` (upload cancel on a held-back request), `E2E-23`
  (draft outline note), `E2E-24` (a reloaded session starts Replace, Displayed,
  no tool, default cluster limit), `E2E-24b` (start banner with no session).
  `SMOKE_SHOTS_DIR=<dir> bash scripts/smoke.sh` keeps every screenshot to look at.
  Run a subset with `bash scripts/smoke.sh npx playwright test -g "E2E-2[01]"`.
- Fast loop for vitest and `tsc` without a rebuild: bind-mount `frontend/src`
  over the checks image, e.g. `docker run --rm --network none -v "$PWD/frontend/src:/app/frontend/src:ro" gr-pcd-visualizer:checks bash -c "cd frontend && node node_modules/vitest/vitest.mjs run"`.

## Part 7c-1 additions (cluster engine, process bounds)

- `CLU-30..36` (oracle fuzz against the old BFS, dyadic gaps, boundary, partial, cancel,
  `radius_too_small`) in `tests/unit/test_cluster.py`; `CLU-40..43` (time and peak RSS in a
  fresh process, `RLIMIT_AS` 3 GiB, 120 s timeout counts as failure) in
  `tests/unit/test_cluster_perf.py` via `tests/fixtures/rss.py`. Measured: 331k points r 0.5..5
  in 0.5-1.3 s and <= 315 MiB; 993k r 0.5 in 2.7 s and 177 MiB. Raise a bound only with a
  recorded measurement, never skip.
- `SES-40..43` in `tests/unit/test_job_guards.py` (cgroup budget, RSS guard, generic
  `internal_error`, orphan sweeper with an injected clock; `JobManager(sweep=False)` in tests),
  `UI-150/151` (cluster error text, pagehide beacon), `CTR-09` (compose `mem_limit` 6g,
  `memswap_limit`, `pids_limit` 256, `init`), smoke `E2E-25` (300k room, cluster r=2, Apply).
- Run backend tests under a memory cap without rebuilding: `docker run --rm --network none -m 6g
  --memory-swap 6g -v "$PWD/tests:/app/tests:ro" -v "$PWD/backend:/app/backend:ro"
  gr-pcd-visualizer:checks python -m pytest -q <args>`. The compose `verify` service has no cap.
- A stale checks image runs old code against new tests (a hung 993k cluster once held the
  suite for minutes): rebuild (`build --no-cache verify lint`) before the gate.

## Part 7c-2 additions (session identity, minors)

- Session identity: `X-Session-Id` is optional on the server and checked on every `/api`
  route except `GET /api/session`, open, open-archive, upload and mounted; a mismatch (or no
  session) answers 409 `session_changed` with the current `session_id`. Tests: `API-60..62`,
  `SES-44` (`tests/integration/test_session_identity.py`), `UI-152..156`
  (`frontend/src/files/session-id.test.ts`, `orchestration/session-sync.test.ts`), smoke `E2E-26`
  (two tabs on one app). The render cache key is session id + revision + selection id (not count).
- ASCII import guard: `ASCII_EXPANSION = 10` x payload bytes added to the estimate before any
  token is parsed; measured peak 420 MB over base for 1M points (estimate 587 MB), `PCD-60/61`
  in `tests/unit/test_ascii_guard.py`.
- Minors in `tests/unit/test_minors_7c2.py`: `PCD-62`, `API-63` (hostile header numbers),
  `SES-45` (free-space refusal, ENOSPC -> `storage_full`), `SES-46` (opens serialised),
  `SES-47` (cancelled running job never completes), `FIL-40` (fullmatch). `UI-157` is
  `state/persist-corrupt.test.ts`; `LCH-28/29` in `tests/launcher/test_launcher.sh` (the stub
  docker answers `STUB_IMAGE_ID` and `STUB_CONTAINER_IMAGE`). The upload XHR sends no session
  header: upload and open are exempt because they replace the session.
