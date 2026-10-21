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
- **Protection band:** The translucent slab drawn on the canvas while the Height
  protection section is open, with an arrow per plane; points inside it are
  drawn in the strong protected colour.
- **Tilted slab:** The protected interval measured along a normal turned by
  rx and ry (each within 60 degrees) about a pivot at the active-bounds XY centre,
  instead of along Z. Level (both angles 0) is the plain Z slab.
- **Step:** One applied deletion in the history, with a stable id, the tool that made it, an optional name and the
  count of points it removed; shown as a card in the timeline.
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
- **Main:** The points that are in no layer. Always present, never hidden by itself.
- **Hidden layer:** A layer whose visibility is off: its points are not drawn, picked or selected by any tool, and still
  count and export.
- **Hidden points:** The points of hidden layers. Hide selected puts the selection in the layer named Hidden and hides it.
- **Max points:** The cluster tool's exact cap: when the component is larger, the selection is the Max points points
  nearest to the seed, ordered by (hop count, distance, point index). Empty means no limit.
- **Show hidden:** Makes every hidden layer visible again and selects the members of the layer named Hidden, so Delete
  works at once; a user layer hidden by its eye comes back visible and is not selected.
