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
- **Mounted folder:** The configured host directory exposed read-only to the
  application container.
- **Session:** Versioned editing state, optionally including the source cloud,
  that can be reopened later.
- **Candidate:** The exact set of points a previewed selection would delete,
  after height protection has been applied; Apply deletes exactly this set.
- **Draft:** A tool shape that has been edited but not yet committed to the
  selection (Add, Subtract and Intersect operations); nothing is sent until it
  is committed.
- **LOD:** Level of detail; the sampled subset of points drawn in the viewport
  (shown as "Rendered"), never a cloud total.
