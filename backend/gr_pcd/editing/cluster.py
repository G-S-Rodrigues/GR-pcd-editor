"""Connected-component growth over eligible points (cell-level BFS).

Points are binned in cubes of side `s = r_eff / sqrt(3)`, so every point of a
cell is within `r_eff` of every other point of it: one verified point pair
between a visited cell and an unvisited one proves the whole unvisited cell
joins. The component equals the radius-graph component. Memory per round is
bounded by the chunk caps below, not by point density.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from gr_pcd.editing.cancel import CancelToken
from gr_pcd.editing.errors import EditError
from gr_pcd.geometry.tolerance import CLUSTER_REL
from gr_pcd.session.budget import CLUSTER_BYTES_PER_POINT, check_budget

# Seconds between on_progress calls (a long chain has thousands of rounds).
PROGRESS_INTERVAL_S = 0.2
CELL_CHUNK = 20_000  # frontier cells handled per step
PAIR_EVAL_CAP = 2_000_000  # point-pair distance evaluations per numpy step
SAMPLE_K = 24  # points per cell tried first (any hit proves the pair)
MAX_CELLS_PER_AXIS = 1 << 20
_AXIS_SHIFT = 21
_SQRT3 = float(np.sqrt(3.0))


class ComponentLimitReached(Exception):
    """The component grew past `max_points`; nothing is stored or applied."""

    def __init__(self, partial_count: int) -> None:
        super().__init__(f"component limit reached at {partial_count} points")
        self.partial_count = partial_count


@dataclass(frozen=True)
class ClusterResult:
    ids: np.ndarray  # sorted uint32 original indices
    bounds: tuple[tuple[float, ...], tuple[float, ...]]
    # complete False: growth stopped at `limit` (on_limit="partial")
    complete: bool = True
    limit: int | None = None


def build_eligible(
    scope: np.ndarray,
    region: np.ndarray | None,
    protected: np.ndarray | None,
    exclude_protected: bool,
) -> np.ndarray:
    eligible = scope.copy()
    if region is not None:
        eligible &= region
    if exclude_protected and protected is not None:
        eligible &= ~protected
    return eligible


def _offsets(s: float, r: float) -> np.ndarray:
    """Neighbour cell offsets whose boxes can hold a pair within r, nearest first."""
    rng = np.arange(-3, 4)
    d = np.array(np.meshgrid(rng, rng, rng, indexing="ij")).reshape(3, -1).T
    gap = np.maximum(np.abs(d) - 1, 0) * s
    dist2 = (gap**2).sum(axis=1)
    keep = (dist2 <= (r * (1.0 + 1e-6)) ** 2) & (np.abs(d).sum(axis=1) > 0)
    d, dist2 = d[keep], dist2[keep]
    return d[np.argsort(dist2, kind="stable")]


class _Cells:
    def __init__(self, pts: np.ndarray, s: float, r2: float, tick) -> None:
        self.pts = pts
        self.r2 = r2
        self.tick = tick
        pmin = pts.min(axis=0)
        cell = np.floor((pts - pmin) / s).astype(np.int64)
        if int(cell.max()) + 1 > MAX_CELLS_PER_AXIS:
            extent = float((pts.max(axis=0) - pmin).max())
            need = extent / (MAX_CELLS_PER_AXIS - 1) * _SQRT3
            raise EditError(
                "radius_too_small",
                "the radius is too small for the extent of this cloud; "
                f"use at least {need:.3g}",
            )
        key = (cell[:, 0] << (2 * _AXIS_SHIFT)) | (cell[:, 1] << _AXIS_SHIFT)
        key |= cell[:, 2]
        del cell
        self.keys, self.inverse = np.unique(key, return_inverse=True)
        del key
        self.order = np.argsort(self.inverse, kind="stable")
        counts = np.bincount(self.inverse, minlength=len(self.keys))
        self.counts = counts.astype(np.int64)
        self.starts = np.concatenate(([0], np.cumsum(self.counts)[:-1]))
        self.sorted_pts = pts[self.order]

    def _expand(self, a, b, na, nb, na_use, nb_use):
        """Hit flags for cell pairs (a[i], b[i]) over na_use x nb_use point
        samples; the sample index maps j -> j * n // n_use (identity when
        n_use == n). Evaluations are capped per numpy step."""
        hit = np.zeros(len(a), dtype=bool)
        work = na_use * nb_use
        lo = 0
        while lo < len(a):
            cum = np.cumsum(work[lo:])
            hi = lo + max(1, int(np.searchsorted(cum, PAIR_EVAL_CAP, "right")))
            sl = slice(lo, hi)
            w = work[sl]
            if int(w.sum()) > PAIR_EVAL_CAP:  # one oversized pair: blocks
                hit[lo] = self._dense(
                    a[lo], b[lo], na[lo], nb[lo], na_use[lo], nb_use[lo]
                )
                lo += 1
                continue
            pid = np.repeat(np.arange(hi - lo), w)
            local = np.arange(len(pid)) - np.repeat(np.cumsum(w) - w, w)
            nbu = nb_use[sl][pid]
            ia = (local // nbu) * na[sl][pid] // na_use[sl][pid]
            ib = (local % nbu) * nb[sl][pid] // nbu
            pa = self.sorted_pts[self.starts[a[sl]][pid] + ia]
            pb = self.sorted_pts[self.starts[b[sl]][pid] + ib]
            d = pa - pb
            ok = (d * d).sum(axis=1) <= self.r2
            hit[sl] = np.bincount(pid[ok], minlength=hi - lo) > 0
            self.tick()
            lo = hi
        return hit

    def _dense(self, a, b, na, nb, na_use, nb_use) -> bool:
        ia = (np.arange(na_use) * na // na_use) + self.starts[a]
        ib = (np.arange(nb_use) * nb // nb_use) + self.starts[b]
        pa, pb = self.sorted_pts[ia], self.sorted_pts[ib]
        rows = max(1, PAIR_EVAL_CAP // max(1, len(pb)))
        for i in range(0, len(pa), rows):
            blk = pa[i : i + rows]
            for j in range(0, len(pb), PAIR_EVAL_CAP):
                d = blk[:, None, :] - pb[None, j : j + PAIR_EVAL_CAP, :]
                if ((d * d).sum(axis=2) <= self.r2).any():
                    return True
            self.tick()
        return False

    def joined(self, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        """For cell pairs (visited a, unvisited b): does any point pair link them?"""
        na, nb = self.counts[a], self.counts[b]
        sa, sb = np.minimum(na, SAMPLE_K), np.minimum(nb, SAMPLE_K)
        hit = self._expand(a, b, na, nb, sa, sb)
        rest = np.flatnonzero(~hit & ((sa < na) | (sb < nb)))
        if len(rest):
            hit[rest] = self._expand(
                a[rest], b[rest], na[rest], nb[rest], na[rest], nb[rest]
            )
        return hit


def connected_component(
    xyz: np.ndarray,
    eligible: np.ndarray,
    seed_id: int,
    radius: float,
    token: CancelToken | None = None,
    on_round: Callable[[int], None] | None = None,
    max_points: int | None = None,
    budget: int | None = None,
    on_limit: str = "fail",
    on_progress: Callable[[int, int], None] | None = None,
) -> ClusterResult:
    if not (0 <= seed_id < len(xyz)) or not eligible[seed_id]:
        raise EditError(
            "invalid_seed",
            "seed must be an active, valid, in-scope, unexcluded point",
        )
    idx = np.flatnonzero(eligible)
    if budget is not None:
        check_budget(
            CLUSTER_BYTES_PER_POINT * len(idx), budget, "cluster search"
        )
    if token is not None:
        token.check()
    pts = xyz[idx]
    total = len(idx)
    r = radius * (1.0 + CLUSTER_REL)
    s = r * (1.0 - 1e-9) / _SQRT3
    visited_points = 1
    last_report = float("-inf")

    def tick() -> None:
        nonlocal last_report
        if token is not None:
            token.check()
        if on_progress is not None:
            now = time.monotonic()
            if now - last_report >= PROGRESS_INTERVAL_S:
                last_report = now
                on_progress(visited_points, total)

    cells = _Cells(pts, s, r * r, tick)
    tick()
    local_seed = int(np.searchsorted(idx, seed_id))
    seed_cell = int(cells.inverse[local_seed])
    visited = np.zeros(len(cells.keys), dtype=bool)
    visited[seed_cell] = True
    visited_points = int(cells.counts[seed_cell])
    frontier = np.array([seed_cell], dtype=np.int64)
    offs = _offsets(s, r)
    shifts = (
        (offs[:, 0] << (2 * _AXIS_SHIFT))
        + (offs[:, 1] << _AXIS_SHIFT)
        + offs[:, 2]
    )
    rnd = 0
    complete = True
    m = len(cells.keys)
    while len(frontier):
        if on_round is not None:
            on_round(rnd)
        if token is not None:
            token.check()
        rnd += 1
        fresh_parts: list[np.ndarray] = []
        for lo in range(0, len(frontier), CELL_CHUNK):
            chunk = frontier[lo : lo + CELL_CHUNK]
            ckeys = cells.keys[chunk]
            for sh in shifts:
                tick()
                nk = ckeys + sh
                pos = np.searchsorted(cells.keys, nk)
                pos[pos >= m] = m - 1
                ok = (cells.keys[pos] == nk) & ~visited[pos]
                if not ok.any():
                    continue
                a, b = chunk[ok], pos[ok]
                j = cells.joined(a, b)
                new = b[j]
                if len(new):
                    visited[new] = True
                    visited_points += int(cells.counts[new].sum())
                    fresh_parts.append(new)
        fresh = (
            np.concatenate(fresh_parts)
            if fresh_parts
            else np.empty(0, dtype=np.int64)
        )
        if max_points is not None and visited_points > max_points:
            if on_limit != "partial":
                raise ComponentLimitReached(visited_points)
            complete = False
            break
        frontier = fresh
        tick()
    if token is not None:
        token.check()
    members = np.flatnonzero(visited[cells.inverse])
    out_ids = idx[members].astype(np.uint32)
    sel = pts[members]
    bounds = (tuple(sel.min(axis=0).tolist()), tuple(sel.max(axis=0).tolist()))
    return ClusterResult(
        ids=out_ids,
        bounds=bounds,
        complete=complete,
        limit=None if complete else max_points,
    )
