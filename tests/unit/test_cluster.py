"""CLU-01..12: connected-component growth."""

import time

import numpy as np
import pytest
from scipy.spatial import cKDTree

from fixtures.pcdgen import ROOM_GHOST, room_rows
from gr_pcd.editing.cancel import Cancelled, CancelToken
from gr_pcd.editing.cluster import (
    ComponentLimitReached,
    build_eligible,
    connected_component,
)
from gr_pcd.editing.errors import EditError
from gr_pcd.geometry.tolerance import CLUSTER_REL
from gr_pcd.pcd.errors import PcdError

# chain: ids 0..9 at x=0,0.5,..4.5 ; ghost blob ids 10..14 at x=10..12,
# spacing 0.5; floor row ids 15..: z=-0.05 bridging near both.
CHAIN = [(0.5 * i, 0.0, 0.0) for i in range(10)]
GHOST = [(10.0 + 0.5 * i, 0.0, 0.0) for i in range(5)]
FLOOR = [(4.5 + 0.5 * i, 0.0, -0.0625) for i in range(12)]  # to x=10
XYZ = np.array(CHAIN + GHOST + FLOOR, dtype=np.float64)
N = len(XYZ)


def all_mask():
    return np.ones(N, dtype=bool)


def ids(res):
    return set(res.ids.tolist())


def test_clu_01_ghost_component_and_radius():
    res = connected_component(XYZ[:15], np.ones(15, bool), 10, 0.5)
    assert ids(res) == {10, 11, 12, 13, 14}
    res = connected_component(XYZ[:15], np.ones(15, bool), 10, 0.49)
    assert ids(res) == {10}


def test_clu_02_radius_boundary_inclusive():
    res = connected_component(XYZ[:2], np.ones(2, bool), 0, 0.5)
    assert ids(res) == {0, 1}


def test_clu_03_chain_transitive():
    res = connected_component(XYZ[:10], np.ones(10, bool), 0, 0.5)
    assert ids(res) == set(range(10))


def test_clu_04_floor_bridge():
    protected = np.zeros(N, dtype=bool)
    protected[15:] = True
    split = build_eligible(all_mask(), None, protected, True)
    res = connected_component(XYZ, split, 10, 0.6)
    assert ids(res) == {10, 11, 12, 13, 14}
    merged = build_eligible(all_mask(), None, protected, False)
    res = connected_component(XYZ, merged, 10, 0.6)
    assert {0, 9, 10, 14} <= ids(res)


@pytest.mark.parametrize("seed", [-1, 999, 3, 4, 5, 6])
def test_clu_05_invalid_seed(seed):
    eligible = np.ones(N, dtype=bool)
    eligible[3] = False  # protected/inactive/out of scope
    eligible[4] = False
    eligible[5] = False
    eligible[6] = False
    with pytest.raises(EditError) as err:
        connected_component(XYZ, eligible, seed, 0.5)
    assert err.value.code == "invalid_seed"


def test_clu_06_scope_region_and_deleted():
    scope = all_mask()
    scope[12] = False  # filtered out / deleted never traverses
    scope[15:] = False  # the floor is outside the scope too
    region = np.ones(N, dtype=bool)
    region[14] = False
    eligible = build_eligible(scope, region, None, True)
    res = connected_component(XYZ, eligible, 10, 0.5)
    assert ids(res) == {10, 11}


def test_clu_07_independent_of_any_sample():
    # the function takes no render sample: same call, same answer
    a = connected_component(XYZ, np.ones(N, bool), 10, 0.5)
    b = connected_component(XYZ, np.ones(N, bool), 10, 0.5)
    assert ids(a) == ids(b)


def test_clu_08_cancel_mid_expansion():
    n = 200
    xyz = np.array([(0.5 * i, 0, 0) for i in range(n)], dtype=np.float64)
    token = CancelToken()
    rounds = []

    def on_round(r):
        rounds.append(r)
        if r == 2:
            token.cancel()

    with pytest.raises(Cancelled):
        connected_component(
            xyz, np.ones(n, bool), 0, 0.5, token=token, on_round=on_round
        )
    assert rounds[:3] == [0, 1, 2]
    assert max(rounds) <= 3


def test_clu_09_max_points_limit():
    with pytest.raises(ComponentLimitReached) as err:
        connected_component(XYZ[:10], np.ones(10, bool), 0, 0.5, max_points=4)
    assert err.value.partial_count >= 4


def test_clu_10_memory_guard_before_tree():
    with pytest.raises(PcdError) as err:
        connected_component(XYZ, np.ones(N, bool), 0, 0.5, budget=100)
    assert err.value.code == "memory_budget_exceeded"


def test_clu_11_isolated_and_single_point():
    res = connected_component(XYZ[:15], np.ones(15, bool), 0, 0.1)
    assert ids(res) == {0}
    one = np.array([[1.0, 2.0, 3.0]])
    assert ids(connected_component(one, np.ones(1, bool), 0, 1.0)) == {0}


def test_clu_12_bounds():
    res = connected_component(XYZ[:15], np.ones(15, bool), 10, 0.5)
    assert res.bounds == ((10.0, 0.0, 0.0), (12.0, 0.0, 0.0))


def test_clu_20_partial_limit_returns_the_partial_component():
    line = np.array([(0.5 * i, 0.0, 0.0) for i in range(100)])
    everyone = np.ones(100, bool)
    res = connected_component(
        line, everyone, 0, 0.5, max_points=40, on_limit="partial"
    )
    assert res.complete is False and res.limit == 40
    assert 40 <= len(res.ids) < 100
    # grown from seed 0
    assert set(res.ids.tolist()) == set(range(len(res.ids)))
    full = connected_component(line, everyone, 0, 0.5, on_limit="partial")
    assert full.complete is True and len(full.ids) == 100
    with pytest.raises(ComponentLimitReached):  # the default is unchanged
        connected_component(line, everyone, 0, 0.5, max_points=40)


def old_bfs(xyz, eligible, seed_id, radius):
    """Oracle: the pre-7a-5 algorithm (per-round list flatten + np.unique)."""
    idx = np.flatnonzero(eligible)
    pts = xyz[idx]
    tree = cKDTree(pts)
    local_seed = int(np.searchsorted(idx, seed_id))
    visited = np.zeros(len(idx), dtype=bool)
    visited[local_seed] = True
    frontier = np.array([local_seed], dtype=np.int64)
    r = radius * (1.0 + CLUSTER_REL)
    while len(frontier):
        found = tree.query_ball_point(pts[frontier], r)
        merged = np.unique(
            np.concatenate([np.asarray(f, np.int64) for f in found])
        )
        fresh = merged[~visited[merged]]
        visited[fresh] = True
        frontier = fresh
    return idx[np.flatnonzero(visited)].astype(np.uint32)


@pytest.mark.parametrize("seed", [1, 2, 3])
@pytest.mark.parametrize("radius", [0.2, 0.35, 0.5])
def test_clu_21_same_ids_as_the_old_bfs(seed, radius):
    xyz, _ = room_rows(20_000, seed)
    rng = np.random.default_rng(seed)
    eligible = rng.random(len(xyz)) < 0.8
    seed_id = int(rng.choice(np.flatnonzero(eligible)))
    res = connected_component(xyz, eligible, seed_id, radius)
    want = old_bfs(xyz, eligible, seed_id, radius)
    assert np.array_equal(res.ids, want)


def test_clu_22_room_timing():
    xyz, lab = room_rows(300_000, 7)
    seed_id = int(np.flatnonzero(lab == ROOM_GHOST)[0])
    t0 = time.perf_counter()
    whole = connected_component(xyz, np.ones(len(xyz), bool), seed_id, 0.5)
    t_whole = time.perf_counter() - t0
    assert len(whole.ids) > 290_000
    assert t_whole <= 12.0, f"whole room {t_whole:.1f}s"
    ghosts = lab == ROOM_GHOST
    t0 = time.perf_counter()
    ghost = connected_component(xyz, ghosts, seed_id, 0.5)
    t_ghost = time.perf_counter() - t0
    assert 40_000 <= len(ghost.ids) <= 46_000
    assert t_ghost <= 3.0, f"ghost component {t_ghost:.1f}s"


def test_clu_23_progress_reports_visited_over_eligible_and_is_throttled():
    xyz, _ = room_rows(20_000, 5)
    calls = []
    connected_component(
        xyz,
        np.ones(len(xyz), bool),
        0,
        0.5,
        on_progress=lambda visited, eligible: calls.append((visited, eligible)),
    )
    assert calls and all(e == len(xyz) for _, e in calls)
    visited = [v for v, _ in calls]
    assert visited == sorted(visited) and visited[-1] <= len(xyz)
    # a chain of 3000 rounds must not produce 3000 progress calls
    chain = np.array([(0.5 * i, 0.0, 0.0) for i in range(3000)])
    n_calls = []
    connected_component(
        chain,
        np.ones(3000, bool),
        0,
        0.5,
        on_progress=lambda v, e: n_calls.append(v),
    )
    assert 1 <= len(n_calls) < 300
