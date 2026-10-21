"""Plane detection (seeded RANSAC) and plane membership (part 20).

Published algorithms only: plain RANSAC (Fischler and Bolles, 1981) on a seeded sample, then a least-squares refit
(centred 3x3 covariance, smallest eigenvector) on the full-resolution inliers.

* `detect_planes` is read-only and deterministic for one build: the same points, parameters and seed give identical
  floats. Hypotheses are scored with elementwise float64 arithmetic (no BLAS matmul) and the covariance is summed
  with numpy's pairwise sums in fixed chunks, so no sum depends on a thread count.
* `plane_mask` is the selection predicate: |n . p - d| <= thickness + GEO_EPS_ROTATED in float64, inclusive.
"""

import math
from dataclasses import dataclass

import numpy as np

from gr_pcd.editing.cancel import CHUNK, CancelToken
from gr_pcd.editing.errors import EditError
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.geometry.prism import PrismSpec
from gr_pcd.geometry.tolerance import GEO_EPS_ROTATED

RANSAC_SAMPLE = 200_000
SCORE_ELEMENTS = 4_000_000  # H_BATCH x sample <= this (float64 temporaries of about 32 MiB each)
DEGENERATE_AREA = 1e-12  # |cross| below this x extent^2 is a degenerate triple
MIN_SUPPORT = 0.01  # of the sample size
PLANE_BYTES_PER_POINT = (
    40  # named from the 20-4 measurement; refuses with 413 before allocation
)
MAX_PLANES = 8
MAX_ITERATIONS = 10_000


def h_batch(sample: int) -> int:
    """Hypotheses scored per batch for a sample of `sample` points."""
    return max(1, SCORE_ELEMENTS // max(1, sample))


@dataclass(frozen=True)
class PlaneDetectSpec:
    distance: float = 0.03
    max_tilt_deg: float = 30.0
    max_planes: int = 4
    iterations: int = 400
    seed: int = 0
    region: BoxSpec | PrismSpec | None = None
    exclude_protected: bool = True


@dataclass(frozen=True)
class PlaneSpec:
    normal: tuple[float, float, float]
    d: float
    thickness: float
    region: BoxSpec | PrismSpec | None = None
    exclude_protected: bool = True


@dataclass(frozen=True)
class Plane:
    normal: tuple[float, float, float]
    d: float
    count: int
    rms: float
    tilt_deg: float
    z_centre: float
    bounds_min: tuple[float, float, float]
    bounds_max: tuple[float, float, float]


def _finite_pos(v) -> bool:
    return (
        not isinstance(v, bool)
        and isinstance(v, (int, float))
        and math.isfinite(v)
        and v > 0
    )


def validate_planes(spec: PlaneDetectSpec) -> None:
    if not _finite_pos(spec.distance):
        raise EditError("invalid_tool", "the plane distance must be above 0")
    t = spec.max_tilt_deg
    if not _finite_pos(t) or t > 90:
        raise EditError(
            "invalid_tool",
            "the maximum tilt must be above 0 and at most 90 degrees",
        )
    m = spec.max_planes
    if (
        isinstance(m, bool)
        or not isinstance(m, int)
        or not 1 <= m <= MAX_PLANES
    ):
        raise EditError(
            "invalid_tool", f"the number of planes must be 1 to {MAX_PLANES}"
        )
    it = spec.iterations
    if (
        isinstance(it, bool)
        or not isinstance(it, int)
        or not 1 <= it <= MAX_ITERATIONS
    ):
        raise EditError(
            "invalid_tool", f"iterations must be 1 to {MAX_ITERATIONS}"
        )
    s = spec.seed
    if isinstance(s, bool) or not isinstance(s, int) or s < 0:
        raise EditError("invalid_tool", "the seed must be an integer from 0")


def validate_plane_spec(spec: PlaneSpec) -> None:
    n = spec.normal
    if (
        not isinstance(n, (tuple, list))
        or len(n) != 3
        or any(
            isinstance(c, bool)
            or not isinstance(c, (int, float))
            or not math.isfinite(c)
            for c in n
        )
    ):
        raise EditError(
            "invalid_tool", "the plane normal must be three finite numbers"
        )
    if abs(math.sqrt(sum(float(c) ** 2 for c in n)) - 1.0) > 1e-6:
        raise EditError("invalid_tool", "the plane normal must have length 1")
    if (
        isinstance(spec.d, bool)
        or not isinstance(spec.d, (int, float))
        or not math.isfinite(spec.d)
    ):
        raise EditError("invalid_tool", "the plane offset must be finite")
    if not _finite_pos(spec.thickness):
        raise EditError("invalid_tool", "the plane thickness must be above 0")


def plane_mask(
    xyz: np.ndarray,
    spec: PlaneSpec,
    token: CancelToken | None = None,
) -> np.ndarray:
    """Bool (n,): |n . p - d| <= thickness + GEO_EPS_ROTATED, float64, inclusive. NaN rows are False."""
    nx, ny, nz = (float(c) for c in spec.normal)
    lim = spec.thickness + GEO_EPS_ROTATED
    n = len(xyz)
    out = np.zeros(n, dtype=bool)
    with np.errstate(invalid="ignore", over="ignore"):
        for lo in range(0, n, CHUNK):
            if token is not None:
                token.check()
            c = xyz[lo : lo + CHUNK]
            r = nx * c[:, 0]
            r += ny * c[:, 1]
            r += nz * c[:, 2]
            r -= spec.d
            np.abs(r, out=r)
            out[lo : lo + len(c)] = r <= lim
    if token is not None:
        token.check()
    return out


def _residual(pts: np.ndarray, n: np.ndarray, d: float) -> np.ndarray:
    r = n[0] * pts[:, 0]
    r += n[1] * pts[:, 1]
    r += n[2] * pts[:, 2]
    r -= d
    return np.abs(r, out=r)


def _refit(
    xyz: np.ndarray,
    idx: np.ndarray,
    n: np.ndarray,
    d: float,
    dist: float,
    token: CancelToken | None,
) -> tuple[np.ndarray, float, int]:
    """Least-squares plane through the points of `idx` within `dist` of (n, d). Returns (n, d, inlier count)."""
    count = 0
    s = np.zeros(3)
    for lo in range(0, len(idx), CHUNK):
        if token is not None:
            token.check()
        c = xyz[idx[lo : lo + CHUNK]]
        m = _residual(c, n, d) <= dist
        count += int(m.sum())
        s += c[m].sum(axis=0)
    if count < 3:
        return n, d, count
    mean = s / count
    cov = np.zeros((3, 3))
    for lo in range(0, len(idx), CHUNK):
        if token is not None:
            token.check()
        c = xyz[idx[lo : lo + CHUNK]]
        c = c[_residual(c, n, d) <= dist] - mean
        for i in range(3):
            for j in range(i, 3):
                v = float((c[:, i] * c[:, j]).sum())
                cov[i, j] += v
                if i != j:
                    cov[j, i] += v
    _w, vec = np.linalg.eigh(cov)
    nn = vec[:, 0].copy()
    if nn[2] < 0 or (nn[2] == 0 and (nn[1] < 0 or (nn[1] == 0 and nn[0] < 0))):
        nn = -nn
    nn /= math.sqrt(float(nn @ nn))
    return nn, float(nn @ mean), count


def detect_planes(
    xyz: np.ndarray,
    eligible: np.ndarray,
    spec: PlaneDetectSpec,
    token: CancelToken | None = None,
    on_progress=None,
    centre_xy: tuple[float, float] | None = None,
) -> list[Plane]:
    """Up to `max_planes` near-horizontal planes among the eligible points, sorted by z at `centre_xy`.

    Read-only. `centre_xy` defaults to the XY centre of the eligible bounds."""
    validate_planes(spec)
    idx = np.flatnonzero(eligible)
    n_el = len(idx)
    if n_el < 3:
        return []
    k = min(n_el, RANSAC_SAMPLE)
    rng = np.random.default_rng(spec.seed)
    if n_el > k:
        sel = np.sort(rng.choice(n_el, k, replace=False))
        sample = xyz[idx[sel]]
    else:
        sample = xyz[idx]
    origin = sample.mean(axis=0)
    local = (
        sample - origin
    )  # conditioning only; planes are converted back below
    extent = float(np.ptp(local, axis=0).max())
    if not extent > 0:
        return []
    cos_tilt = math.cos(math.radians(spec.max_tilt_deg))
    alive = np.ones(k, dtype=bool)
    min_support = max(3, math.ceil(MIN_SUPPORT * k))
    if centre_xy is None:
        lo_b = xyz[idx[:: max(1, n_el // 100_000)]].min(axis=0)
        hi_b = xyz[idx[:: max(1, n_el // 100_000)]].max(axis=0)
        centre_xy = (float(lo_b[0] + hi_b[0]) / 2, float(lo_b[1] + hi_b[1]) / 2)
    found: list[Plane] = []
    for pi in range(spec.max_planes):
        if token is not None:
            token.check()
        if on_progress is not None:
            on_progress(pi / spec.max_planes)
        pts = local[alive]
        m = len(pts)
        if m < 3:
            break
        tri = rng.integers(0, m, size=(spec.iterations, 3))
        p0, p1, p2 = pts[tri[:, 0]], pts[tri[:, 1]], pts[tri[:, 2]]
        cr = np.cross(p1 - p0, p2 - p0)
        ln = np.sqrt((cr * cr).sum(axis=1))
        ok = ln > DEGENERATE_AREA * extent * extent
        ln[~ok] = 1.0
        nrm = cr / ln[:, None]
        nrm[nrm[:, 2] < 0] *= -1.0
        ok &= nrm[:, 2] >= cos_tilt
        if not ok.any():
            break
        nrm, p0 = nrm[ok], p0[ok]
        dd = nrm[:, 0] * p0[:, 0] + nrm[:, 1] * p0[:, 1] + nrm[:, 2] * p0[:, 2]
        counts = np.zeros(len(nrm), dtype=np.int64)
        hb = h_batch(m)
        px, py, pz = pts[:, 0], pts[:, 1], pts[:, 2]
        for lo in range(0, len(nrm), hb):
            if token is not None:
                token.check()
            h = slice(lo, lo + hb)
            r = nrm[h, 0:1] * px[None, :]
            r += nrm[h, 1:2] * py[None, :]
            r += nrm[h, 2:3] * pz[None, :]
            r -= dd[h, None]
            np.abs(r, out=r)
            counts[h] = (r <= spec.distance).sum(axis=1)
        best = int(np.argmax(counts))  # ties: lowest hypothesis index
        if counts[best] < min_support:
            break
        n0 = nrm[best]
        d0 = float(dd[best])
        # refit on the sample inliers (twice), then on the full-resolution eligible points, each time with a
        # window of 2 x distance so that a hypothesis tilted by sample noise still sees the whole surface
        win = 2.0 * spec.distance
        n1, d1 = n0, d0
        for _ in range(2):
            n1, d1, _c = _refit(
                local, np.flatnonzero(alive), n1, d1, win, token
            )
            n1, d1 = _upright(n1, d1)
        d_world = d1 + float(n1 @ origin)
        n2, d2, _c = _refit(xyz, idx, n1, d_world, win, token)
        n2, d2 = _upright(n2, d2)
        # a last pass at the inlier distance itself: points of a meeting wall that fall in the wide window pull
        # the offset of a small ceiling or floor towards the room, the narrow window keeps most of them out
        n2, d2, _c = _refit(xyz, idx, n2, d2, spec.distance, token)
        n2, d2 = _upright(n2, d2)
        if (
            n2[2] < cos_tilt
        ):  # a refit that drifted past the tilt limit is not a floor or ceiling
            alive &= ~(_residual(local, n0, d0) <= spec.distance)
            continue
        plane = _summarise(xyz, idx, n2, d2, spec.distance, centre_xy, token)
        if plane is not None:
            found.append(plane)
        alive &= ~(_residual(sample, n2, d2) <= spec.distance)
    if on_progress is not None:
        on_progress(1.0)
    found.sort(key=lambda p: (p.z_centre, p.normal, p.d))
    return found


def _upright(n: np.ndarray, d: float) -> tuple[np.ndarray, float]:
    if n[2] < 0:
        return -n, -d
    return n, d


def _summarise(xyz, idx, n, d, dist, centre_xy, token) -> Plane | None:
    count = 0
    ss = 0.0
    lo_b = np.full(3, np.inf)
    hi_b = np.full(3, -np.inf)
    for lo in range(0, len(idx), CHUNK):
        if token is not None:
            token.check()
        c = xyz[idx[lo : lo + CHUNK]]
        r = _residual(c, n, d)
        m = r <= dist + GEO_EPS_ROTATED
        if m.any():
            count += int(m.sum())
            ss += float((r[m] * r[m]).sum())
            sub = c[m]
            lo_b = np.minimum(lo_b, sub.min(axis=0))
            hi_b = np.maximum(hi_b, sub.max(axis=0))
    if count < 3:
        return None
    zc = (d - n[0] * centre_xy[0] - n[1] * centre_xy[1]) / n[2]
    tilt = math.degrees(math.acos(max(-1.0, min(1.0, float(n[2])))))
    return Plane(
        normal=(float(n[0]), float(n[1]), float(n[2])),
        d=float(d),
        count=count,
        rms=math.sqrt(ss / count),
        tilt_deg=tilt,
        z_centre=float(zc),
        bounds_min=(float(lo_b[0]), float(lo_b[1]), float(lo_b[2])),
        bounds_max=(float(hi_b[0]), float(hi_b[1]), float(hi_b[2])),
    )
