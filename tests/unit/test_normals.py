"""NRM-01..05, 08: voxel PCA normals and the octahedral u32 packing (part 12-9).

Planes are generated here, independently of production code. Orientation rule under test: the sign is chosen so the
first of the z, y, x components whose magnitude exceeds 1e-3 is positive (floors and ceilings point up, a wall
along x points +x).
"""

import math

import numpy as np

from gr_pcd.geometry.normals import (
    estimate_normals,
    normals_u32,
    oct_pack,
    oct_unpack,
    voxel_edge,
)

RNG = np.random.default_rng(11)


def _angle(n, want):
    want = np.asarray(want, dtype=np.float64)
    c = np.clip(np.abs(n.astype(np.float64) @ want), -1, 1)
    return np.degrees(np.arccos(c))


def _floor(side=20, step=0.05, z=0.0):
    g = np.arange(0, side, step)
    x, y = np.meshgrid(g, g)
    return np.column_stack([x.ravel(), y.ravel(), np.full(x.size, z)])


def _wall_x(x=3.0, side=20, step=0.05):
    g = np.arange(0, side, step)
    y, z = np.meshgrid(g, g[: int(3 / step)])
    return np.column_stack([np.full(y.size, x), y.ravel(), z.ravel()])


def test_nrm_01_floor_plane_points_up():
    xyz = _floor()
    n = estimate_normals(xyz)
    assert n.shape == xyz.shape and n.dtype == np.float32
    assert (_angle(n, [0, 0, 1]) < 5).all()
    assert (n[:, 2] > 0).all()  # oriented up, not just parallel


def test_nrm_02_wall_plane_points_along_plus_x_by_the_orientation_rule():
    xyz = _wall_x()
    n = estimate_normals(xyz)
    assert (_angle(n, [1, 0, 0]) < 5).all()
    assert (n[:, 0] > 0).all()
    # a wall along y: |nz| and |nx| are ~0, so the first component above the threshold is y, positive
    wy = xyz[:, [1, 0, 2]]
    ny = estimate_normals(wy)
    assert (ny[:, 1] > 0).all()
    assert (_angle(ny, [0, 1, 0]) < 5).all()


def test_nrm_03_two_perpendicular_planes_away_from_the_seam():
    floor, wall = _floor(), _wall_x(x=10.0)
    xyz = np.vstack([floor, wall])
    n = estimate_normals(xyz)
    edge = voxel_edge(xyz)
    far_f = np.abs(floor[:, 0] - 10.0) > 1.5 * edge
    far_w = wall[:, 2] > 1.5 * edge
    ok_f = _angle(n[: len(floor)][far_f], [0, 0, 1]) < 5
    ok_w = _angle(n[len(floor) :][far_w], [1, 0, 0]) < 5
    assert np.concatenate([ok_f, ok_w]).mean() >= 0.95


def test_nrm_04_noise_is_finite_unit_and_sparse_voxels_fall_back_to_up():
    xyz = RNG.uniform(0, 50, (2000, 3))
    n = estimate_normals(
        xyz, edge=0.5
    )  # ~0 points per voxel: nearly every voxel has < 3
    assert np.isfinite(n).all()
    assert np.allclose(np.linalg.norm(n, axis=1), 1.0, atol=1e-5)
    sparse = estimate_normals(
        np.array([[0.0, 0, 0], [10, 10, 10], [20, 0, 5]]), edge=1.0
    )
    assert (sparse == np.array([0, 0, 1], dtype=np.float32)).all()
    # empty and single-point inputs do not raise
    assert estimate_normals(np.zeros((0, 3))).shape == (0, 3)
    assert estimate_normals(np.array([[1.0, 2, 3]])).tolist() == [
        [0.0, 0.0, 1.0]
    ]
    # duplicated points (zero covariance) stay finite
    dup = estimate_normals(np.tile([1.0, 1.0, 1.0], (50, 1)))
    assert np.isfinite(dup).all()


# the packed words of the axis vectors, worked out by hand from the octahedral map with 16-bit axes (u | v << 16):
# +z -> (0, 0) -> 0x8000 each; +x -> u = 1; +y -> v = 1; -z folds to the corner (1, 1)
TABLE = {
    (0, 0, 1): 0x80008000,
    (1, 0, 0): 0x8000FFFF,
    (-1, 0, 0): 0x80000000,
    (0, 1, 0): 0xFFFF8000,
    (0, -1, 0): 0x00008000,
    (0, 0, -1): 0xFFFFFFFF,
}


def _decode_independent(word):
    """Octahedral decode written separately from production code."""
    u = (word & 0xFFFF) / 65535 * 2 - 1
    v = (word >> 16) / 65535 * 2 - 1
    z = 1 - abs(u) - abs(v)
    x, y = u, v
    if z < 0:
        x = (1 - abs(v)) * (1 if u >= 0 else -1)
        y = (1 - abs(u)) * (1 if v >= 0 else -1)
    vec = np.array([x, y, z])
    return vec / np.linalg.norm(vec)


def test_nrm_05_octahedral_pack_matches_the_table_and_round_trips_within_1e3_rad():
    for vec, word in TABLE.items():
        assert int(oct_pack(np.array([vec], dtype=np.float64))[0]) == word, vec
        assert np.allclose(_decode_independent(word), vec, atol=1e-4), vec
    v = RNG.normal(size=(1000, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    packed = oct_pack(v)
    assert packed.dtype == np.uint32
    for i in range(len(v)):
        back = _decode_independent(int(packed[i]))
        assert math.acos(min(1.0, float(back @ v[i]))) < 1e-3
    got = oct_unpack(packed)
    assert (np.sum(got * v, axis=1) > math.cos(1e-3)).all()


def test_nrm_08_normals_of_shared_points_survive_a_different_sample():
    floor, wall = _floor(step=0.04), _wall_x(x=10.0, step=0.04)
    xyz = np.vstack([floor, wall])
    ids_a = np.arange(0, len(xyz), 3)
    ids_b = np.arange(0, len(xyz), 7)
    a = normals_u32(xyz[ids_a])
    b = normals_u32(xyz[ids_b])
    shared, ia, ib = np.intersect1d(ids_a, ids_b, return_indices=True)
    na, nb = oct_unpack(a[ia]), oct_unpack(b[ib])
    seam = np.abs(xyz[shared, 0] - 10.0) < 1.5 * max(
        voxel_edge(xyz[ids_a]), voxel_edge(xyz[ids_b])
    )
    keep = ~seam
    agree = np.sum(na[keep] * nb[keep], axis=1) > math.cos(math.radians(10))
    assert len(shared) > 1000
    assert agree.mean() >= 0.95
