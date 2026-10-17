"""Connected-component growth over eligible points (cKDTree BFS)."""

import time
from collections.abc import Callable
from dataclasses import dataclass
from itertools import chain

import numpy as np
from scipy.spatial import cKDTree

from gr_pcd.editing.cancel import CancelToken
from gr_pcd.editing.errors import EditError
from gr_pcd.geometry.tolerance import CLUSTER_REL
from gr_pcd.session.budget import CLUSTER_BYTES_PER_POINT, check_budget

# Seconds between on_progress calls (a long chain has thousands of rounds).
PROGRESS_INTERVAL_S = 0.2


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
    tree = cKDTree(pts)
    local_seed = int(np.searchsorted(idx, seed_id))
    visited = np.zeros(len(idx), dtype=bool)
    visited[local_seed] = True
    count = 1
    frontier = np.array([local_seed], dtype=np.int64)
    r = radius * (1.0 + CLUSTER_REL)
    rnd = 0
    complete = True
    last_report = float("-inf")
    while len(frontier):
        if on_round is not None:
            on_round(rnd)
        if token is not None:
            token.check()
        rnd += 1
        found = tree.query_ball_point(
            pts[frontier], r, workers=-1, return_sorted=False
        )
        flat = np.fromiter(
            chain.from_iterable(found),
            dtype=np.int64,
            count=int(sum(map(len, found))),
        )
        # drop what is already visited before the (small) unique
        fresh = np.unique(flat[~visited[flat]])
        visited[fresh] = True
        count += len(fresh)
        if max_points is not None and count > max_points:
            if on_limit != "partial":
                raise ComponentLimitReached(count)
            complete = False
            break
        frontier = fresh
        if on_progress is not None:
            now = time.monotonic()
            if now - last_report >= PROGRESS_INTERVAL_S:
                last_report = now
                on_progress(count, len(idx))
    if token is not None:
        token.check()
    members = np.flatnonzero(visited)
    out_ids = idx[members].astype(np.uint32)
    sel = pts[members]
    bounds = (tuple(sel.min(axis=0).tolist()), tuple(sel.max(axis=0).tolist()))
    return ClusterResult(
        ids=out_ids,
        bounds=bounds,
        complete=complete,
        limit=None if complete else max_points,
    )
