"""THN-01..12: the thin tool (part 20): voxel keys, exact and near duplicates, voxel subsample.

Oracles are brute force over the definition (no code shared with the module under test). RED for THN-02..12 was
seen as a missing module (`gr_pcd.editing.thin`); THN-01 as the missing `voxel_keys`."""

import math

import numpy as np
import pytest

from gr_pcd.editing.cancel import Cancelled, CancelToken
from gr_pcd.editing.errors import EditError
from gr_pcd.editing.sparse import neighbourhood_counts
from gr_pcd.editing.thin import (
    ThinSpec,
    duplicate_mask,
    validate_thin,
    voxel_mask,
)
from gr_pcd.geometry.voxel import voxel_keys
from gr_pcd.pcd.errors import PcdError

EPS = 2.0**-10


def old_keys(rel, radius):
    """The key formula of sparse.neighbourhood_counts at e2aaccd, kept here as the oracle."""
    ijk = np.floor(rel / radius).astype(np.int64) + 1
    dims = ijk.max(axis=0) + 2
    return (ijk[:, 0] * dims[1] + ijk[:, 1]) * dims[2] + ijk[:, 2], dims


def test_thn_01_voxel_keys_equal_the_old_sparse_keys():
    rng = np.random.default_rng(1)
    pts = rng.uniform(0, 20, (5000, 3))
    rel = pts - pts.min(axis=0)
    key, dims = voxel_keys(rel, 0.7, "too small")
    okey, odims = old_keys(rel, 0.7)
    assert np.array_equal(key, okey) and np.array_equal(dims, odims)
    # sparse still counts through it, with its own refusal text
    assert len(neighbourhood_counts(pts, 0.7)) == 5000
    with pytest.raises(EditError, match="sparse radius is too small") as ei:
        neighbourhood_counts(np.array([[0.0, 0, 0], [1e12, 1e12, 1e12]]), 1e-3)
    assert ei.value.code == "invalid_tool"
    with pytest.raises(EditError, match="custom text"):
        voxel_keys(
            np.array([[0.0, 0, 0], [1e12, 1e12, 1e12]]), 1e-3, "custom text"
        )


def test_thn_02_exact_duplicates_keep_the_lowest_index():
    xyz = np.array(
        [[1, 2, 3], [4, 5, 6], [1, 2, 3], [7, 8, 9], [1, 2, 3], [4, 5, 6]],
        dtype=np.float64,
    )
    el = np.ones(6, dtype=bool)
    m = duplicate_mask(xyz, el, 0.0)
    assert list(np.flatnonzero(m)) == [2, 4, 5]  # a triple selects 2


def test_thn_03_signed_zero_equal_and_invalid_points_never_selected():
    xyz = np.array(
        [
            [0.0, 0, 0],
            [-0.0, -0.0, -0.0],
            [np.nan, 0, 0],
            [np.nan, 0, 0],
            [np.inf, 0, 0],
        ]
    )
    el = np.ones(5, dtype=bool)
    assert list(np.flatnonzero(duplicate_mask(xyz, el, 0.0))) == [1]
    assert list(np.flatnonzero(duplicate_mask(xyz, el, 1.0))) == [1]
    assert not voxel_mask(xyz[2:], np.ones(3, dtype=bool), 1.0).any()


def brute_near(xyz, el, eps):
    out = np.zeros(len(xyz), dtype=bool)
    idx = np.flatnonzero(el)
    for k, i in enumerate(idx):
        if k == 0:
            continue
        d = xyz[idx[:k]] - xyz[i]
        if ((d * d).sum(axis=1) <= eps * eps).any():
            out[i] = True
    return out


def test_thn_04_near_duplicates_equal_the_brute_force_oracle_at_the_boundary():
    rng = np.random.default_rng(4)
    # a dyadic grid of 2^-11: neighbours sit at exactly eps (2 steps) and above it
    xyz = rng.integers(0, 40, (2000, 3)).astype(np.float64) * 2.0**-11
    el = rng.random(2000) < 0.9
    assert np.array_equal(
        duplicate_mask(xyz, el, EPS), brute_near(xyz, el, EPS)
    )
    # a gap of exactly eps is inside, eps + 2^-20 is outside
    pair = np.array([[0.0, 0, 0], [EPS, 0, 0]])
    assert list(
        np.flatnonzero(duplicate_mask(pair, np.ones(2, bool), EPS))
    ) == [1]
    pair = np.array([[0.0, 0, 0], [EPS + 2.0**-20, 0, 0]])
    assert not duplicate_mask(pair, np.ones(2, bool), EPS).any()


def test_thn_05_a_chain_collapses_to_its_first_point():
    xyz = np.array([[0.0, 0, 0], [EPS, 0, 0], [2 * EPS, 0, 0]])
    m = duplicate_mask(xyz, np.ones(3, bool), EPS)
    assert list(np.flatnonzero(m)) == [1, 2]


def test_thn_06_voxel_equals_a_first_index_dict_oracle_and_faces_go_up():
    rng = np.random.default_rng(6)
    xyz = rng.integers(0, 64, (3000, 3)).astype(np.float64) * 0.25
    el = np.ones(3000, dtype=bool)
    edge = 1.0
    base = xyz.min(axis=0)
    first = {}
    want = np.zeros(3000, dtype=bool)
    for i, p in enumerate(xyz):
        k = tuple(np.floor((p - base) / edge).astype(int))
        if k in first:
            want[i] = True
        else:
            first[k] = i
    assert np.array_equal(voxel_mask(xyz, el, edge), want)
    # 0.0 and exactly edge are different voxels (floor), 0.0 and edge - 0.25 are one
    two = np.array([[0.0, 0, 0], [edge, 0, 0], [edge - 0.25, 0, 0]])
    assert list(np.flatnonzero(voxel_mask(two, np.ones(3, bool), edge))) == [2]


def test_thn_07_eligibility_only_shrinks_and_excluded_twins_do_not_count():
    xyz = np.array([[1.0, 1, 1], [1, 1, 1], [1, 1, 1], [2, 2, 2]])
    el = np.array([False, True, True, True])
    # the lower-index twin (0) is not eligible: point 1 is the first eligible copy
    assert list(np.flatnonzero(duplicate_mask(xyz, el, 0.0))) == [2]
    assert list(np.flatnonzero(duplicate_mask(xyz, el, 0.5))) == [2]
    assert list(np.flatnonzero(voxel_mask(xyz, el, 10.0))) == [2, 3]
    assert not duplicate_mask(xyz, np.zeros(4, bool), 0.0).any()


def test_thn_08_validate_thin():
    validate_thin(ThinSpec())
    validate_thin(ThinSpec(method="voxel", edge=0.05))
    for bad in (
        ThinSpec(method="grid"),
        ThinSpec(distance=-1.0),
        ThinSpec(distance=math.inf),
        ThinSpec(distance=math.nan),
        ThinSpec(method="voxel", edge=0.0),
        ThinSpec(method="voxel", edge=-1.0),
        ThinSpec(method="voxel", edge=math.nan),
        ThinSpec(method="voxel", edge=math.inf),
    ):
        with pytest.raises(EditError) as ei:
            validate_thin(bad)
        assert ei.value.code == "invalid_tool"


def test_thn_09_cancel_before_a_chunk_raises_and_returns_nothing():
    xyz = np.random.default_rng(9).uniform(0, 1, (500, 3))
    el = np.ones(500, bool)
    for fn in (
        lambda t: duplicate_mask(xyz, el, 0.0, t),
        lambda t: duplicate_mask(xyz, el, 0.01, t),
        lambda t: voxel_mask(xyz, el, 0.1, t),
    ):
        t = CancelToken()
        t.cancel()
        with pytest.raises(Cancelled):
            fn(t)


def test_thn_10_pair_estimate_above_the_budget_is_refused_before_pairs_exist():
    xyz = np.zeros((2000, 3))  # every point within eps of every other: 4M pairs
    el = np.ones(2000, bool)
    with pytest.raises(PcdError) as ei:
        duplicate_mask(xyz, el, 0.5, budget=1_000_000)
    assert ei.value.code == "memory_budget_exceeded"
    assert duplicate_mask(xyz, el, 0.5, budget=1 << 40).sum() == 1999


def test_thn_11_deterministic_and_rng_free(monkeypatch):
    rng = np.random.default_rng(11)
    xyz = rng.integers(0, 30, (1500, 3)).astype(np.float64) * 0.01
    el = np.ones(1500, bool)
    a = (
        duplicate_mask(xyz, el, 0.0),
        duplicate_mask(xyz, el, 0.015),
        voxel_mask(xyz, el, 0.05),
    )

    def boom(*_a, **_k):
        raise AssertionError("random numbers used")

    monkeypatch.setattr(np.random, "default_rng", boom)
    monkeypatch.setattr(np.random, "random", boom)
    b = (
        duplicate_mask(xyz, el, 0.0),
        duplicate_mask(xyz, el, 0.015),
        voxel_mask(xyz, el, 0.05),
    )
    for x, y in zip(a, b, strict=True):
        assert np.array_equal(x, y)


def test_thn_12_empty_and_single_point_select_nothing():
    for n in (0, 1):
        xyz = np.zeros((n, 3))
        el = np.ones(n, bool)
        assert duplicate_mask(xyz, el, 0.0).shape == (n,)
        assert not duplicate_mask(xyz, el, 0.0).any()
        assert not duplicate_mask(xyz, el, 0.1).any()
        assert not voxel_mask(xyz, el, 0.1).any()
