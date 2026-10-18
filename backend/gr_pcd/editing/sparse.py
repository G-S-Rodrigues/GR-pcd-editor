"""Sparse-point artifact filter (part 13-2): select isolated points, keep dense surfaces.

A point is selected when the number of active valid points in its 3x3x3 neighbourhood of cubes (cube edge = the
radius, counted with sorted cube keys and `searchsorted`) is below `min_neighbours`, itself included. Walls and
floors have dense neighbourhoods and are never selected; isolated mid-room points are.

The count is an upper-bound proxy for "points within the radius": the neighbourhood is a 3 x radius cube, not a
ball, so a point is never called isolated when a real radius count would be dense enough. Exact radius counting is
out of scope. Points at the very edge of a surface see half a neighbourhood: keep `min_neighbours` low.

Not a tolerance-bearing predicate: counts are integers on a grid, there is no float comparison at a boundary other
than the cube assignment (floor of the offset coordinate), which is the same for preview and commit.
"""

import math
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from gr_pcd.editing.cancel import CancelToken
from gr_pcd.editing.errors import EditError
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.geometry.prism import PrismSpec

DEFAULT_MIN_NEIGHBOURS = 8
MAX_MIN_NEIGHBOURS = 1_000_000
AUTO_FACTOR = 6.0  # auto radius = this many median nearest-neighbour distances
AUTO_SAMPLE = 50_000
MAX_KEY = 1 << 62
SPARSE_BYTES_PER_POINT = 64


@dataclass(frozen=True)
class SparseSpec:
    radius: float | None = (
        None  # None: derived from the sample spacing (`auto_radius`)
    )
    min_neighbours: int = DEFAULT_MIN_NEIGHBOURS
    region: BoxSpec | PrismSpec | None = None
    exclude_protected: bool = True


def validate_sparse(spec: SparseSpec) -> None:
    r = spec.radius
    if r is not None and (
        isinstance(r, bool) or not math.isfinite(r) or not r > 0
    ):
        raise EditError("invalid_tool", "the sparse radius must be above 0")
    m = spec.min_neighbours
    if (
        isinstance(m, bool)
        or not isinstance(m, int)
        or not (1 <= m <= MAX_MIN_NEIGHBOURS)
    ):
        raise EditError("invalid_tool", "min neighbours must be at least 1")


def auto_radius(xyz: np.ndarray) -> float:
    """Cube edge from the sample spacing: AUTO_FACTOR x the median nearest-neighbour distance.

    The distance is measured on a sample of at most AUTO_SAMPLE points and scaled to the full cloud as a surface
    (spacing ~ 1/sqrt(density)), the shape indoor scans have."""
    n = len(xyz)
    if n < 2:
        return 1.0
    if n > AUTO_SAMPLE:
        idx = np.random.default_rng(0).choice(n, AUTO_SAMPLE, replace=False)
        sub = xyz[idx]
    else:
        sub = xyz
    d, _ = cKDTree(sub).query(sub, k=2)
    nn = float(np.median(d[:, 1]))
    if not nn > 0:
        nn = max(float((xyz.max(axis=0) - xyz.min(axis=0)).max()), 1.0) * 1e-6
    return AUTO_FACTOR * nn * math.sqrt(len(sub) / n)


def neighbourhood_counts(
    pts: np.ndarray, radius: float, token: CancelToken | None = None
) -> np.ndarray:
    """For every row of `pts` (n, 3): how many rows lie in its 3x3x3 cubes (itself included)."""
    n = len(pts)
    if n == 0:
        return np.zeros(0, dtype=np.int64)
    rel = pts - pts.min(axis=0)
    cells = rel.max(axis=0) / radius + 3.0  # a cube of margin on every side
    if (
        not np.isfinite(cells).all()
        or float(np.prod(np.minimum(cells, 1e30))) >= MAX_KEY
    ):
        raise EditError(
            "invalid_tool",
            "the sparse radius is too small for the extent of the cloud",
        )
    ijk = np.floor(rel / radius).astype(np.int64) + 1
    dims = ijk.max(axis=0) + 2
    key = (ijk[:, 0] * dims[1] + ijk[:, 1]) * dims[2] + ijk[:, 2]
    del ijk, rel
    uniq, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
    del key
    total = np.zeros(len(uniq), dtype=np.int64)
    last = len(uniq) - 1
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                if token is not None:
                    token.check()
                other = uniq + (dx * dims[1] + dy) * dims[2] + dz
                pos = np.minimum(np.searchsorted(uniq, other), last)
                total += np.where(uniq[pos] == other, cnt[pos], 0)
    return total[inv]


def sparse_mask(
    xyz: np.ndarray,
    counted: np.ndarray,
    radius: float,
    min_neighbours: int,
    token: CancelToken | None = None,
) -> np.ndarray:
    """Bool (n,): True for a counted point with fewer than `min_neighbours` counted points around it."""
    idx = np.flatnonzero(counted)
    out = np.zeros(len(xyz), dtype=bool)
    if len(idx) == 0:
        return out
    counts = neighbourhood_counts(xyz[idx], radius, token)
    out[idx[counts < min_neighbours]] = True
    return out
