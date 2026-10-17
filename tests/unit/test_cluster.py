"""CLU-01..12: connected-component growth."""

import numpy as np
import pytest

from gr_pcd.editing.cancel import Cancelled, CancelToken
from gr_pcd.editing.cluster import (
    ComponentLimitReached,
    build_eligible,
    connected_component,
)
from gr_pcd.editing.errors import EditError
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
