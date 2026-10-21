"""Thin tool (part 20): select duplicate points or the surplus points of a voxel grid.

Both methods keep the lowest source index of each group and select the rest, so they are deterministic and use
no random numbers. Only eligible points (scope, region, Exclude protected, valid) count, on both sides: a
duplicate whose lower-index twin is not eligible is not selected.

* `duplicates` with `distance` 0: exact coordinate duplicates (float64 rows, -0.0 equals +0.0).
* `duplicates` with `distance` > 0: a point is selected when any lower-index eligible point lies within the
  distance (inclusive, see geometry/tolerance.py). In a chain a, b, c spaced the distance apart, b and c are both
  selected: chains collapse to their first point.
* `voxel` with `edge`: voxel keys at that edge size (floor, as in the sparse filter); the first eligible point
  of each voxel is kept.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from gr_pcd.editing.cancel import CancelToken
from gr_pcd.editing.errors import EditError
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.geometry.prism import PrismSpec
from gr_pcd.geometry.voxel import voxel_keys
from gr_pcd.session.budget import check_budget

METHODS = ("duplicates", "voxel")
PAIR_BYTES = 48  # per (ordered) neighbour pair: the SciPy i/j/v entry plus the filtered copies, measured
PAIR_CHUNK_CAP = 4_000_000  # neighbour entries evaluated per step
THIN_BYTES_PER_POINT = 48  # named from the 20-4 measurement
DEDUP_REL = (
    1e-12  # query slack; the exact squared rule decides (see tolerance.py)
)


@dataclass(frozen=True)
class ThinSpec:
    method: str = "duplicates"
    distance: float = 0.0
    edge: float = 0.05
    region: BoxSpec | PrismSpec | None = None
    exclude_protected: bool = True


def validate_thin(spec: ThinSpec) -> None:
    if spec.method not in METHODS:
        raise EditError(
            "invalid_tool", "the thin method must be duplicates or voxel"
        )
    d, e = spec.distance, spec.edge
    if spec.method == "duplicates" and (
        isinstance(d, bool)
        or not isinstance(d, (int, float))
        or not math.isfinite(d)
        or d < 0
    ):
        raise EditError(
            "invalid_tool", "the duplicate distance must be 0 or more"
        )
    if spec.method == "voxel" and (
        isinstance(e, bool)
        or not isinstance(e, (int, float))
        or not math.isfinite(e)
        or not e > 0
    ):
        raise EditError("invalid_tool", "the voxel edge must be above 0")


def _exact_duplicates(pts: np.ndarray, token: CancelToken | None) -> np.ndarray:
    """Bool (m,): True for a row equal to an earlier row (-0.0 equals +0.0)."""
    m = len(pts)
    out = np.zeros(m, dtype=bool)
    if m < 2:
        return out
    x, y, z = pts[:, 0] + 0.0, pts[:, 1] + 0.0, pts[:, 2] + 0.0  # -0.0 -> +0.0
    if token is not None:
        token.check()
    order = np.lexsort((z, y, x))  # stable: equal rows stay in index order
    if token is not None:
        token.check()
    xs, ys, zs = x[order], y[order], z[order]
    same = (xs[1:] == xs[:-1]) & (ys[1:] == ys[:-1]) & (zs[1:] == zs[:-1])
    out[order[1:][same]] = True
    return out


def _near_duplicates(
    pts: np.ndarray,
    eps: float,
    token: CancelToken | None,
    budget: int | None,
    on_progress: Callable[[float], None] | None,
) -> np.ndarray:
    """Bool (m,): True when an earlier row lies within eps (inclusive, exact float64 squared rule)."""
    m = len(pts)
    out = np.zeros(m, dtype=bool)
    if m < 2:
        return out
    reach = eps * (1.0 + DEDUP_REL)
    tree = cKDTree(pts)
    counts = tree.query_ball_point(pts, reach, return_length=True)
    pairs = int(counts.sum(dtype=np.int64))
    if token is not None:
        token.check()
    if budget is not None:
        check_budget(
            pairs * PAIR_BYTES,
            budget,
            "the duplicate search",
            "Use a smaller distance, a region, or a coarser voxel grid.",
        )
    eps2 = eps * eps
    cum = np.cumsum(counts, dtype=np.int64)
    del counts
    lo = 0
    while lo < m:
        if token is not None:
            token.check()
        # cut on cumulative per-row counts, so a dense blob cannot land in one chunk
        base = int(cum[lo - 1]) if lo else 0
        hi = int(np.searchsorted(cum, base + PAIR_CHUNK_CAP, "right"))
        hi = min(m, max(hi, lo + 1))
        sub = cKDTree(pts[lo:hi])
        mat = sub.sparse_distance_matrix(tree, reach, output_type="ndarray")
        i, j, v = mat["i"] + lo, mat["j"], mat["v"]
        keep = j < i
        i, j, v = i[keep], j[keep], v[keep]
        edge = np.flatnonzero(v > eps * (1.0 - 1e-9))
        if len(edge):
            d = pts[i[edge]] - pts[j[edge]]
            bad = (d * d).sum(axis=1) > eps2
            keep2 = np.ones(len(i), dtype=bool)
            keep2[edge[bad]] = False
            i = i[keep2]
        out[i] = True
        if on_progress is not None:
            on_progress(hi / m)
        lo = hi
    return out


def duplicate_mask(
    xyz: np.ndarray,
    eligible: np.ndarray,
    eps: float,
    token: CancelToken | None = None,
    budget: int | None = None,
    on_progress: Callable[[float], None] | None = None,
) -> np.ndarray:
    """Bool (n,): eligible points that repeat an earlier eligible point (exactly for eps 0, else within eps)."""
    out = np.zeros(len(xyz), dtype=bool)
    ok = eligible & np.isfinite(xyz).all(axis=1)
    idx = np.flatnonzero(ok)
    if len(idx) < 2:
        return out
    pts = xyz[idx]
    if eps == 0:
        dup = _exact_duplicates(pts, token)
    else:
        dup = _near_duplicates(pts, eps, token, budget, on_progress)
    out[idx[dup]] = True
    return out


def voxel_mask(
    xyz: np.ndarray,
    eligible: np.ndarray,
    edge: float,
    token: CancelToken | None = None,
) -> np.ndarray:
    """Bool (n,): eligible points that are not the first (lowest index) eligible point of their voxel."""
    out = np.zeros(len(xyz), dtype=bool)
    ok = eligible & np.isfinite(xyz).all(axis=1)
    idx = np.flatnonzero(ok)
    if len(idx) < 2:
        return out
    pts = xyz[idx]
    rel = pts - pts.min(axis=0)
    key, _ = voxel_keys(
        rel,
        edge,
        "the voxel edge is too small for the extent of the cloud",
        margin=0,
    )
    del rel
    if token is not None:
        token.check()
    _, first = np.unique(
        key, return_index=True
    )  # first occurrence = lowest index
    del key
    if token is not None:
        token.check()
    keep = np.zeros(len(idx), dtype=bool)
    keep[first] = True
    out[idx[~keep]] = True
    return out
