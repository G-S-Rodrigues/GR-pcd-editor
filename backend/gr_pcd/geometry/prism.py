"""Polygon prism: XY polygon (boundary inclusive) AND z interval."""

import math
from dataclasses import dataclass

import numpy as np

from gr_pcd.editing.cancel import CHUNK, CancelToken, chunked_mask
from gr_pcd.geometry.errors import GeometryError
from gr_pcd.geometry.tolerance import GEO_EPS_EDGE

MAX_VERTICES = 10_000


@dataclass(frozen=True)
class PrismSpec:
    polygon: tuple[tuple[float, float], ...]
    z_min: float
    z_max: float
    mode: str = "inside"


def _bad(reason: str) -> GeometryError:
    return GeometryError("invalid_polygon", reason)


def _orient(a, b, c):
    return (b[..., 0] - a[..., 0]) * (c[..., 1] - a[..., 1]) - (
        b[..., 1] - a[..., 1]
    ) * (c[..., 0] - a[..., 0])


def _on_segment(a, b, p):
    return (
        (np.minimum(a[..., 0], b[..., 0]) <= p[..., 0])
        & (p[..., 0] <= np.maximum(a[..., 0], b[..., 0]))
        & (np.minimum(a[..., 1], b[..., 1]) <= p[..., 1])
        & (p[..., 1] <= np.maximum(a[..., 1], b[..., 1]))
    )


def validate_polygon(poly, z_min: float, z_max: float) -> np.ndarray:
    """Return the polygon as float64 (n, 2) or raise GeometryError."""
    if not (math.isfinite(z_min) and math.isfinite(z_max)):
        raise _bad("z limits must be finite")
    if z_min > z_max:
        raise _bad("z_min > z_max")
    if len(poly) < 3:
        raise _bad("a polygon needs at least 3 vertices")
    if len(poly) > MAX_VERTICES:
        raise _bad("too many vertices")
    p = np.asarray(poly, dtype=np.float64)
    if p.ndim != 2 or p.shape[1] != 2 or not np.isfinite(p).all():
        raise _bad("vertices must be finite [x, y] pairs")
    n = len(p)
    nxt = np.roll(p, -1, axis=0)
    if (p == nxt).all(axis=1).any():
        raise _bad("duplicate consecutive vertices")
    area2 = float(np.sum(p[:, 0] * nxt[:, 1] - nxt[:, 0] * p[:, 1]))
    if area2 == 0.0:
        raise _bad("zero area")
    for i in range(n):
        a, b = p[i], nxt[i]
        # adjacent edge folding back on itself
        c = nxt[(i + 1) % n]
        if _orient(a, b, c) == 0 and np.dot(b - a, c - b) < 0:
            raise _bad("edges fold back on each other")
        j = np.arange(i + 2, n)
        if i == 0:
            j = j[j != n - 1]
        if len(j) == 0:
            continue
        cc, dd = p[j], nxt[j]
        o1 = _orient(a, b, cc)
        o2 = _orient(a, b, dd)
        o3 = _orient(cc, dd, a)
        o4 = _orient(cc, dd, b)
        hit = ((o1 * o2) < 0) & ((o3 * o4) < 0)
        hit |= (o1 == 0) & _on_segment(a, b, cc)
        hit |= (o2 == 0) & _on_segment(a, b, dd)
        hit |= (o3 == 0) & _on_segment(cc, dd, a)
        hit |= (o4 == 0) & _on_segment(cc, dd, b)
        if hit.any():
            raise _bad("polygon is self-intersecting")
    return p


def _inside_polygon(px: np.ndarray, py: np.ndarray, poly: np.ndarray):
    inside = np.zeros(len(px), dtype=bool)
    near = np.zeros(len(px), dtype=bool)
    nxt = np.roll(poly, -1, axis=0)
    eps2 = GEO_EPS_EDGE * GEO_EPS_EDGE
    for (x1, y1), (x2, y2) in zip(poly.tolist(), nxt.tolist(), strict=True):
        cond = (y1 > py) != (y2 > py)
        if cond.any():
            xint = x1 + (py - y1) * (x2 - x1) / (y2 - y1 if y2 != y1 else 1.0)
            inside ^= cond & (px < xint)
        dx, dy = x2 - x1, y2 - y1
        t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
        t = np.clip(t, 0.0, 1.0)
        ex = px - (x1 + t * dx)
        ey = py - (y1 + t * dy)
        near |= (ex * ex + ey * ey) <= eps2
    return inside | near


def prism_contains(
    xyz: np.ndarray,
    valid: np.ndarray,
    spec: PrismSpec,
    token: CancelToken | None = None,
    chunk: int = CHUNK,
) -> np.ndarray:
    if spec.mode not in ("inside", "outside"):
        raise _bad(f"unknown mode {spec.mode}")
    poly = validate_polygon(spec.polygon, spec.z_min, spec.z_max)
    lo_xy = poly.min(axis=0) - GEO_EPS_EDGE
    hi_xy = poly.max(axis=0) + GEO_EPS_EDGE

    def evaluate(lo: int, hi: int) -> np.ndarray:
        pts = xyz[lo:hi]
        ok = valid[lo:hi]
        with np.errstate(invalid="ignore"):
            zin = (pts[:, 2] >= spec.z_min) & (pts[:, 2] <= spec.z_max)
            cand = (
                ok
                & (pts[:, 0] >= lo_xy[0])
                & (pts[:, 0] <= hi_xy[0])
                & (pts[:, 1] >= lo_xy[1])
                & (pts[:, 1] <= hi_xy[1])
            )
        inside = np.zeros(hi - lo, dtype=bool)
        idx = np.flatnonzero(cand)
        if len(idx):
            inside[idx] = _inside_polygon(pts[idx, 0], pts[idx, 1], poly)
        inside &= zin
        return ok & (inside if spec.mode == "inside" else ~inside)

    return chunked_mask(len(xyz), evaluate, token, chunk)
