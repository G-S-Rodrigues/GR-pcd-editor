# Glossary

- **PCD:** Point Cloud Data file containing point records and their fields.
- **Source record:** An immutable original point record, including all retained
  fields.
- **Active/deleted mask:** The authoritative state identifying source records
  currently retained or removed from the edited cloud.
- **Display filter:** A non-destructive visibility limit used while viewing a
  cloud.
- **Selection:** The set of source records targeted by an editing operation.
- **Protected set:** Source records excluded from deletion operations.
- **Authoritative processing:** Full-resolution backend processing that defines
  edits and exports.
- **Rendered/LOD point:** A display representation that may be sampled for
  responsiveness without changing authoritative data.
- **Work volume:** The Docker volume that holds uploads, exports, session
  archives and live session data; it is the only persistent thing the container writes (plus a 256 MiB `/tmp` tmpfs).
- **Session:** Versioned editing state, optionally including the source cloud,
  that can be reopened later.
- **Face arrow:** The axis-coloured arrow (filled head) of the Box tool that starts on a box face and resizes that face
  when dragged (Alt: both opposite faces); it never moves the box.
- **Rotation ring:** The small ring on each face arrow (six in all); dragging it turns the box about that arrow's box
  axis. A ring seen edge-on cannot be grabbed, and only its outline is grabbable: its inside still moves the box.
  The protection band's tilt rings use the same look.
- **Box body:** The inside of the box on the canvas: a plain left-drag there moves the box, Ctrl+drag orbits,
  Shift+drag pans, and an unmoved click still moves the box to the clicked point.
- **Candidate:** The exact set of points a previewed selection would delete,
  after height protection has been applied; Apply deletes exactly this set.
- **Draft:** A tool shape that has been edited but not yet committed to the
  selection (Add, Subtract and Intersect operations). The server previews its
  result live (the **preview**); the selection changes only on Commit draft.
- **First selection:** The live selection made while nothing is selected: each edit of the shape replaces the
  selection at once (no operation icon is pressed, nothing is previewed). Choosing Add, Subtract or Intersect, or
  committing, ends it.
- **Edit shape:** Reopens a history step's stored shape (box, polygon, cluster or sparse parameters) as a live first
  selection of its tool. It clears the selection, never changes the history, and a later delete is a new step.
- **Step shape:** The editable shape a step was made with, stored with the step in the session; steps from older
  sessions have none.
- **Sparse points:** A selection tool for isolated points: a point is selected when fewer than a set number of points
  lie in the 3 x 3 x 3 cubes around it.
- **Preview:** The server's computed result of a draft, held until it is
  committed, discarded or made stale: counts (selected after, added, removed)
  and the points it would add or remove, drawn in their own colours. It never
  changes the selection, the candidate or the history.
- **Committed selection:** The selection as the server holds it, without any
  preview; Apply deletes exactly its candidate.
- **LOD:** Level of detail; the sampled subset of points drawn in the viewport
  (shown as "Rendered"), never a cloud total.
- **Filter box:** One of the six on-canvas controls (X, Y, Z, min and max) that
  sets a side of the display filter; it has a grip, a typed value, a reset and a
  collapse chip.
- **Cut plane:** The plane drawn for an expanded filter side, with an arrow toward
  the hidden side; dragging the arrow sets that side's limit.
- **Protection band:** The translucent slab drawn on the canvas with its outline,
  the Box's face arrows (+Z and -Z on each protection plane) and, while the Height
  protection section is open, four tilt rings on headless X and Y shafts at the
  footprint's side faces; points inside it are drawn in the strong protected
  colour while the section is open. **Show band** (a switch in the section) hides
  the whole band on the canvas while protection stays on; a canvas pill then says
  "Protection on - band hidden" and offers Show.
- **Tilted slab:** The protected interval measured along a normal turned by
  rx and ry (each within 60 degrees) about a pivot at the active-bounds XY centre,
  instead of along Z. Level (both angles 0) is the plain Z slab.
- **Step:** One applied deletion or layer edit in the history, with a stable id, the tool that made it, an optional name and the
  count of points it removed; shown as a card in the timeline.
- **Layer step:** A step made by a layer edit (create, assign, set to selection, merge, To main). Its card reads Layer
  edit N and Undo, Redo and the marker move it like a deletion.
- **Dependent step:** A layer step that a later layer step builds on (it moves some of the same points); its delete is
  refused until the later one is removed.
- **Per-layer export:** The Export option One file per layer: one PCD per chosen layer named
  `<original>_<layer>_cleaned.pcd`, Main as `main`; layers with no points in scope are skipped and listed.
- **Timeline:** The strip under the view with one card per step and a marker; it is saved in the session archive.
- **Marker:** The cursor between steps; steps before it are applied, steps after it are rolled back (greyed). Undo and
  Redo move it one slot.
- **Rolled back:** A step after the marker: its points are active again, and applying a new deletion discards it.
- **Step highlight:** The overlay of one step's deleted points in a distinct colour, a view-only layer that changes no
  count.
- **Selected colour:** The preset colour (Orange default, Magenta, White, Lime) the canvas and the legend use for selected
  points; a view setting saved with the session. The preview add and remove colours, protected and step colours are not
  user choices.
- **Layer:** A named group of points (at most 32) with a colour and a visibility flag. A point is in at most one layer;
  Undoing a deletion puts the points back into their layer. Saved in the session (version 2).
- **Protected layer:** A layer whose points are never deleted by any Delete or Apply. They count in Kept by protection
  like the height band, are shown in the legend line "in protected layers", and are saved with the session. Override
  protection frees only the height band, never a protected layer.
- **Locked layer:** A layer whose membership is fixed: no points can be assigned into or out of it, and Edit layer, To
  main and Merge are refused. Its points can still be deleted (unless it is also protected). Distinct from protected.
- **Floor layer:** The layer made by New layer from protected points: a snapshot of the points inside the global height
  band at that moment, named Floor, protected. The band stays on afterwards.
- **Merge:** Layer A joins layer B and A goes away; B keeps its name, colour, visibility and flags. Confirmed first.
- **Layer order:** The stored order of the layers (Up and Down in the layer menu); it is the legend and row order and is
  saved with the session.
- **Main:** The points that are in no layer. Always present, never hidden by itself.
- **Hidden layer:** A layer whose visibility is off: its points are not drawn, picked or selected by any tool, and still
  count and export.
- **Hidden points:** The points of hidden layers. Hide selected puts the selection in the layer named Hidden and hides it.
- **Max points:** The cluster tool's exact cap: when the component is larger, the selection is the Max points points
  nearest to the seed, ordered by (hop count, distance, point index). Empty means no limit.
- **Show hidden:** Makes every hidden layer visible again and selects the members of the layer named Hidden, so Delete
  works at once; a user layer hidden by its eye comes back visible and is not selected.
- **Detected plane:** A plane found by the Planes tool's Detect (RANSAC on a sample of the eligible points, near-horizontal
  by default): normal, offset, point count and tilt, listed lowest first. Detection is read only and the list is not saved.
  Not the same as the protection band's plane handles or a cut plane.
- **Planes tool:** Detect lists up to 4 Detected planes; choosing a row selects the points within the Distance of it
  (default 0.03 file units) so Delete removes them. The row labels "Lowest (floor?)" and "Highest (ceiling?)" are hints.
- **Use as protection band:** A list row action that makes the height protection band follow a Detected plane (tilted
  when the plane is tilted; each tilt angle at most 60 degrees). An enabled band is replaced only after a confirm.
- **Thin tool:** Selects duplicate points or a voxel subsample, always as a selection that Delete then removes (Undo
  brings them back); the lowest-index point of each group stays.
- **Duplicate (eps rule):** With distance 0, a point whose coordinates equal an earlier point's; with distance above 0, a
  point with an earlier point within that distance (inclusive, so chains collapse to their first point).
- **Voxel subsample:** Keeps the lowest-index point in each cube of the given edge (cubes start at the minimum of the
  eligible points) and selects the rest.
