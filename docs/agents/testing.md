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
  pixels), `UI-143` (draft outline; its note text is the preview text since 12b), `UI-144` (upload cancel),
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
  (draft outline and preview note), `E2E-24` (a reloaded session starts Replace, Displayed,
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
  (`UI-166..168`); rotation rings are 8 px in radius (`UI-169`, retired in Part 14b); the floor-pick hint
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

## Part 12b additions (live preview of Add, Subtract and Intersect)

- Backend: `SES-70..76` (`tests/unit/test_preview.py`: preview counts equal a numpy oracle and change nothing, commit by
  id installs exactly the previewed mask, stale rules, cancel, render flags 8 and 16, Apply after a preview deletes the
  committed set only; SES-76 measures 1M points), `API-90..99` (`POST /session/selection/preview`, `.../commit`,
  `.../preview/discard`, `GET /session/render?preview=<id>` with `X-Preview-Id`, job cancel rules, save drops a pending
  preview).
- Frontend: `UI-400..415` (preview model, palette, colourize precedence, LOD keeps flagged points, legend rows, runner
  debounce, supersede, commit by id, discard, Replace unchanged, refresher, canApply, cluster tuning, shouldPreview),
  `UI-416..418` (commit and discard enablement, commit label, Esc key row).
- Smoke: `E2E-80` (box Add by a real handle drag), `E2E-81` (Subtract and Intersect), `E2E-82` (polygon clicks),
  `E2E-83` (cluster Add, radius re-preview, Apply deletes the committed union), `E2E-84` (Apply before commit), `E2E-85`
  (Esc, Discard draft, Replace stays live), `E2E-86` (save with a pending draft), `E2E-87` (cluster tuning, Exclude
  protected, cancel). Truth is a fixture oracle in the spec (box inclusion, cluster BFS), never production code.
- Read-only hook `previewLayer()`: drawn points of the main layer flagged will-be-added and will-be-removed, and the
  preview id. Changed existing tests: `E2E-23` (note text), `E2E-61` (Apply enabled during a draft, owner ruling A).

## Runner candidate race

- A live selection whose job result lands while its state refresh is in flight keeps its candidate when the superseding
  edit was only a draft over it (runner `epoch`; a re-select, params change, reset or another selection job still drops
  it). Tests: `UI-653`, `UI-654` (`orchestration/runner.test.ts`), smoke `E2E-88` (plain, immediate Link distance edit,
  and a held render read as fault injection). Run `--repeat-each` with `--workers=1`: parallel workers share one server
  session and fail each other.

### Delete during preview

- A preview job sets `job.preview`; `canApply` ignores it (owner ruling A: Delete deletes the committed selection only), and
  `editor.apply()` calls `supersedePreview` first. A shape edit while a commit is in flight no longer cancels the commit;
  its preview runs when the commit settles; a commit cancelled from outside re-evaluates the candidate. The Delete key
  adds a notice with `applyBlockedText` when blocked (`deleteKeyOutcome`). Tests: `UI-700..705` (`runner.test.ts`,
  `edit.test.ts`), smoke `E2E-130` (preview request held; RED seen at HEAD) and `E2E-131` (commit poll held; passed at HEAD
  too, so it is a regression guard only).

- Part 16-2 (camera cluster above a smaller ViewCube; reverses the 12-3 "under"): cube edge 40, stage 80, arrow ring 68,
  zone offset 5, wrapper 160 (`view/layout.ts`; ring and wrapper are larger than first planned because `UI-332` found
  corner zones touching arrows at ring 62). Cube stage and face sizes now come from `cubeNavCss()` only. Tests: `UI-710`,
  `UI-711` (`ui/camera-cluster.test.ts`), smoke `E2E-132` (Front/Left/Top/Back at 1280x720 and 1920x1080, screenshots
  `viewcube-<w>-<view>.png`); changed: `UI-326`, `E2E-72` ("under" became "above"). Not seen RED: `E2E-132`.

- Part 16-3 (selected colour): four presets (Orange default, Magenta, White, Lime; `colour/selectcolour.ts`), a radiogroup
  `sel-colour` of `sel-colour-<id>` swatches in the Selection block after Scope; `AppState.selectedColour`, saved as
  `client_state.ui.selectedColour` only when not orange. Tests: `UI-720..724` (`colour/selectcolour.test.ts`, `legend.test.ts`),
  `UI-725` (`persist.test.ts`), `UI-726` (`ui/selectcolour-panel.test.ts`), smoke `E2E-133` (real mouse, keyboard, colour modes,
  Save and reopen, Clear selection; canvas pixels read from a real screenshot) and `E2E-134` (Add preview keeps its pink; writes
  `selected-colour-<mode>-<preset>.png`, 3 modes x 4 presets, to look at with `SMOKE_SHOTS_DIR`). The box handles are drawn
  in the same orange as the default colour, so a pixel count of orange includes them. Not seen RED: `E2E-133`, `E2E-134`.

## Part 13 additions (tool flow)

- Backend: `STS-01..14` (`tests/unit/test_step_shapes.py`: `shape_of` per tool, `tool_summary` unchanged, the entry keeps its
  shape through undo, reorder, rename and delete, archive round trip, an archive without the key loads with `shape: null`,
  hostile shapes give `bad_archive`, VERSION stays 1, exact step bounds, a sparse step is stored as tool `selection`) and
  `SPR-01..11` (`tests/unit/test_sparse.py, test_sparse_api.py, test_sparse_perf.py`: isolated points selected and dense walls not, a brute-force oracle, the
  neighbour boundary, region, protection, scope, composition with Add/Subtract/Intersect and preview, cancel, invalid
  parameters, 1M points in at most 2.0 s and 150 MiB: measured 0.50 s and +72 MiB).
- Frontend `UI-600..611` (first selection live, `liveFirst`, Replace and Slice removed), `UI-616..625` (operation icon
  radios, Live preview switch, red Delete), `UI-631..639` (Cluster Pick point states, Clear selection disarms,
  `selectionDisabledReason`), `UI-645..652` (3 m box, click to centre, `boxFromShape`), `UI-653..654` (runner candidate
  race), `UI-655..668` (Polygon edit mode: `insertVertex`, `removeVertex`, `setEditing`, the hint and key action, the pointer
  routing in `viewport/polygon-edit.test.ts`, the pencil panel, Backspace, a polygon delete blanks the polygon),
  `UI-669..683` (history click centres the camera, `shapeToPatch`, Edit shape, Sparse points model and panel). 13-7 uses
  655..668 because 653 and 654 went to the runner race fix.
- Smoke `E2E-110..123` (plus `E2E-118b`): the first selection is live (three real handle drags), the + icon, the radio group,
  the Cluster toggle (waiting, set, paused), Clear selection disarms, the Polygon pencil with the real mouse (draw, drag,
  insert on an edge, Backspace, double click, Esc), Box click to centre, Live preview off, a step click centres the
  camera and Edit shape (box, polygon, cluster) leaves the history alone, save and reopen keep the shapes, Delete is red
  and Select displayed refuses while armed, Sparse points on `sparseRoomPcd` (`e2e/synthetic.ts`: dense floor and wall with
  ten floating points above z 3; truth is the points above z 3), layout at 1280x720 and 1920x1080 with a highlighted step,
  and keyboard only.
- Not covered by a browser test: an old `.pcdsession` without step shapes (the disabled Edit shape button and its reason are
  unit-tested, `UI-675`, and the loader by `STS-09`); the look of the vertex crosses and of the red Delete (computed styles
  are asserted, no golden image). The seed cross of an edited cluster step is drawn at the step's centre because the
  server stores the seed id, not its position.

## Part 14 additions (box gizmo)

- Backend `BXR-01..06` (`tests/unit`): the rotated-box mask against a per-point Rodrigues oracle, level and yaw-only bit
  identical to the old formulas, pitch +-90, outside is the complement, the wire accepts three finite angles, quaternion
  to rpy to backend round trip.
- Unit `UI-550..559` (`tools/box/handles.test.ts`, `body.test.ts`: arrows resize, body move model), `UI-563..568`
  (`viewport/interact*.test.ts`: priorities, Shift/Ctrl, click kept, Esc restore, hover), `UI-569/570` (overlay spec),
  `UI-571..575` (`ui/keys.box.test.ts`, `tools/box/keyedit.test.ts`: keyboard), `UI-576/577` (`tools/box/docs.test.ts`:
  note text and the stored-shape round trip), `UI-578` (an edge-on ring is never picked).
- Smoke `E2E-100..105`: `E2E-100` is the layout sweep at 1280x720 and 1920x1080 (a fitted box covers 5 to 50 percent of
  the canvas so a plain drag can start outside it; Fit to view covers it all, so only Ctrl+drag orbits there), `E2E-101`
  arrow drag, `E2E-102` body drag with Shift pan and Ctrl orbit, `E2E-103` three real ring drags (on the arrow rings since Part 14b) against an independent
  rotation oracle, `E2E-104` keyboard sequence, `E2E-105` Esc mid-drag. Face views are reached by their keys (1, 3, 6),
  not by clicking the ViewCube, because a face turned away is not clickable. No browser test covers hover cursors.

## Part 14b additions (rings on the arrows, thicker arrows)

- Frontend unit: `UI-894..904` (ring geometry and gap in the ring plane, pick priority ring before arrow, inside of a ring
  and end-on arrows fall through to the body, `RING_PICK_EDGE_ON` 0.25 pinned, `ringPlaneHit` and `ringAngle` with a
  perspective-only behind-the-eye guard and an ortho case, `advanceTurn`, Ctrl over a handle orbits, `boxRings()` hook),
  `UI-903` (arrow and ring geometry, colours, widths), `UI-906` (WCAG contrast against 0x15181d: rings >= 3, arrows
  >= 4.5). `UI-905` is unused (retired).
- Smoke `E2E-163..167`. The oracle maps the ring plane to the screen with the app's `projectWorld`, drags in that plane
  and computes the expected angle independently of the app maths; Step 0 measured the app against it at 3e-14 rad, and
  `E2E-163` asserts 1e-6 rad for axis and signed angle on all six rings in the ViewCube corner view. `E2E-167` writes
  `/out/part14b-<w>x<h>-<state>.png` (top, corner, corner-hover-ring, corner-dragging, rotated) for owner review: keep
  them with `SMOKE_SHOTS_DIR=<dir> bash scripts/smoke.sh ...`, never commit them.
- Changed tests (ids and geometry only, assertions kept): UI-40, UI-550, UI-551, UI-557, UI-558, UI-559 (priority now
  ring before arrow), UI-563, UI-566, UI-567, UI-569, UI-570, UI-576, UI-578, the unnamed rotate-drag test, E2E-103.
  Removed: both `UI-169` tests (replaced by UI-894..896).

## Part 15a additions (Hide selected)

- Unit `UI-500..504` (`view/hidden.test.ts`: the id bitmap, exactness, `applyHidden` compaction, same object when empty),
  `UI-505/506` (`orchestration/refresh.test.ts`: primary and second render compacted, the deleted overlay is not, the set
  drops with the cache or a different session id), `UI-507..514` (`orchestration/hide.test.ts`: button states, refusal
  reasons, Select displayed and Invert refused, the extra Apply confirm, hidden seed pick, never persisted, hide keeps the
  tool armed, Save notice), `UI-515/516` (`ui/hiddenchip.test.ts`: the legend chip), `UI-517` (export dialog note).
- Smoke `E2E-90` (hide the floor and its ghosts, the drawn count drops by exactly the count, Apply asks with the exact
  text, the export re-parsed with the independent reader equals the room minus the ghosts and includes the hidden floor,
  Show restores the draw, a reload shows nothing hidden) and `E2E-90b` (button and chip overlap sweep at 1280x720 and
  1920x1080). Superseded by the layer-backed version below: E2E-90 was flipped in 15b-7 and the unit ids UI-500..506, 511 were replaced.

## Part 15b additions (named layers)

- Backend: `test_layers*.py`, `test_archive_layers.py`, `test_export_layers.py` and the tool-exclusion tests (LAY-00..72: the server-side layer model, the retained ids
  property LAY-20/21, every tool excluding hidden points, archive version 2 only with layers, export by layer, the
  layer render block with `X-Layers: 1` only when layers exist). The existing suite passes unedited.
- Frontend unit: `UI-800..866` (model, api, params hook, Hide selected on layers, panel, legend rows, export picker,
  colour by layer, Edit layer and Set layer to selection, never-persisted layer UI, Edit shape title for layer steps).
- Smoke `E2E-140..146` (layer from the floor and hidden, save and reopen, ghost Apply with a hidden layer and no
  confirm, Edit layer with the steal confirm, export picker re-parsed with the independent reader, Undo restoring layer
  membership, eight-layer overlay sweep at 1280x720 and 1920x1080). `E2E-90` reads the layer Hidden. Run smoke with
  `bash scripts/smoke.sh npx playwright test --workers=1`.

## Part 17 additions (cluster cap, panel and header polish)

- Backend: `CLU-44..48` (exact cap oracle by brute-force pairwise distance on small clouds, ties by (hop, distance, index),
  `invalid_max_points` for 0 and negative caps) and `API-100..102`. `CLU-47` has new bounds measured on the checks image
  with 1.5x headroom: K=500 on the 331k room <= 0.25 s and 155 MiB (measured 0.10 to 0.15 s, 103 MiB); K=165k <= 11.4 s
  and 400 MiB (measured 7.1 to 7.6 s, 260 MiB; the 4.5 s target was missed after one optimisation attempt); a 20k chain
  with K=10k <= 11.7 s and 105 MiB (measured 7.8 s, 68 MiB). Peak RSS is read from `VmHWM` (`ru_maxrss` inherits the
  pytest parent). The existing `CLU-22` and `CLU-40..43` thresholds are unchanged.
- Frontend unit: `UI-872..893` (cluster block follows the pending preview, tool stays armed after Commit draft, why
  Delete is off, Show hidden reselects, defaults 0.3 and 500, Scope row, filter boxes open collapsed, armed tool section
  first, compact left panel in `leftpanel.test.ts` and `layerspanel.test.ts`).
- Smoke `E2E-150..160`. `E2E-158` logs the left-panel content height (`LEFT-PANEL-CONTENT`) and does not assert a height
  target: the target is pending an owner ruling. `E2E-160` writes `/out/part17-<w>x<h>-idle.png` and
  `-cluster-armed.png` for owner review; keep them with `SMOKE_SHOTS_DIR=<dir> bash scripts/smoke.sh ...` and never
  commit them.
- Step-0 measurements at HEAD 73870ad (room open, no tool, no layers): `#toolbar` 45 px and `#viewbar` 51 px, one line
  each; `#tools` content 385.7 px (369.7 like for like); stage 596.8 px at 720 and 956.8 px at 1080. After 17-10 the
  `#tools` content is 345.4 px at both sizes; after 17-11 `#toolbar` is at most 33 px and `#viewbar` at most 29 px.
- Changed existing tests (setup, selector, text or geometry only, nothing loosened): UI-62, UI-65, UI-202, UI-203,
  UI-300, UI-400, UI-513, UI-666, UI-816, UI-831..838, UI-863, UI-864, UI-890; E2E-10, E2E-13, E2E-16, E2E-20, E2E-24,
  E2E-25, E2E-30, E2E-35, E2E-35b, E2E-36, E2E-37, E2E-38, E2E-40, E2E-41, E2E-46, E2E-62, E2E-90, E2E-113..115,
  E2E-121, E2E-143, E2E-146. `E2E-143` is a known flake that also fails at 73870ad (open item).

## Part 18 additions (protected layers, Floor from the band, per-layer menu)

- Backend: `LAY-80..99` including `LAY-30b`, `LAY-94b` and `LAY-97b` (flags survive every `Layer` rebuild, one protected
  set for candidate, state count, Cluster and Sparse eligibility and render flags, archive optional keys written only
  when true and non-boolean refused, the flag PATCH, order, merge, Floor from band and the `layer_locked` 422). pytest
  618 to 644. Changed existing tests: `LAY-17` and `LAY-40` (expected rows gain `protected` and `locked` false).
- Frontend unit: `UI-910..927` (model, api, orchestration, the headline "in protected layers" split, `UI-927` the
  override line "plus protected layers (N points)") and `UI-921..926` (the menu in `layerspanel.test.ts`). vitest 718 to
  736. Changed existing tests, setup only: the `LayersDeps` literals in `orchestration/layers.test.ts` and
  `orchestration/editlayer.test.ts` gain `selectLayerOp` and `apply`.
- Smoke `E2E-170..176`. The test wall box for these tests is the `x = -1` column (`WALL18`): the older wall box also holds
  12 floor points, which a new layer takes out of the Floor. `E2E-175` logs `LEFT-PANEL-MENU <w>x<h>`: Floor's open menu
  is 242 px tall at 1280x720 (the left panel scrolls, 738/631) and 215 px at 1920x1080 (no scroll, 991/991); it asserts
  no overlap, the menu inside the panel and `overflow-y` auto or scroll. `E2E-176` writes
  `/out/part18-<w>x<h>-menu.png` and `-floor.png`; keep them with `SMOKE_SHOTS_DIR=<dir> bash scripts/smoke.sh ...`,
  never commit them.
- Changed existing smoke tests: none.

## Part 19 additions (layer edits in Undo, export each layer to its own file)

- Backend: `HST-23..31` (the layer step in `History`, `replace`, dependents, and `HST-31`, a 300-sequence property test of
  deletion and layer steps against the plain-set oracle `tests/fixtures/step_oracle.py`), `SES-77..86` (archive
  version 3), `LAY-100..112` (engine steps, ordered flips, delete-step refusal), `API-103..108` and `LAY-120..127`
  (routes and per-layer export). pytest 643 to 697 (`test_pcd_61`, the 1M read, is a known load flake).
- Soundness replay compares membership (per-point layer and row id), never row order: re-inserting a deleted row at its
  stored index drifts the order by design, so the stop rule does not fire on order.
- Frontend unit: `UI-928..953` (layer cards, delete state and confirm text, `step_has_dependents` notice, undo texts,
  the rolled-back gate in `layers.ts`, the One file per layer dialog and `startExportPerLayer`). vitest 736 to 763.
- Smoke `E2E-177..185`. `E2E-182` re-parses each of the three downloads with the independent reader in
  `e2e/synthetic.ts` against fixture truth. Headless Chromium delivers one `download` event per programmatic anchor click
  (spike at 19-0), so no zip fallback exists; the dialog keeps a link list as the fallback for a browser that blocks
  several downloads (the real prompt is a manual QA item). `E2E-185` writes `/out/part19-<w>x<h>-strip.png` and
  `-export.png`; keep them with `SMOKE_SHOTS_DIR`, never commit them. Smoke 161 to 171.
- Dialog-listener rule (E2E-90): register `page.on("dialog")` after the helper that opens the room, or answer by message
  text; each test leaves an unsaved session and the next open asks to discard it. `E2E-179` and `E2E-180` replace the
  listeners after the open and answer the Remove step and discard texts by content. Hover a card before clicking its
  delete button.
- Archive rule: version 3 is written only when a layer step exists; v1 and v2 still open; a pre-19 build refuses v3
  (read from the code, not executed).
- Changed existing tests, by id, nothing loosened: `LAY-10`, `LAY-11`, `LAY-40`, `LAY-94b`, `LAY-96`, `LAY-30` (version
  3), `LAY-38` (version 3, no layers block), `LAY-33` (last leg uses version 4), `HST-20`, `HST-20b`, `LAY-20`,
  `LAY-20b` (rewritten on the shared oracle, thresholds unchanged; `LAY-20` op mix gains merge), `UI-265` (empty
  strip text "No steps yet"), `UI-837` (the layers note and title wording). `HST-21` and `LAY-21` go green through the
  oracle unchanged.

## Part 20 additions (Planes: floor and ceiling detection; Thin: duplicates and voxel subsample)

- Backend: `THN-01..14` (`geometry/voxel.py` key extraction shared with Sparse, the Thin tool: eps 0, eps > 0 with a
  dyadic boundary, lowest-index keeper, voxel, eligible-only keepers, budget refusal), `PLN-01..15` (RANSAC detection,
  plane membership, determinism, the batch bound), `STS-15..18` (step shapes), `SES-87..89` (archive), `API-109..116`
  (the read-only detect job and the select route; `tests/unit/test_planes_api.py`). pytest 697 to 741. The 1M bounds
  `PLN-14/15` and `THN-13/14` run one call in a fresh process under `RLIMIT_AS` (`tests/fixtures/plane_rss.py`) and are
  the worst of 3 runs of the committed code x1.5 (detect 1.50 s / 96 MiB, plane mask 0.03 s, duplicates at 1e-3
  2.96 s / 171 MiB, voxel 0.81 s / 133 MiB). The voxel number is slower than the Step 0 spike (0.25 s); reported, not tuned.
- Frontend unit: `UI-954..983` (models, `bandFromPlane`, the detect flow in `orchestration/planes.ts`, panels, step cards).
  vitest 763 to 797. Changed existing test: `UI-890` (the tool order is box, polygon, cluster, sparse, plane, thin).
- Smoke `E2E-186..194`: `E2E-186` Detect, held progress and Cancel; `E2E-187` ceiling Delete, Undo, Redo; `E2E-188` the
  tilted floor as the protection band (angles within 0.01 degrees of the plane equation, Protected equals the slab
  oracle, the O11 replace confirm answered by its text); `E2E-189` a plane as a protected layer and the band route;
  `E2E-190` duplicates at 0, export re-parsed with no duplicate row; `E2E-191` 1e-3, voxel and a box Subtract/Add;
  `E2E-192` Save, reopen, Edit shape, no list after a reload; `E2E-193` layout (logs `TOOL-ROW <w>x<h>`);
  `E2E-194` writes `/out/part20-<w>x<h>-planes.png` and `-thin.png` (keep with `SMOKE_SHOTS_DIR`, never commit).
  Oracles `countPlane`, `dupTruth`, `voxelTruth` are in `e2e/synthetic.ts` and import nothing from the app.
- Fixture lesson: the detection needs 1% of the points to form a plane, so regular rows of wall points (equal z) become
  planes of their own. `planeRoomPcd()` scatters the wall heights; `planeRoomPcd(true)` keeps the rows to give the layout
  test 4 list rows. A Box armed over an existing selection is a draft (needs Commit draft): `sel-clear` first.
  The status bar groups thousands (`2,921`).
- Step 0 (checks image, `-m 6g`, throwaway spike): RANSAC on 360k points, floor normal error 1e-5 rad, d 5e-4, 0.89 s,
  +76 MiB; a tilted floor 1e-4 rad; 1.2M 1.08 s; 9.6M (manual) 3.19 s with the 2 planes right. Thin 1M with 50 %
  duplicates: eps 0 0.38 s, eps 1e-3 2.4 s, voxel 0.05 0.25 s. Thin 10M (manual): eps 0 7.3 s (+926 MiB), eps 1e-3
  32.8 s, voxel 4.4 s (+124 MiB), `count_neighbors` 7.1 s; all completed under 6 GiB.
- Determinism scope: the seed is fixed (0), so two runs in one build give identical planes (checked in one process and in
  two fresh processes). Across machines or BLAS builds the planes agree to 1e-3 only (LAPACK `eigh` bits may differ).
- Lowest-index rule: for duplicates and voxels the point with the lowest index is kept and later ones are selected;
  only points the tool may select (scope, region, Exclude protected) count as copies (O10). Chain caveat: with eps > 0 a
  chain of points spaced eps apart keeps only its first point.
- One job worker: a select queues behind a running detect, so the panel shows "Detecting planes..." as busy (`API-110`).
- A pre-20 build refuses an archive holding a `plane` or `thin` step (`bad_archive`); documented, not tested.
- Known load flakes unchanged: `test_pcd_61`, `E2E-57`, `test_nrm_07` timing.

## Part 22-3 additions (the protection band with the Box handles, Show band)
- Frontend unit: `UI-1060..1073`. `UI-1060..1062` (`tools/box/shared-handles.test.ts`) pin the helpers extracted from the Box
  (`shaftRing`, `handleOverlaySpec`, `advanceRing`) to the Box's own output; `UI-1063..1066` (`inspector/bandgizmo.test.ts`)
  the band's arrows, rings, visibility and the Show band off state; `UI-1067..1069` (`viewport/interact.test.ts`, describe
  "band gizmo routing (22-3)") the arrow-tip drag, the ring drag and Esc, and the hidden band falling through to the camera;
  `UI-1070` and `UI-1073` (`ui/bandswitch.test.ts`) the switch and the ring-colour tooltips; `UI-1071` (`ui/bandpill.test.ts`)
  the pill; `UI-1072` (`state/persist.test.ts`) `ui.bandHidden`. vitest 824 to 838.
- Changed existing tests (setup only, assertions kept): `UI-224` (the ring comes from `bandGizmo(..).rings`, id `tilt-y+`),
  `E2E-39` (all three grabs are at the arrow tip), `E2E-44` (the upper arrow is grabbed at its tip; `dragYRing` finds
  `tilt-y+`), `E2E-45` (only through `dragYRing`). Why: the band now uses the Box's part-14b handles, which are picked at
  the arrow tip and the 8 px ring only, so "20 px past the anchor" and "halfway along the shaft" no longer grab. Box tests
  (`tools/box/*.test.ts`, `UI-902`, `UI-563`, `E2E-163..167`) are unmodified.
- Hooks: `__editor.tiltRings()` returns ids `tilt-x+`, `tilt-x-`, `tilt-y+`, `tilt-y-` with 32 points each (the old ids `x`
  and `y` with 48 points are gone); `protectionArrows()` keeps its `{ key, base, tip }` shape, with the arrows now 72 px long
  and grabbed only at the tip. Both return `[]` while Show band is off.
- Smoke `E2E-215..217`: `E2E-215` real-mouse arrow tip and ring (Left view, where the X ring is a full circle);
  `E2E-216` Show band off (hooks empty, pixels equal to protection off above the pill, a press at the old tip orbits, a box
  Delete removes only the unprotected points, reload keeps hidden, Show restores); `E2E-217` writes
  `/out/part22-3-<w>x<h>-band.png` and `-band-hidden.png` (keep with `SMOKE_SHOTS_DIR`, never commit). The full smoke
  run with `--workers=1` is 196 tests (the four new ones are `E2E-215`, `E2E-216` and `E2E-217` at two sizes).
- Lessons: after a `setNum` the Tab leaves focus in a number field, so a view key such as `3` is typed into it (the later
  blur commits it): click the ViewCube face (`fitTiltedFloor` does). Client state is saved one second after the last change,
  so a test that reloads must poll `/api/session` for `client_state.ui.bandHidden` first. The flag is not reset by opening
  another file (like `previewLive`), so a test that ends hidden must leave the archive shown.
- Branch-review fixes (after 22-3): `UI-1074` (`filterboxes/placement.test.ts`) the filter boxes never cover the band-hidden
  pill (`placeBoxes` takes extra reserved rectangles, `pillRect` is passed while `bandPillShown`; `PILL` in `view/layout.ts`
  must stay at least as big as `#band-pill`, which `E2E-217` bounds at 260 x 34); `UI-1075` (`ui/bandswitch.test.ts`) the
  Show band icon is rebuilt only when `bandVisible` changes. Changed: `E2E-217` (also scans the six `.fbox` chips against
  the pill), `UI-1073` (also the mouse help row), `UI-1070` (no `aria-pressed` on the role=switch), `UI-1067` (title only).

## Part 22-4 additions (design tokens, palette, type and themes)
- Frontend unit: `UI-1080..1091`. `UI-1080..1085` (`ui/tokens.test.ts` parser, `ui/theme.test.ts`) pin the three token blocks (dark
  `:root`, the `prefers-color-scheme: light` block and the `:root[data-theme="light"]` block must agree), the values from `notes.md`
  (with the measured departures listed in the test's comment), the contrast of every text, icon and fill token over its own
  theme's `--canvas` and `--canvas-vignette`, the data and axis tokens (dark `:root` only), and the Box and band arrows and rings
  against the dark stage. `UI-1086` no colour literal outside the token blocks (small allow-list) and no `var(--x)` that nothing
  declares, across `index.html`, `timelineCss()` and `cubeNavCss()`. `UI-1087` one `:focus-visible` rule (3 px `--focus`), no other
  outline except the locked-chip dashed marker, and no `outline: none`. `UI-1088` every transition is 120-250 ms and a global
  reduced-motion block. `UI-1089` the font stack, the type tokens and tabular numerals, no remote font. `UI-1090` the glass rules
  (`blur(28px) saturate(170%)` with the `-webkit-` twin on the stage HUD and the sheets, none on the side panels or `#viewport`, and the
  `@supports not` opaque fallback). `UI-1091` (`viewport/canvastoken.test.ts`) the clear colour follows `--canvas`.
- Changed existing tests (setup only, thresholds kept): `UI-306` and `UI-620` read the new token names through `testing/tokens.ts`
  (`glass` composited over `--canvas`, `label`, `label-2`, `destructive`, `on-destructive`); `UI-721` measures the presets against
  the dark theme's `--canvas` and `--canvas-vignette` at the same floor of 100; `E2E-155` grows each rect by 4 px (the new 3 px ring
  plus its 1 px offset) instead of 3. `UI-906` is deliberately not edited (R22-6): its `0x15181d` constant is stale, `UI-1085`
  protects the same floors on the real dark stage.
- `testing/tokens.ts` is a test-only reader: it parses the three token blocks out of `index.html`, resolves `var()` chains and
  composites translucent tokens over their backdrop. It is not bundled.
- Smoke `E2E-220..226`: `E2E-220` the dark default on the real cascade and no request leaves the machine; `E2E-221` the light theme
  from `prefers-color-scheme` and `data-theme` both ways, for the chrome, the HUD and a clear stage corner (the 3D clear colour);
  `E2E-222` the 3 px accent ring; `E2E-223` reduced motion; `E2E-224` every icon-only button has an `aria-label` and a title (the
  filter box reset and toggle were missing the label); `E2E-225` measured text contrast on real elements in both themes, including
  `#empty` on the stage; `E2E-226` writes `/out/part22-4-<w>x<h>-{dark,dark-armed,light,light-armed}.png` (keep with
  `SMOKE_SHOTS_DIR`, never commit). The full smoke run with `--workers=1` is 204 tests (196 + 8).
- The Playwright config pins `colorScheme: "dark"`. Playwright defaults to light, which would now switch the app, so every existing
  pixel test keeps the dark stage and a light test opts in with `page.emulateMedia({ colorScheme: "light" })`.
- R22-13: the light theme has a light stage (`--canvas #e9ebef`) and light HUD glass. Part 22-4 pins no point, highlight or axis
  contrast on it: the render colours stay the dark theme's until part 22-4b.
- The vignette is not drawn (E9). A transparent canvas over a `#stage` radial gradient changed `E2E-216` by one dither level, so the
  stage is the opaque clear colour, which follows `--canvas` (`viewport/canvastoken.ts`). `E2E-216` run in one `-g` selection straight
  after `E2E-201` times out, also at 7067cd7; it passes alone and in file order.
- Rule: part 4 keeps box geometry. Edges are inset shadows, state moves from outline to fill and border; no new border, padding,
  margin, width or height.
