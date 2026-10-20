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
    assert t_whole <= 3.0, f"whole room {t_whole:.1f}s"
    ghosts = lab == ROOM_GHOST
    t0 = time.perf_counter()
    ghost = connected_component(xyz, ghosts, seed_id, 0.5)
    t_ghost = time.perf_counter() - t0
    assert 40_000 <= len(ghost.ids) <= 46_000
    assert t_ghost <= 1.5, f"ghost component {t_ghost:.1f}s"


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


# ---- 7c-1: cell-BFS engine (CLU-30..36) --------------------------------
def _fuzz_case(seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(5_000, 20_001))
    xyz, _ = room_rows(n, seed)
    eligible = rng.random(len(xyz)) >= 0.15
    seed_id = int(rng.choice(np.flatnonzero(eligible)))
    radius = float(rng.uniform(0.2, 2.0))
    return xyz, eligible, seed_id, radius


@pytest.mark.parametrize("seed", range(20))
def test_clu_30_fuzz_same_ids_as_the_oracle(seed):
    xyz, eligible, seed_id, radius = _fuzz_case(seed)
    res = connected_component(xyz, eligible, seed_id, radius)
    assert np.array_equal(res.ids, old_bfs(xyz, eligible, seed_id, radius))


@pytest.mark.parametrize("seed", range(5))
def test_clu_30b_dyadic_gaps_same_ids_as_the_oracle(seed):
    # coordinates on a 1/8 grid: gaps are exactly 0 or >= 0.125
    rng = np.random.default_rng(100 + seed)
    xyz = rng.integers(0, 160, size=(6_000, 3)).astype(np.float64) / 8.0
    xyz[:, 2] = np.round(xyz[:, 2] / 4) * 1.0  # a few thin layers
    eligible = np.ones(len(xyz), dtype=bool)
    for radius in (0.5, 1.0, 1.5):
        got = connected_component(xyz, eligible, 0, radius)
        assert np.array_equal(got.ids, old_bfs(xyz, eligible, 0, radius))


def test_clu_31_radius_boundary_inclusive_on_a_cell_edge():
    r = 0.5
    # points exactly r apart along each axis and along a diagonal 3-4-5
    pts = np.array(
        [
            [0.0, 0.0, 0.0],
            [0.5, 0.0, 0.0],
            [0.5, 0.5, 0.0],
            [0.5, 0.5, 0.5],
            [0.8, 0.5, 0.5],
            [0.8, 0.9, 0.5],  # 3-4-5 from the previous point at r=0.5
        ]
    )
    res = connected_component(pts, np.ones(6, bool), 0, r)
    assert ids(res) == {0, 1, 2, 3, 4, 5}
    res = connected_component(pts, np.ones(6, bool), 0, 0.49)
    assert ids(res) == {0}


def test_clu_32_two_points_at_exactly_the_cell_diagonal_in_one_cell():
    r = 1.0
    s = r * (1 + CLUSTER_REL) / np.sqrt(3.0)
    pts = np.array(
        [[0.0, 0.0, 0.0], [s, s, s], [3 * s, 0.0, 0.0], [3 * s + 0.9, 0, 0]]
    )
    res = connected_component(pts, np.ones(4, bool), 0, r)
    assert ids(res) == {0, 1}
    res = connected_component(pts, np.ones(4, bool), 2, r)
    assert ids(res) == {2, 3}


def _tree_prefix_oracle(xyz, eligible, seed_id, radius, limit):
    """Independent oracle (cKDTree hop BFS): the first `limit` points by
    (hop, distance to the seed squared, index)."""
    idx = np.flatnonzero(eligible)
    pts = xyz[idx]
    r_eff = radius * (1.0 + CLUSTER_REL)
    tree = cKDTree(pts)
    local = int(np.searchsorted(idx, seed_id))
    hop = np.full(len(idx), -1, dtype=np.int64)
    hop[local] = 0
    frontier = [local]
    level = 0
    while frontier:
        level += 1
        nxt = []
        for p in frontier:
            for q in tree.query_ball_point(pts[p], r_eff * (1 + 1e-12)):
                d = pts[p] - pts[q]
                if hop[q] < 0 and (d * d).sum() <= r_eff * r_eff:
                    hop[q] = level
                    nxt.append(q)
        frontier = nxt
    members = np.flatnonzero(hop >= 0)
    d = pts[members] - pts[local]
    d2 = (d * d).sum(axis=1)
    order = np.lexsort((idx[members], d2, hop[members]))
    return np.sort(idx[members][order[:limit]])


def test_clu_33_partial_is_exactly_the_nearest_limit_points():
    xyz, _ = room_rows(30_000, 3)
    eligible = np.ones(len(xyz), dtype=bool)
    full = connected_component(xyz, eligible, 0, 0.5)
    limit = len(full.ids) // 3
    res = connected_component(
        xyz, eligible, 0, 0.5, max_points=limit, on_limit="partial"
    )
    assert res.complete is False and res.limit == limit
    assert len(res.ids) == limit
    assert set(res.ids.tolist()) <= set(full.ids.tolist())
    assert 0 in set(res.ids.tolist())
    assert np.array_equal(
        res.ids, _tree_prefix_oracle(xyz, eligible, 0, 0.5, limit)
    )


def _brute_prefix(xyz, eligible, seed_id, radius, limit):
    """Oracle (A4): brute-force pairwise d2 <= r_eff2 adjacency, level BFS,
    lexsort by (hop, d2 to the seed, index). Small clouds only."""
    idx = np.flatnonzero(eligible)
    pts = xyz[idx]
    r_eff = radius * (1.0 + CLUSTER_REL)
    diff = pts[:, None, :] - pts[None, :, :]
    adj = (diff * diff).sum(axis=2) <= r_eff * r_eff
    local = int(np.searchsorted(idx, seed_id))
    hop = np.full(len(idx), -1, dtype=np.int64)
    hop[local] = 0
    frontier = np.array([local])
    level = 0
    while len(frontier):
        level += 1
        reach = adj[frontier].any(axis=0) & (hop < 0)
        hop[reach] = level
        frontier = np.flatnonzero(reach)
    members = np.flatnonzero(hop >= 0)
    d = pts[members] - pts[local]
    d2 = (d * d).sum(axis=1)
    order = np.lexsort((idx[members], d2, hop[members]))
    return np.sort(idx[members][order[:limit]]), len(members)


def _lattice():
    g = np.arange(12) * 0.25
    x, y = np.meshgrid(g, g, indexing="ij")
    return np.column_stack([x.ravel(), y.ravel(), np.zeros(144)]), 0.25


def _clu44_cases():
    out = []
    for fuzz in (1, 2, 3):
        xyz, _ = room_rows(2_500, fuzz)
        out.append((f"room{fuzz}", xyz, 1.2))
        rng = np.random.default_rng(50 + fuzz)
        out.append((f"cloud{fuzz}", rng.uniform(0, 4, (1_500, 3)), 0.45))
    lat, r = _lattice()
    out.append(("lattice", lat, r))
    return out


@pytest.mark.parametrize(
    "name,xyz,radius", _clu44_cases(), ids=[c[0] for c in _clu44_cases()]
)
def test_clu_44_exact_cap_equals_the_nearest_prefix_oracle(name, xyz, radius):
    eligible = np.ones(len(xyz), dtype=bool)
    _, size = _brute_prefix(xyz, eligible, 0, radius, 1)
    assert size > 20, name
    for limit in (1, 7, size // 3, size - 1):
        want, _ = _brute_prefix(xyz, eligible, 0, radius, limit)
        got = connected_component(
            xyz, eligible, 0, radius, max_points=limit, on_limit="partial"
        )
        assert len(got.ids) == limit, (name, limit)
        assert np.array_equal(got.ids, want), (name, limit)


def _reaches_all(xyz, ids_, seed_id, radius):
    r_eff = radius * (1.0 + CLUSTER_REL)
    pts = xyz[ids_]
    diff = pts[:, None, :] - pts[None, :, :]
    adj = (diff * diff).sum(axis=2) <= r_eff * r_eff
    seen = np.zeros(len(ids_), dtype=bool)
    start = int(np.searchsorted(ids_, seed_id))
    seen[start] = True
    frontier = np.array([start])
    while len(frontier):
        reach = adj[frontier].any(axis=0) & ~seen
        seen |= reach
        frontier = np.flatnonzero(reach)
    return bool(seen.all())


def test_clu_45_the_result_is_connected_through_the_seed_even_on_a_u_shape():
    arm = [(0.0, 0.5 * i, 0.0) for i in range(21)]  # left arm, y 0..10
    right = [(1.0, 0.5 * i, 0.0) for i in range(21)]
    bottom = [(0.5, 0.0, 0.0)]
    xyz = np.array(arm + right + bottom)
    eligible = np.ones(len(xyz), dtype=bool)
    seed_id = (
        20  # top of the left arm, 1.0 across the gap from the right arm top
    )
    for limit in (5, 15, 30):
        res = connected_component(
            xyz, eligible, seed_id, 0.5, max_points=limit, on_limit="partial"
        )
        assert len(res.ids) == limit
        assert _reaches_all(xyz, res.ids, seed_id, 0.5), limit
    res = connected_component(
        xyz, eligible, seed_id, 0.5, max_points=15, on_limit="partial"
    )
    assert set(res.ids.tolist()) == set(range(6, 21))  # down the left arm
    for seed in (1, 2):
        rx, _ = room_rows(2_500, seed)
        e = np.ones(len(rx), dtype=bool)
        res = connected_component(
            rx, e, 0, 1.2, max_points=300, on_limit="partial"
        )
        assert _reaches_all(rx, res.ids, 0, 1.2)


def test_clu_46_limit_equal_to_the_size_is_complete_and_the_order_is_stable():
    xyz, _ = room_rows(3_000, 5)
    e = np.ones(len(xyz), dtype=bool)
    full = connected_component(xyz, e, 0, 1.2)
    size = len(full.ids)
    same = connected_component(
        xyz, e, 0, 1.2, max_points=size, on_limit="partial"
    )
    assert same.complete is True and np.array_equal(same.ids, full.ids)
    less = connected_component(
        xyz, e, 0, 1.2, max_points=size - 1, on_limit="partial"
    )
    assert less.complete is False and len(less.ids) == size - 1
    one = connected_component(xyz, e, 0, 1.2, max_points=1, on_limit="partial")
    assert one.ids.tolist() == [0] and one.complete is False
    again = connected_component(
        xyz, e, 0, 1.2, max_points=size - 1, on_limit="partial"
    )
    assert np.array_equal(less.ids, again.ids)


@pytest.mark.parametrize("bad", [0, -3])
def test_clu_48_max_points_below_one_is_refused(bad):
    with pytest.raises(EditError) as err:
        connected_component(
            XYZ, np.ones(N, bool), 0, 0.5, max_points=bad, on_limit="partial"
        )
    assert err.value.code == "invalid_max_points"


def test_clu_34_cancel_inside_a_round_and_from_progress():
    xyz, _ = room_rows(60_000, 3)
    eligible = np.ones(len(xyz), dtype=bool)
    token = CancelToken()

    def progress(visited, total):
        token.cancel()

    with pytest.raises(Cancelled):
        connected_component(
            xyz, eligible, 0, 1.5, token=token, on_progress=progress
        )


def test_clu_35_protected_exclusion_at_radius_two():
    xyz, lab = room_rows(30_000, 4)
    ghost = int(np.flatnonzero(lab == ROOM_GHOST)[0])
    protected = np.abs(xyz[:, 2]) < 0.1  # the floor slab
    eligible = build_eligible(np.ones(len(xyz), bool), None, protected, True)
    res = connected_component(xyz, eligible, ghost, 2.0)
    assert not protected[res.ids].any()
    assert np.array_equal(res.ids, old_bfs(xyz, eligible, ghost, 2.0))


def test_clu_36_radius_too_small_for_the_extent_raises_cleanly():
    pts = np.array([[0.0, 0.0, 0.0], [1000.0, 0.0, 0.0]])
    with pytest.raises(EditError) as err:
        connected_component(pts, np.ones(2, bool), 0, 1e-5)
    assert err.value.code == "radius_too_small"
    assert "at least" in err.value.message
