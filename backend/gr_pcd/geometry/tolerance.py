"""Single source of the geometric tolerance policy.

All predicates evaluate in float64 on the exact stored coordinates (float32
sources are cast losslessly). Boundaries are inclusive. Preview and commit
share one code path: commit re-uses the stored candidate and never
recomputes.

* GEO_EPS_WORLD = 0: world-axis-aligned tests (XYZ filter, prism Z range,
  axis-aligned box). With all angles 0 the rotation is skipped entirely.
* GEO_EPS_ROTATED = 1e-9 (absolute, coordinate units): slack on rotated-box
  local extents, covering float64 rotation round-off. The tilted protection
  slab uses it too, on the slab coordinate s = n . (p - pivot).
* GEO_EPS_EDGE = 1e-9: a point within this distance of a polygon edge counts
  as inside.
* CLUSTER_REL = 1e-12: relative slack on the cluster radius (inclusive).
* Duplicate distance (thin tool, part 20): two points are duplicates when |p - q|^2 <= eps^2 in float64 on the
  stored coordinates, inclusive, no slack. The pair search queries at eps x (1 + 1e-12) and rechecks every pair
  above eps x (1 - 1e-9) with that exact squared rule, as the cluster search does.
* Plane membership (planes tool, part 20): |n . p - d| <= thickness + GEO_EPS_ROTATED, inclusive, float64.

Tests keep near-boundary gaps either exactly 0 (dyadic coordinates) or
>= 1e-6, so the slack never decides a test.
"""

GEO_EPS_WORLD = 0.0
GEO_EPS_ROTATED = 1e-9
GEO_EPS_EDGE = 1e-9
CLUSTER_REL = 1e-12
