"""Single source of the geometric tolerance policy.

All predicates evaluate in float64 on the exact stored coordinates (float32
sources are cast losslessly). Boundaries are inclusive. Preview and commit
share one code path: commit re-uses the stored candidate and never
recomputes.

* GEO_EPS_WORLD = 0: world-axis-aligned tests (XYZ filter, prism Z range,
  axis-aligned box). With all angles 0 the rotation is skipped entirely.
* GEO_EPS_ROTATED = 1e-9 (absolute, coordinate units): slack on rotated-box
  local extents, covering float64 rotation round-off.
* GEO_EPS_EDGE = 1e-9: a point within this distance of a polygon edge counts
  as inside.
* CLUSTER_REL = 1e-12: relative slack on the cluster radius (inclusive).

Tests keep near-boundary gaps either exactly 0 (dyadic coordinates) or
>= 1e-6, so the slack never decides a test.
"""

GEO_EPS_WORLD = 0.0
GEO_EPS_ROTATED = 1e-9
GEO_EPS_EDGE = 1e-9
CLUSTER_REL = 1e-12
