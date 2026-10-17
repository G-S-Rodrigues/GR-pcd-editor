# Spec: GR-pcd-visualizer

**Date:** 2026-10-17
**Status:** Ready for implementation planning
**Target repository:** `<personal-account>/GR-pcd-visualizer`, public
**Supported host:** Linux with Docker Engine and Docker Compose v2

## Context

The workspace contains a product specification and no application, Git repository, tests or build configuration. The source is `point-cloud-cleaner-spec.md`, version 1.0 dated 2026-10-16. Its original sections 4–19 are retained below as normative detailed requirements, including AC-01 through AC-18. Original anchors were `point-cloud-cleaner-spec.md:46` (UI), `:61` (PCD records), `:154` (deletion semantics), `:200` (architecture) and `:223` (acceptance criteria); these refer to the pre-revision file and will drift. No commit or existing feature branch exists.

The user cleans LiDAR SLAM PCD maps, especially mirror/window reflections, while preserving valid geometry and the floor. Existing requirements avoid temporary cloud extraction and manual merge/subtraction workflows. This revision makes Docker packaging mandatory and adds a Linux root launcher, browser-based local file handling and creation of a public personal GitHub repository.

## Goals

A Linux user clones the public repository, runs `./gr-pcd-visualizer.sh`, opens its printed localhost URL, chooses a PCD from the computer, previews and reversibly removes unwanted points at full resolution, then saves a session and cleaned PCD back to the computer. Every retained PCD field survives export.

## Non-goals

- Windows and macOS support: Linux is the confirmed v1 platform; additional launch and path-handling environments would require separate verification.
- A separately supported native installation: Docker is the required launch path; duplicating installation/package maintenance is unnecessary for v1.
- Automatic reflection recognition, automatic floor estimation and SLAM correction: these require inference and validation beyond explicit geometric editing.
- ROS integration and live sensor editing: the application edits local files and has no robot runtime contract.
- Multi-user collaboration and remote hosting: the service is local and has one active editing session; host publication remains loopback-only.
- Mesh editing, statistical/radius outlier filters and reusable region presets: these expand the tool set beyond the agreed v1 selection workflows. Session serialization may retain region state without providing a reusable preset library.
- Whole-computer filesystem mounting: browser file selection supplies arbitrary local files; the backend opens no host path (part 8: no mounted folder).
- An installer that installs Docker or starts the system Docker service: the launcher checks prerequisites and explains corrective action.
- Implementation, issue creation and publishing during this spec-writing task: these are subsequent execution work. Repository creation itself is an explicit requirement below.

## Scope

The items below describe implementation scope, not an execution plan. File paths are anticipated ownership boundaries and may be refined during planning. Issue-derived branches and independently mergeable parts are assigned only if Phase 4 is requested; no issue number or branch is invented here.

### 1. Public personal repository and project entry points

**Now:** Only the original specification exists locally; no remote owner or repository has been verified.

**Change:** Create `GR-pcd-visualizer` as a public repository in the user's personal GitHub account. Determine the intended personal account from authenticated GitHub identity and the user's configured account context before creation. If identity is ambiguous, resolve it before publishing. Do not infer an organization or username from a filesystem path. If that repository already exists, inspect its owner and content before reusing it; never overwrite unrelated work. Configure the local remote and default branch. Report the resulting repository URL when this scope is executed.

Provide README instructions for Linux prerequisites, first build, subsequent offline runs, file selection, downloads, stop/restart, troubleshooting and verification. Ignore user PCD maps, session archives, uploads, outputs, secrets and build products. Public fixtures must be synthetic or explicitly cleared for redistribution. A public repository does not imply a chosen open-source license; leave licensing unresolved until the owner selects one and make no unsupported licensing claim.

Files: `README.md`, `.gitignore`, `.github/workflows/ci.yml`, `docs/agents/testing.md`, `AGENTS.md`.

**Part 1 bootstrap addendum (2026-10-17):** The authoritative repository is
`G-S-Rodrigues/GR-pcd-editor`. This tracked copy of the specification,
`docs/GLOSSARY.md`, and `scripts/check-bootstrap-contract.sh` are added to the
Part 1 boundary. The owner has explicitly deferred CI configuration, so
`.github/workflows/ci.yml` is not created in this bootstrap. The local contract
therefore covers these seven files: this specification, `README.md`,
`.gitignore`, `AGENTS.md`, `docs/GLOSSARY.md`, `docs/agents/testing.md`, and
`scripts/check-bootstrap-contract.sh`.

**Part 8 addendum (2026-10-17):** Owner decision: loading from a mounted folder is removed. The launcher has no `--data-dir`, Compose binds no host folder, the app serves no `/api/mounted` and has no open-by-path routes. Files are opened only by browser selection or drag and drop (upload). Superseded: Scope 2 `/data` mount, read-only source mount and backend path rules; Scope 3 `--data-dir` and its validation; Scope 4 mounted imports and their labelling; AC-21 (now: launch from another directory finds its own configuration); AC-22 invalid directory case; AC-26 "source mount is read-only" and "path traversal/symlink escapes" (loopback-only and cross-origin refusal remain); AC-27 "data directory" (changed port or user remains). AC-23 and AC-25 stand. Tests and docs follow this addendum.

### 2. Container image, Compose and persistent storage

**Now:** Original section 3 made containers optional and required a native Linux path. This item replaces that packaging requirement.

**Change:** Put the application Dockerfile and Compose configuration at `docker/Dockerfile` and `docker/compose.yaml`. Build frontend assets into the image and serve them locally. Use one application service containing the local processing backend and web assets. No CDN, remote processing, account or telemetry is needed. Rendering runs in the user's browser; do not require host X11 sockets or GPU passthrough for the container.

The first image build may download dependencies. Subsequent operation with an existing image must work without internet. Pin direct dependencies through the chosen ecosystem's lock mechanisms. Run the application as an unprivileged container user. Define a health check that reflects application readiness. Listen on the necessary container interface and publish only `127.0.0.1:<host-port>:<container-port>` on the host, default host port 8080. Keep remote access outside the supported v1 launcher contract.

**Superseded in part (part 8): no `/data` mount exists.** Mount a Docker-managed writable work volume at `/work` for uploads, caches and session working data; nothing else is writable except a capped `/tmp` tmpfs. Browser downloads persist exports/session archives on the host. Container removal must not remove downloaded files; document that unsaved in-memory state can be lost. Retain the working volume across ordinary stops and never remove it implicitly during a rebuild.

**Superseded (part 8):** the backend takes no path from a request, so there are no backend path rules and no mounted-file chooser. Do not expose arbitrary container paths or a Docker socket.

Provide optional `verify` and `lint` Compose services under profile `checks` so the commands in Testing have one stable interface regardless of language choices. These services must execute real checks and propagate failures.

Files: `docker/Dockerfile`, `docker/compose.yaml`, `.dockerignore`, `backend/`, `frontend/`, dependency manifests and lockfiles.

### 3. Root launcher and lifecycle

**Now:** No launcher exists; the original startup command was illustrative.

**Change:** Provide executable Bash script `./gr-pcd-visualizer.sh` at repository root. Locate Compose and build files relative to the script so launch works from another directory. (Part 8: there is no input mount.) Accept:

```sh
./gr-pcd-visualizer.sh
./gr-pcd-visualizer.sh --port 8081
./gr-pcd-visualizer.sh --no-browser
./gr-pcd-visualizer.sh --rebuild
./gr-pcd-visualizer.sh --stop
```

**Superseded (part 8): `--data-dir` was removed;** the launcher rejects it with exit 2 and a "was removed" hint. Validate the port. Pass configuration through properly quoted arguments/environment variables without evaluating strings as shell code.

Check Docker CLI, Compose v2 and local daemon availability. Require a local Docker context. Build the image if absent; `--rebuild` explicitly rebuilds it. Start in the background, wait for health with a bounded documented timeout, and only then print a clearly labelled URL such as `http://localhost:8080`. A failed startup exits nonzero with useful diagnostics and no success message.

Open the URL using the host browser opener where available unless `--no-browser` is supplied. Failure to open a browser is nonfatal after readiness because the URL is printed. An occupied port produces an actionable error and supports choosing a different port. A repeated launch reuses a healthy compatible instance; a changed port (or user) must be detected and visibly require a restart rather than silently retaining stale configuration. `--stop` stops this project without deleting data volumes. Ctrl-C after the detached launch does not terminate the server. Document the one-instance-per-checkout behavior and how to stop it.

Files: `gr-pcd-visualizer.sh`, `docker/compose.yaml`, `tests/launcher/`, `README.md`.

### 4. Browser file selection and saving

**Now:** The source requires local browser file selection and export but does not define their relationship to a container's filesystem.

**Change:** The default Open action uses the browser file picker; drag-and-drop is also supported. Users can select a PCD from any folder their browser and OS permit. The browser sends the selected file only to the loopback application. No whole-disk mount is required. **Superseded (part 8):** the separately labelled mounted-folder browser and imports under `/data` were removed.

Show upload/import progress, cancellation and actionable size/storage errors. Do not clear an existing editing session until a replacement import succeeds and the unsaved-work choice has been resolved. Manage temporary uploads and aborted operations without deleting files still needed by a live or saved working session.

Export PCD and Save session produce completed browser downloads, suggesting `<original>_cleaned.pcd` and a clearly identified versioned session filename. The browser/OS determines the host destination and may show a Save dialog or use its configured Downloads directory. Explain this behavior in the README and UI. Do not claim that a web application can silently overwrite the path selected at import. A completed server-side export does not prove the browser saved the download successfully.

Default session downloads embed the original PCD plus a versioned state manifest. Reopening works after container recreation and does not depend on an ephemeral upload path. Validate the embedded source hash and archive entries, enforce extraction/resource bounds and reject path traversal. Optional referenced sessions must request browser source reselection and verify its identity. Ordinary operation never modifies the input file.

Files: `backend/files/`, `backend/sessions/`, `frontend/files/`, `tests/integration/`, `README.md`.

### 5. Authoritative PCD processing and full-resolution edits

**Now:** Source sections 5 and 16 define the required data model; no implementation exists.

**Change:** Implement the normative requirements below for ASCII, binary and binary-compressed imports, arbitrary field records, stable source IDs, immutable originals, deletion masks and precision-preserving export. A typed XYZ view may support calculations but must not replace retained raw/custom field data. Validate dependency behavior using custom-field fixtures before committing to the parser/backend choice. The backend owns exact queries, cancellation, revisions and exports; the browser owns navigation, controls and bounded rendering.

Core behavioral contracts, expressed without choosing a language:

```text
boxContains(point, center, dimensions, orientation) -> boolean
prismContains(point, polygonXY, zRange) -> boolean
filterContains(point, enabledAxisRanges) -> boolean
combineSelection(currentIDs, operandIDs, operation, scopeIDs) -> IDSet
candidateDeletion(activeIDs, selectedIDs, protectedIDs) -> IDSet
connectedComponent(seedID, radius, eligibleIDs, spatialIndex) -> IDSet
exportRecords(sourceRecords, activeIDs) -> PCDBytes
```

Geometry boundaries are inclusive. Document a consistent precision/tolerance policy against original coordinates. No approximate result or stale revision can be committed. Apply the declared scope and protection before computing the deletion set. Exact semantics and invalid-point handling are retained in the detailed requirements.

Files: `backend/pcd/`, `backend/geometry/`, `backend/editing/`, `tests/unit/`, `tests/fixtures/`, `tests/integration/`.

### 6. Complete editing UI, history and comparison

**Now:** Source sections 4 and 6–15 describe UI behavior without an application.

**Change:** Implement all normative detailed requirements below: six orthographic views, pivot picking/reset, box gizmos and numeric geometry, XYZ filters, bounded polygon selection, global/local height protection, radius-graph cluster selection, selection algebra, exact previews, deletion, undo/redo, comparison modes and session reopening. Retain the source's required v1 scope; do not reduce it to a visualizer-only prototype because of the repository name.

Keep all displayed counts explicit about original, active, displayed, selected, protected, candidate and rendered sets. Render budgets never alter the authoritative edit set. Warn when all-active scope selects points hidden by display filtering. Workers/background operations must report progress and discard stale results. Limit v1 to one active cloud/editing session; additional tabs must not mutate it with obsolete revisions.

Files: `frontend/viewport/`, `frontend/tools/`, `frontend/inspector/`, `frontend/history/`, `frontend/comparison/`, `backend/api/`, `tests/ui/`.

## Layout

```text
Open | Save session | Export | Undo | Redo | Preview | Apply
View presets | Projection | Fit | Pivot | Compare
+---------------+----------------------------------+------------------+
| Editing tools | 3D viewport / synchronized split | Tool inspector   |
| Box / polygon |                                  | Geometry         |
| Cluster       |                                  | Display filters  |
| Selection ops |                                  | Height protection|
+---------------+----------------------------------+------------------+
Original / Active / Displayed / Selected / Protected / Candidates | LOD
```

Future editing tools belong with tool selection; their parameters belong in the inspector. File actions and view actions remain separate from geometry controls. Browser uploads are the only import path (part 8), so no host path is shown.

## Testing

There is no existing runner, test-ID scheme beyond AC-01 through AC-18, or `docs/agents/testing.md`. Establish that document during implementation. The commands below are required verification entry points, not claims that tests already exist. Choose language-specific runners during planning and wire them behind these services.

```sh
docker compose -f docker/compose.yaml --profile checks build verify lint
docker compose -f docker/compose.yaml --profile checks run --rm verify
docker compose -f docker/compose.yaml --profile checks run --rm lint
```

- **Unit:** test geometry membership boundaries, all selection operators and inversion universes, protected deletion precedence, cluster chains and exclusion of protected bridges, stale revision rejection, undo/redo identity, PCD schema/record preservation, and session source verification. Use exact ID sets and synthetic records as independent expected results.
- **Integration:** round-trip all three import encodings with custom fields and invalid coordinates; export/reparse original retained records; import through upload; download/reopen a self-contained session in a fresh container; reject archive path escapes; interrupt failed uploads/exports; verify cancellation and state after errors. Compare outputs with known fixture records instead of relying only on the same reader/writer agreeing with itself.
- **UI:** automate box numeric/gizmo synchronization, polygon height limits, scope and protection warnings, preview/apply revision races, undo/redo, browser downloads and synchronized comparison. Assert counts against backend fixture truth under multiple render budgets.
- **Launcher/container:** verify Compose configuration, cold start, repeated start, changed settings, missing prerequisites, a removed `--data-dir`, occupied ports, readiness timeout, `--stop`, loopback publication, read-only root filesystem and work-volume survival across recreation. Simulated failures must not be reported as successful startup. Run Linux launcher tests in CI; checks that need a Docker daemon run on a Linux Docker-enabled job.
- **Lint:** the lint service checks the selected backend/frontend languages, formatting and Bash/ShellCheck. Document its exact underlying commands and any justified exclusions; failures propagate to CI.
- **Live/manual:** (1) run the documented launch command and verify browser opening and printed URL; desktop browser opening needs a real desktop. (2) select a PCD from any folder and save downloads to a chosen host directory; confirm browser/OS save behavior. (3) complete the primary walkthrough on a representative Unitree map and inspect floor/reflection separation. (4) measure approximately 30 FPS navigation, import/query/cluster/export timings and peak RAM for 1M and, where feasible, 10M points on a documented 16 GB Linux reference PC. (5) disconnect external networking after building the image and repeat import/edit/export/session operations.

Hardware-dependent performance is a measured target, not a universal guarantee. Reference PC/data availability belongs to the owner before performance sign-off. Synthetic data establishes correctness without publishing private maps. This specification does not establish library fidelity, FPS or peak memory by assertion; implementation must produce the evidence.

## Risks

- PCD libraries can discard unknown fields, change packed RGB values or mishandle compressed field-major storage. Fixture fidelity is a dependency-selection gate.
- 10M-point records, raw source bytes, indexes and undo masks may exceed the 16 GB target for rich schemas. Estimate resources, bound history/cache use visibly and refuse safely rather than downsample edits.
- An embedded-source session is portable but can be large. Stream/archive away from the UI thread and report progress; validate disk and memory budgets.
- A picked GPU sample may identify the wrong original record if mappings or display recentering drift. Test picking and edits at large coordinate magnitudes.
- Browser downloads do not grant arbitrary host write access. Do not promise automatic save-back to the source directory.
- Loopback binding alone does not protect file APIs from hostile web origins. Validate Host/Origin, reject unintended cross-origin state changes, and constrain server paths to declared roots.
- Root-owned cache files in the work volume or remote Docker contexts can make a launch appear healthy while imports fail. Report permissions clearly.
- There is no existing repository to inherit CI or license decisions from. Confirm the personal account before public creation and publish only redistributable fixtures.

## Acceptance criteria

AC-01 through AC-18 in the detailed requirements remain required. Add:

| ID | Scenario | Expected result |
| --- | --- | --- |
| AC-19 | Repository setup executes | Public `GR-pcd-visualizer` exists under the verified personal account; remote and repository URL agree; no private maps or credentials are published |
| AC-20 | Fresh Linux checkout with Docker available | Root executable launcher builds/starts using `docker/Dockerfile` and `docker/compose.yaml`, waits for health and prints a usable localhost URL |
| AC-21 | **Superseded (part 8: no `/data`).** Launch from a different directory | Script finds its own configuration; inputs are never modified |
| AC-22 (**part 8:** invalid-directory case superseded) | Missing Docker/Compose, daemon unavailable, occupied port or health timeout | Nonzero exit with actionable error; no false success URL |
| AC-23 | Select a PCD from any folder in the browser | Local upload imports it correctly without mounting the whole host filesystem |
| AC-24 | Export cleaned PCD and save session | Browser offers completed host downloads; input is untouched and export/session filenames are clear |
| AC-25 | Recreate container, then reopen a downloaded default session | Embedded source and saved state restore without the old upload path |
| AC-26 | Inspect networking and container behavior | Host service is loopback-only; root filesystem is read-only; unintended cross-origin changes are rejected (**superseded, part 8:** source mount and path traversal/symlink escapes no longer exist) |
| AC-27 | Repeated launch or changed port (**part 8:** no data directory) | Compatible healthy instance is reused; incompatible settings cannot be silently ignored |
| AC-28 | Stop and rebuild | This project's containers stop/rebuild without deleting source files, downloaded exports or the retained working volume |
| AC-29 | Image already built, external network disconnected | Launch and all required editing/import/export/session behavior work without package downloads or remote assets |
| AC-30 | Benchmark and primary walkthrough | Results name reference PC, schema, sizes, timings and peak RAM; full-resolution counts and floor protection remain correct under reduced render budgets |
| AC-31 | Run required verification commands | `verify` and `lint` services and the Linux launcher/container CI job pass, with genuine nonzero propagation on a deliberately failing check |

## Detailed requirements

The following retained sections are normative and make this spec self-contained. The Docker, launcher, file-handling and session requirements above supersede the original optional-container/native-launch wording. Session portability wording below incorporates the confirmed browser workflow. The original product purpose and v1 priority list are represented by Goals, Non-goals and Scope above.

### 4. User interface

Use a large central 3D viewport, compact tool controls, an inspector panel and a bottom status bar.

| Area | Contents |
| --- | --- |
| Main toolbar | Open, save session, export PCD, undo, redo, preview deletion, apply deletion |
| View controls | Six standard views, perspective/orthographic toggle, fit cloud, fit selection, pivot controls |
| Editing tools | Box, polygon with height range, cluster selection, select displayed, invert, clear |
| Inspector | Numeric geometry, XYZ display limits, floor protection, selection scope and operation |
| Status | Original/remaining/displayed/selected/protected/candidate counts, processing progress and render detail |
| Comparison controls | Original, edited, deleted-points overlay, synchronized split view |

Controls must have tooltips. Show active selection mode and coordinate frame persistently. Numeric inputs and handles must remain synchronized during interaction.

### 5. PCD import and authoritative data

- Accept `.pcd` through a file picker and drag-and-drop.
- Support ASCII, binary and binary-compressed PCD encodings.
- Parse `FIELDS`, `SIZE`, `TYPE`, `COUNT`, `WIDTH`, `HEIGHT`, `POINTS` and `VIEWPOINT` when present.
- Preserve field names, order, numeric types, element counts and values for all retained records, including intensity, packed RGB/RGBA, ring, timestamps and unknown custom fields.
- Do not round-trip arbitrary records through an XYZ-only representation.
- Reject invalid or unsupported files with a specific explanation; never silently discard fields.
- Require usable X, Y and Z fields. Keep records with invalid/non-finite XYZ in the source data but exclude them from spatial operations and rendering. Show their count and offer an explicit remove-invalid-points operation.
- Keep the imported source immutable. Maintain stable point identifiers based on original record indices and a separate active/deleted state.
- Display filename, encoding, field schema, point counts, bounds and coordinate ranges after import.
- Assume metres for interaction defaults but expose an explicit unit setting. PCD does not reliably encode units; do not infer a scale silently.
- Keep original coordinates unchanged. Any GPU recentering for display must be reversed for picking and must never change stored/exported coordinates.

### 6. View and navigation

- Orbit, pan and zoom with documented mouse/keyboard controls.
- Provide top (+Z looking toward -Z), bottom (-Z looking toward +Z), front (-Y toward +Y), back (+Y toward -Y), left (-X toward +X) and right (+X toward -X) presets.
- Standard views use orthographic projection and include a labelled XYZ orientation widget. Provide a perspective toggle.
- Switching views preserves the inspection target and fits only when requested.
- Set the orbit pivot by picking a point or entering XYZ coordinates. Render a small pivot marker.
- Reset pivot to the centre of the active cloud's axis-aligned bounds; also offer selection-centre pivot and fit-to-cloud.
- Camera/pivot changes never transform point data.
- Support adjustable point size and uniform, RGB, height and intensity colouring where fields are available. Provide a high-contrast selection palette.

### 7. 3D box selection

The box is an oriented volume with centre `c`, positive dimensions `(dx, dy, dz)` and orientation `R`. In box-local coordinates, point `p` is inside when every component of `abs(R^T (p-c))` is at most half the corresponding dimension. Boundaries are inclusive.

#### Direct manipulation

- X/Y/Z translation arrows move the whole box along the selected axes.
- Each pair of box faces has resize handles. Dragging one face changes that extent while holding the opposite face fixed; provide an optional symmetric-resize modifier.
- X/Y/Z rotation rings rotate the box about its centre.
- Clearly differentiate translation arrows, face-resize handles and rotation rings.
- Offer world/local axes for translation. Resize always follows box-local axes.
- Dragging a handle must not accidentally orbit the camera.
- Support optional translation/angle snapping with editable increments and a precision modifier.

#### Numeric manipulation

- Provide centre X/Y/Z, dimensions X/Y/Z and roll/pitch/yaw in degrees.
- Also provide min/max XYZ editing when the box is world-axis-aligned. Disable those fields for rotated boxes and explain why; show read-only world bounding extents separately.
- Use a documented rotation convention: `R = Rz(yaw) Ry(pitch) Rx(roll)` mapping box-local vectors into world coordinates. Store a quaternion internally.
- Provide reset rotation, fit box to cloud, fit box to selection and reset box.
- Reject non-finite values and non-positive dimensions without losing the previous valid box.
- Support select-inside and select-outside. Moving a box updates a preview, not committed deletion.

### 8. XYZ display filtering and selection

- Provide independent X min/max, Y min/max and Z min/max controls with numeric fields and dual-ended sliders.
- Filters are world-axis-aligned, use inclusive limits and combine with logical AND.
- Allow each axis filter to be disabled; provide reset-to-cloud-bounds and reset-all.
- Make the distinction explicit: display filtering hides points; it does not delete them or make the filter itself a committed selection.
- `Select displayed` evaluates all active finite-coordinate source points satisfying these limits, including points omitted from rendering by level of detail.
- Selection tools expose a scope selector: `Displayed points` (default) or `All active points`.
- In displayed scope, hidden points cannot enter the selection. In all-active scope, show a persistent notice and count of selected points outside the display filter.
- Scissors/polygon selections include points through the view depth unless a height/depth bound is explicitly enabled. Describe this in the UI.
- Before applying deletion, require a completed candidate evaluation for the current filter, selection geometry and protection revision.

### 9. Polygon selection with height limits

- In top view, let the user draw/edit an XY polygon and enter Z minimum/maximum.
- The resulting selection is a vertical prism: inside the XY polygon AND within the Z interval.
- Allow dragging polygon vertices and upper/lower Z handles, plus numeric vertex and Z input.
- Support inside/outside selection with explicit highlighting of the result.
- Closing the polygon creates a preview. Escape cancels the drawing; Enter finishes a valid polygon.
- Reject self-intersecting or degenerate polygons with a useful message.
- This is the primary tool for removing irregular reflected regions while protecting low points.

### 10. Global and per-selection height protection

- Provide optional global protection over a Z interval, for example `[-0.05, +0.10] m`; default it to disabled until the user confirms the actual floor height.
- Each selection can use: `Inherit global`, `Add local protected interval`, or `Override global for this operation`.
- In additive mode, global and local protected sets are combined by union. In override mode, explicitly disable global protection for that operation and use only the local interval; require a visible acknowledgement when switching to override.
- Provide numeric lower/upper Z inputs and draggable height-plane handles for both intervals. Plane handles move along world Z; these intervals do not rotate with the selection box.
- Protection has precedence over selection and inversion: protected selected points remain active after deletion.
- Show protected candidates distinctly and report how many selected points will be retained by protection.
- Version 1 protects a coordinate slab, not a semantic floor. It may also protect low objects and may not fit ramps or uneven floors; explain this in the tool description.

### 11. Connected-cluster selection

- Activate the cluster tool, pick a seed point, set a maximum neighbour distance in world units and preview the connected component.
- Resolve the picked rendered point to a stable source point ID. Optionally refine picking against nearby full-resolution points.
- Define connectivity using a Euclidean radius graph: points are connected if a chain of pairwise distances no greater than the configured radius exists.
- Use a spatial index; do not compute all pairwise distances.
- Offer scope restricted to the displayed subset and/or current box/prism. Default to displayed scope.
- Exclude protected points from traversal by default so the floor cannot connect otherwise separate structures. Expose this policy explicitly; do not silently change it.
- Show seed, radius, component size, bounds and candidate deletion count.
- Support replacing, adding to and subtracting from the current selection.
- Radius changes recompute the full component. Dense artefacts connected to real walls may be inseparable with this method; the preview must expose bridges rather than imply semantic recognition.
- Long computations must be cancellable. A configurable warning threshold may pause a very large expansion, but a partial component must never be labelled complete or committed silently.

### 12. Selection, preview and deletion semantics

Let `A` be active source IDs, `F` the display-filter subset, `S` the accumulated selection and `P` the effective protected set. The candidate deletion set is `D = (A intersect S) minus P`. Selection scope determines whether a tool contributes from `A` or `F`.

- Support replace, union/add, subtract and intersect selection operations.
- Invert selection relative to the explicitly selected scope, not an ambiguous universe.
- Clear selection does not change geometry or delete points.
- Use separate visual styles for unselected, selected-for-deletion and selected-but-protected points.
- Preview includes exact full-resolution counts and updates after numeric or handle edits.
- Applying deletion changes the active mask, not source records. Cancel changes nothing.
- A selection snapshot must record its scope, filter bounds, geometry, protection settings and source revision so the preview is reproducible.
- Any change during a background computation invalidates stale results. Disable Apply until a current completed result is available.

### 13. Before/after comparison

- Preserve the original import as the comparison baseline throughout the session.
- Provide original-only and edited-only modes, a deleted-points overlay, and a synchronized side-by-side mode.
- In split view, synchronize camera, projection, pivot, point size and colouring. Apply identical display filters to both panes by default.
- Render deleted points in a distinct colour with adjustable opacity in overlay mode.
- Show original count, remaining count, deleted count and deletion percentage.
- Offer a temporary press-and-hold original view for rapid checking.
- Comparison is read-only: original/deleted points cannot be picked as editing seeds unless the user returns to the edited view.
- Render budgets may differ from total counts; clearly label LOD and never present rendered counts as true cloud counts.

### 14. Undo, redo and sessions

- Undo/redo every committed deletion and explicit invalid-point removal using stable source IDs.
- Applying a new edit after undo clears the redo branch. Record a human-readable operation description and counts.
- Camera navigation does not fill the deletion history.
- Save a versioned session containing source identity/hash, full field schema or referenced source, deletion mask/history, active selection, saved regions, filters, protection, colouring and camera/pivot state.
- Default downloaded sessions embed the original source and editing state so they can reopen after container recreation without relying on a temporary upload path. A versioned archive can contain the original PCD and a manifest. Validate source hash, schema and archive paths before accepting it. Referenced-source sessions are optional; verify the source hash and request browser reselection when missing.
- Produce a complete session archive before offering its browser download. Warn before closing with unsaved edits where the browser supports it, and show persistent unsaved status. A download request alone must not be presented as proof that the user saved a file successfully.

### 15. Export

- Default export is all remaining active points, regardless of display filters, selection and LOD.
- Offer a separately labelled `Export selected` or `Export displayed` mode only with an explicit scope summary.
- Support binary PCD by default and optional ASCII; binary-compressed export is optional in version 1.
- Preserve all retained field values and ordering; preserve source `VIEWPOINT` unless explicitly changed by a future transformation feature.
- Export records in original source order. After deletion, export as unorganized PCD with `HEIGHT=1`, `WIDTH=remaining_count` and consistent `POINTS`. Explain that original organized structure is lost when records are removed.
- Preserve organization when exporting an untouched source if supported. Do not invent placeholder points to retain dimensions after deletion.
- Preserve retained invalid records unless explicitly removed; report their count in the export summary.
- Never overwrite the input by default. Suggest `<original>_cleaned.pcd` and require explicit confirmation for an existing destination.
- Export through an atomic temporary-file-and-rename workflow or a completed browser download. Never present a partial output as successful.
- Verify exported count/schema and reparse during implementation validation.

### 16. Full-resolution editing and architecture

The local processing engine owns the authoritative records, stable IDs, masks and spatial index. The browser renders a bounded representation and sends selection parameters, not a claim that rendered vertices represent the complete cloud.

- Rendering may use sampling, tiles or LOD. All spatial filters, box/prism membership, cluster traversal, deletion, undo and export must operate on full-resolution source records.
- A display sample never becomes the source for a subsequent edit.
- Evaluate geometric membership using original coordinate precision; document any boundary tolerance and apply it consistently across preview and commit.
- Perform parsing, spatial queries and export away from the browser UI thread. Provide progress, cancellation and clear memory errors.
- Tie every asynchronous result to cloud and operation revisions. Cancel or discard obsolete work when geometry or filters change.
- For large coordinates, use a local GPU origin while retaining full precision in the processing engine.
- Estimate memory needs before expensive operations. If a cloud exceeds the supported budget, refuse gracefully rather than silently downsampling the editing dataset.
- Implementation may use any suitable renderer/backend, but field preservation and full-resolution correctness are release gates. Choose dependencies only after validating their PCD read/write behaviour with custom-field fixtures.

### 17. Performance targets

Initial targets, to be benchmarked on a documented desktop Linux reference PC with 16 GB RAM and hardware-accelerated graphics:

- Interactive navigation at approximately 30 FPS with an adaptive render budget.
- Comfortable editing of 1 million points; target 10 million where the field schema and available RAM permit.
- Show progress for operations exceeding one second; acknowledge cancellation promptly.
- Display a quick approximate drag preview if needed, followed by a clearly marked exact full-resolution preview before Apply becomes available.
- Publish import, selection, clustering, export timings and peak RAM for both representative sizes. These are engineering targets, not guarantees for arbitrary files or hardware.

### 18. Acceptance criteria

| ID | Scenario | Expected result |
| --- | --- | --- |
| AC-01 | Import ASCII, binary and binary-compressed fixtures with custom fields | Correct records/schema; no silent field loss |
| AC-02 | Box above a floor slab overlaps the same XY footprint | Only points inside its 3D volume are candidates; floor below remains |
| AC-03 | Enter centre, dimensions and rotation, then drag handles | Both controls represent the same geometry without transforming the cloud |
| AC-04 | Set six XYZ limits and Select displayed | Exact full-resolution filtered set is selected, including undrawn LOD points |
| AC-05 | Select an XY polygon with Z limits | Only points in the resulting prism are selected |
| AC-06 | Global protection and additive local protection overlap a selection | Both protected intervals survive deletion |
| AC-07 | Explicitly override global protection for one operation | Preview clearly reflects only the local protection; later inherited operations use global protection again |
| AC-08 | Cluster seed belongs to a disconnected ghost structure | Exact radius-connected component in the chosen scope is selected |
| AC-09 | Cluster could connect through protected floor | Default traversal does not use protected floor points as bridges |
| AC-10 | Render only a small sample of a dense test cloud | Edits/export match full-resolution reference results, independent of render budget |
| AC-11 | Preview is computing while box/filter changes | Obsolete result cannot be applied |
| AC-12 | Delete, undo and redo | Exact source ID sets and field records are restored/reapplied |
| AC-13 | Original/edited/overlay and split comparison | Same coordinates/camera; deleted-point counts agree with active mask |
| AC-14 | Pick and reset orbit pivot; switch all six views | Camera changes correctly; data coordinates remain identical |
| AC-15 | Export after editing while display filters hide valid points | Default export includes all active points, including hidden ones |
| AC-16 | Reimport exported PCD | Retained record values/types/order and point count match expected output |
| AC-17 | Save/reopen session | Same deletions, protection, selection geometry and view; mismatched source rejected |
| AC-18 | Network disconnected after installation | All required features remain usable on localhost |

### 19. Primary walkthrough

1. Start the app locally and open a Unitree SLAM PCD map.
2. Inspect the map from top and side views; pick floor points to establish their actual Z range.
3. Enable global protection around that range, including a small measured noise margin.
4. Place a box around reflected geometry using arrows/face handles and rotation rings; refine values numerically.
5. Preview: ghost points are deletion candidates and floor points are protected.
6. Where useful, pick a ghost cluster within the displayed region; inspect its connectivity before applying.
7. Apply deletion, compare before/after, and undo any over-removal.
8. Save the editing session and export a new full-resolution PCD with every retained field preserved.

## Part 10 addendum

- Section 8: the dual-ended sliders are superseded by on-canvas filter boxes (grips, cut planes with arrows, typed
  values, per-side and global reset). Filters stay world-axis-aligned, inclusive and ANDed; the numeric control ids are kept.
- Section 10: the protected slab may be tilted about X and Y (each within 60 degrees) around a pivot at the
  active-bounds XY centre, to follow a sloping floor. A level slab behaves as before. It is still a plane, not a surface.
- AC-17 stands and covers the tilt (a non-level tilt is stored in the session). AC-15 is unchanged.
