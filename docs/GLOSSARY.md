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
- **Candidate:** The exact set of points a previewed selection would delete,
  after height protection has been applied; Apply deletes exactly this set.
- **Draft:** A tool shape that has been edited but not yet committed to the
  selection (Add, Subtract and Intersect operations); nothing is sent until it
  is committed.
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
