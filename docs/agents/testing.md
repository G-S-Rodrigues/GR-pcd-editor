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
  only its own volume. There is no data folder any more (part 8): CTR-01 asserts
  no `/data` volume or label, CTR-04 a read-only root filesystem with no `/data`.
- `tests/launcher/test_launcher.sh` (LCH-04..19d, 28..31) needs bash and python3 and
  uses a stub `docker`; it takes an optional ID filter (`... LCH-05`).
  `test_launcher_smoke.sh` (LCH-20..25, 27) uses the real daemon, project
  `gr-pcd-ltest-*`, port 18081 (`LTEST_PORT`); never run it with the container
  tier at the same time.
- Single test: `docker compose -f docker/compose.yaml --profile checks run --rm verify scripts/verify.sh tests/unit/test_files_settings.py -k be_14`.
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

IDs: `FIL-` backend (`tests/unit/test_{names,files_settings,uploads,cleanup}.py`,
`tests/integration/test_{files_api,origin,upload_abort}.py`),
`CTR-08` (public port, Host guard, `/api/mounted` not 200 in `test_compose.sh`),
`FE-F-` frontend (`frontend/src/files/*.test.ts`, fakes in `src/files/testing/`).
Every test that needs an open session posts the file to the upload route with
`open_via_upload(client, path, replace=...)` (`tests/fixtures/sessions.py`;
`fixture_dir(settings)` is the scratch folder the generated files live in; the
app does not know it). Tests build clients with `make_client(app)` from `tests/fixtures/sessions.py`
(Host `localhost:8080`, required by the `/api` Host/Origin guard). A `PermissionError` is
an `OSError`; it maps to the specific `permission_denied` 500 (path, uid and fix named; the 403
`mount_unreadable` mapping went with the mounted folder). `WRK-01..06` (`tests/unit/test_workdir.py`): a work
volume whose `uploads`/`sessions` were made by another uid (0755) still opens a file through the per-uid fallback
`<sub>.u<uid>`; an unwritable `/work` gives `work_volume_not_writable`. `CTR-11` is the same with a real volume. FIL-25 runs a real uvicorn
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

Smoke specs: `e2e/smoke.spec.ts` (E2E-01/02: picker, drop, views,
pivot reset/XYZ/pick, colour options; no console errors; the startup `GET /api/session`
answers 200 `{"no_session": true}` since 7a-6). The cloud is generated in
`e2e/synthetic.ts`; `scripts/smoke.sh` generates no data folder.
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
  route except `GET /api/session` and upload; a mismatch (or no
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

## Part 7c-3 additions (ghost-cleanup UX)

- Fit displayed is outward-safe: the backend box predicate is `|p - centre| <= dims/2 + eps` (eps 0 for
  world-aligned boxes), so a rounded centre/size can miss a boundary point by one ulp. `fitToBounds`
  widens by max(ulp(size), ulp(centre)) steps until the predicate holds. Tests: `API-64`, `E2E-27/29/30`,
  `UI-160/161/164/165`. "Also delete the kept points" sets a protection override outside the cloud z-range
  with ack (no backend change); it resets after Apply.
- Interaction LOD: while the camera moves at most 150k stride points plus selected points (capped 50k) are
  drawn; the full draw returns 250 ms after the last change. `UI-162/163`, `E2E-28` (reads
  `window.__editor.drawnCount()`).
- Notices: timers are per id, successful opens clear stale open/drop notices, an empty cloud warns
  (`UI-166..168`); rotation rings are clamped to 90 px / 30% of the view (`UI-169`); the floor-pick hint
  (`UI-170`), the Protection slab legend entry (`UI-171`, `UI-128` extended with the `slab` id/label) and the
  10 s slow-job hint (`UI-173`, `orchestration/jobhint.ts`); smoke `E2E-31`.
- Not done: label dedup (`UI-172`) would change existing asserts outside the ruling; needs a ruling.

## Part 8 additions (mounted folder removed)

- New: `UI-174` (no `open-mounted`/`mounted-` control or tooltip), `E2E-32` (no mounted control on
  the page), `API-65` (`/api/mounted` 404, open and open-archive routes gone), `API-66` (upload
  ignores a stale `X-Session-Id`), `BE-14` (no `data_root` setting), `BE-07b` (health reports no
  data-folder problem), `LCH-30` (`--data-dir` and `--data-dir=` exit 2 with a "was removed" hint,
  no docker call), `LCH-31` (a healthy container of an earlier build, with the `gr-pcd.data-dir`
  label, is recreated, not reused; the first manual check showed it was reused).
- Removed with the feature: `BE-01..BE-06` in `test_paths.py` (the health tests `test_be_06` ok, `08`, `09`
  stay) and the health data-folder test `BE-07`, `FIL-01..05`, `FIL-01b`, `FIL-05b`, `FIL-14`, `FE-F-11`, `FE-F-12` and the
  FE path-escape test, `LCH-01`, `02`, `03`, `06`, `07`, `26`, the mounted `E2E-01`.
- Changed: `FIL-00` (no `data_root` tail), `API-03`, `API-29` (upload failures), `UI-21`, `LCH-05`,
  `LCH-17/18`, `LCH-20/22/25`, `CTR-01`, `CTR-04`, `CTR-08`.

## Part 9 additions (final polish)

- `SEC-01` (`tests/integration/test_app_http.py`): CSP, `X-Frame-Options: DENY`, nosniff and
  `Referrer-Policy` on static, health, API, 404 and the 403 guard answer (`api/security.py`, outermost
  middleware). The CSP allows inline styles only (`style-src 'unsafe-inline'`, the app's `<style>`); scripts are
  `'self'`. `CTR-10` (container tier): the `/tmp` tmpfs has `size=256m` and the running app sends the headers.
  Smoke `E2E-34` (no CSP console message while a cloud loads and draws), `E2E-33` (canvas role and label,
  notices live region).
- `BUD-01..03` (`tests/unit/test_budget_text.py`): budget refusals read in MiB/GiB and an import refusal says the
  file is not corrupt. `UI-185`: the open toast shows that text without the "valid PCD?" hint.
- `UI-180/182` (confirm checks the session first), `UI-181` (double Apply), `UI-183` (Rendered text, changed
  `UI-23`), `UI-184` (Protected shows `updating…` until the server has the picked floor), `UI-187` (Rect tooltip).
- Deliberately not done: pick-floor hint in Top/Bottom (m-2: smoke `E2E-31` pins no hint in Top) and Rect disarm after
  a drag (m-7: `E2E-29` needs it armed across views; the tooltip says it stays on).


## Part 10 additions (filter boxes, protection band, tilted slab)

- Backend: `TLT-00..08` (`tests/unit/test_protection_tilt.py`: TLT-00 is the golden table of slab coordinates shared
  with the frontend test, TLT-06 covers the tilt surviving Apply), `API-70/71` and `SES-50/51`
  (`tests/integration/test_protection_tilt_api.py`). Level takes the old Z path unchanged; a tilt is on the wire and in
  the archive only when non-level, so old archives and level JSON are byte-identical.
- Tilt tolerance: tilted slab membership is float64 with an inclusive `GEO_EPS_ROTATED` (1e-9); level uses eps 0.
- Frontend: `UI-200..207` (filter boxes), `UI-202/203` (planes), `UI-210..214` (band), `UI-220..226`
  (`inspector/tilt.test.ts` and the tilted routing describe in `viewport/interact.test.ts`).
- Smoke: `E2E-35..43` (boxes, planes, band, fold), `E2E-44` (tilted floor: Y ring by real mouse, typed fit, upper arrow,
  ghosts deleted and floor kept, Level) and `E2E-45` (typed tilt equals dragged tilt; session download and reopen and a
  reload keep it). Fixture `tiltedFloorPcd` in `e2e/synthetic.ts`: floor z = 0.1 x + 0.05 y (400 points, offsets
  +-0.02) and 27 ghosts 1..3 m above; truth comes from `countInTiltedSlab`, an oracle independent of the app.
- The `filter-*` control ids are unchanged by the boxes (the panel sliders went; the numeric ids stayed on the boxes).
  New ids: `prot-tilt-x`, `prot-tilt-y`, `prot-level`; read-only hooks `protectionArrows()` and `tiltRings()`.

## Collapsible inspector sections (part 10-8)

IDs: `UI-230..232` (`frontend/src/ui/sections.test.ts`: all open by default, per-section
fold, client-state round trip, old sessions all open) and `E2E-46` (click and Enter fold
each section, reload restores, counts unchanged). Fold state is `AppState.sectionsOpen`
(only closed ids stored; ids avoid the UI-92 words) next to `floorPanelOpen`.

## Part 11 additions (history timeline)

- Backend: `HST-01..21` (history model; HST-20 is a property test against a brute-force oracle of the active set after
  random rollback, delete-step and rename sequences, HST-21 round-trips 60 random sequences through save and open),
  `API-80..86` (the three `POST /session/history/*` routes and `GET /session/render?mode=step`), `SES-60..66`
  (manifest `sid`, `tool`, `name`, `next_sid`; hostile fields give `bad_archive`; an old archive rebuilds its strip).
  The archive stays at VERSION 1 with no new zip entries.
- Frontend: `UI-240..280` (`frontend/src/timeline/model.test.ts` pure model: steps, marker slots, highlight, hover,
  rename and drag transitions, key table, confirmation texts, layer style; `orchestration/edit-steps.test.ts`;
  `api/history-steps.test.ts`; `timeline/wire.test.ts`: controls, tooltips, legend row only while active, help rows;
  UI-276 the view state is not saved, UI-280 reconcile with no session returns the same object).
- Smoke: `E2E-50` (three tools, three cards, icons, counts, tooltips), `E2E-51` (click highlight: overlay count equals the
  recorded count, colour differs from Selected and Deleted, hover preview, click again, strip background and Esc clear,
  legend row), `E2E-52` (layout at 1280x720 and 1920x1080 with 25 steps; `#timeline` is excluded from the E2E-21 overflow
  scan because it scrolls on its own), `E2E-53` (real-mouse marker drag, one POST on release, counts equal fixture truth,
  Undo and Redo), `E2E-54` (button and slider keys), `E2E-55` (delete a middle step, confirmation, `Delete` on a focused
  step never fires Apply), `E2E-56` (apply while rolled back asks first), `E2E-57` (rename by double-click, pencil, F2),
  `E2E-58` (save and reopen keep the strip; an export after a rollback holds exactly the active steps' result).
- Fix chunk after Part 11: `WRK-07..13` (export and archive download from a `<kind>.u<uid>` fallback dir; symlinked,
  dangling and foreign-owned bases are never used or chmodded, sweeps skip symlinks), `SES-67..69` (hostile
  `next_sid`, more than 500 entries, old-format clamp), `HST-22` (one mask copy per rollback), `UI-233..234` (fold
  sync), `UI-282..285` (step view under a running job, budget in the cache key, reconcile), `E2E-65` (Delete on step
  buttons and the marker never applies), `E2E-66` (rapid marker keys and Undo/Redo send no stale request), `E2E-67`
  (a typed tilt beyond 60 degrees shows the limit under the field). CTR-11 also exports and downloads from the
  root-owned volume.
- Read-only hook `stepLayer()`. The smoke helpers wait until the app is idle before a marker drag, because a gesture
  during a running job is ignored by design, and cope with a tool or fold state the previous test left restored.
