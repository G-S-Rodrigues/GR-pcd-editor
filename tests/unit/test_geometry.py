"""GEO-01..22: box, prism and filter membership against loop-built sets."""

import numpy as np
import pytest

from gr_pcd.editing.cancel import Cancelled, CancelToken
from gr_pcd.geometry import tolerance
from gr_pcd.geometry.box import BoxSpec, box_contains, rotation_matrix
from gr_pcd.geometry.errors import GeometryError
from gr_pcd.geometry.filters import AxisRange, DisplayFilter, filter_contains
from gr_pcd.geometry.prism import PrismSpec, prism_contains

FLOOR = [(float(x), float(y), 0.0) for x in range(10) for y in range(10)]
GHOST = [
    (float(x), float(y), float(z))
    for z in (1, 2, 3)
    for x in (2, 3, 4)
    for y in (2, 3, 4)
]
SCENE = FLOOR + GHOST


def arr(points):
    xyz = np.array(points, dtype=np.float64).reshape(-1, 3)
    return xyz, np.ones(len(xyz), dtype=bool)


def ids(mask):
    return set(np.flatnonzero(mask).tolist())


def expect(points, pred):
    return {i for i, p in enumerate(points) if pred(*p)}


def test_geo_01_axis_aligned_box():
    xyz, valid = arr(SCENE)
    box = BoxSpec((3, 3, 2.5), (4, 4, 3))
    got = ids(box_contains(xyz, valid, box))
    want = expect(
        SCENE, lambda x, y, z: 1 <= x <= 5 and 1 <= y <= 5 and 1 <= z <= 4
    )
    assert got == want
    assert got == set(range(100, 127))
    assert not got & set(range(100))


def test_geo_02_box_boundaries_inclusive():
    corners = [
        (sx, sy, sz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)
    ]
    faces = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1)]
    faces += [(0, 0, -1)]
    pts = [(float(a), float(b), float(c)) for a, b, c in corners + faces]
    e = 2.0**-20
    outside = [(1 + e, 0.0, 0.0), (0.0, -1 - e, 0.0), (0.0, 0.0, 1 + e)]
    xyz, valid = arr(pts + outside)
    got = ids(box_contains(xyz, valid, BoxSpec((0, 0, 0), (2, 2, 2))))
    assert got == set(range(len(pts)))


def test_geo_03_yaw_90_and_slack():
    pts = [
        (0.0, 1.9, 0.0),  # inside (long axis along y)
        (1.9, 0.0, 0.0),  # outside
        (1.0, 2.0, 0.0),  # on rotated boundary
        (1.0 + 5e-10, 2.0, 0.0),  # within slack
        (1.0 + 1e-6, 2.0, 0.0),  # outside
    ]
    xyz, valid = arr(pts)
    box = BoxSpec((0, 0, 0), (4, 2, 2), (0, 0, 90))
    assert ids(box_contains(xyz, valid, box)) == {0, 2, 3}


def test_geo_04_rotation_order_rz_ry_rx():
    r = rotation_matrix((90, 0, 90))
    assert np.allclose(r, [[0, 0, 1], [1, 0, 0], [0, 1, 0]], atol=1e-12)
    r = rotation_matrix((0, 90, 90))
    assert np.allclose(r, [[0, -1, 0], [0, 0, 1], [-1, 0, 0]], atol=1e-12)
    xyz, valid = arr([(0.0, 1.5, 0.0), (0.0, 0.0, 1.5)])
    box = BoxSpec((0, 0, 0), (4, 0.5, 0.5), (90, 0, 90))
    assert ids(box_contains(xyz, valid, box)) == {0}


def test_geo_05_outside_is_complement_of_valid():
    pts = SCENE + [(0.0, 0.0, 0.0)]
    xyz, valid = arr(pts)
    valid[-1] = False
    inside = box_contains(xyz, valid, BoxSpec((3, 3, 2.5), (4, 4, 3)))
    outside = box_contains(
        xyz, valid, BoxSpec((3, 3, 2.5), (4, 4, 3), mode="outside")
    )
    assert not (inside & outside).any()
    assert (inside | outside).tolist() == valid.tolist()


@pytest.mark.parametrize(
    "box",
    [
        BoxSpec((0, 0, 0), (0, 1, 1)),
        BoxSpec((0, 0, 0), (-1, 1, 1)),
        BoxSpec((0, 0, 0), (float("nan"), 1, 1)),
        BoxSpec((float("inf"), 0, 0), (1, 1, 1)),
        BoxSpec((0, 0, 0), (1, 1, 1), (0, float("nan"), 0)),
    ],
)
def test_geo_06_invalid_box(box):
    xyz, valid = arr([(0.0, 0.0, 0.0)])
    with pytest.raises(GeometryError) as exc:
        box_contains(xyz, valid, box)
    assert exc.value.code == "invalid_box"


def test_geo_07_large_coordinates_exact():
    base = np.float32(1e7)
    xyz = np.array(
        [[base + k, 0, 0] for k in (0, 1, 2)], dtype=np.float32
    ).astype(np.float64)
    valid = np.ones(3, dtype=bool)
    box = BoxSpec((float(base) + 1, 0, 0), (1.0, 1.0, 1.0))
    assert ids(box_contains(xyz, valid, box)) == {1}


def test_geo_08_invalid_points_never_members():
    nan, inf = float("nan"), float("inf")
    xyz = np.array(
        [[nan, 0, 0], [0, inf, 0], [0, 0, -inf], [0, 0, 0]], dtype=np.float64
    )
    valid = np.array([False, False, False, False])
    for mode in ("inside", "outside"):
        assert not box_contains(
            xyz, valid, BoxSpec((0, 0, 0), (4, 4, 4), mode=mode)
        ).any()
        assert not prism_contains(
            xyz,
            valid,
            PrismSpec(((-1, -1), (1, -1), (1, 1), (-1, 1)), -1, 1, mode),
        ).any()
    flt = DisplayFilter(AxisRange(True, -1, 1))
    assert not filter_contains(xyz, valid, flt).any()
    assert not filter_contains(xyz, valid, DisplayFilter()).any()


def test_geo_09_filter_axes_and_inclusive():
    xyz, valid = arr(SCENE)
    flt = DisplayFilter(
        x=AxisRange(True, 2, 4), y=AxisRange(True, 0, 3), z=AxisRange(False)
    )
    got = ids(filter_contains(xyz, valid, flt))
    assert got == expect(SCENE, lambda x, y, z: 2 <= x <= 4 and 0 <= y <= 3)
    zonly = DisplayFilter(z=AxisRange(True, 1, 2))
    assert ids(filter_contains(xyz, valid, zonly)) == expect(
        SCENE, lambda x, y, z: 1 <= z <= 2
    )
    assert ids(filter_contains(xyz, valid, DisplayFilter())) == set(
        range(len(SCENE))
    )


@pytest.mark.parametrize(
    "r", [AxisRange(True, 2, 1), AxisRange(True, float("nan"), 1)]
)
def test_geo_10_filter_rejects(r):
    xyz, valid = arr([(0.0, 0.0, 0.0)])
    with pytest.raises(GeometryError):
        filter_contains(xyz, valid, DisplayFilter(x=r))


def test_geo_11_prism_triangle_and_concave():
    xyz, valid = arr(SCENE)
    tri = PrismSpec(((0, 0), (8, 0), (0, 8)), 0.5, 3.5)
    got = ids(prism_contains(xyz, valid, tri))
    assert got == expect(
        SCENE,
        lambda x, y, z: x >= 0 and y >= 0 and x + y <= 8 and 0.5 <= z <= 3.5,
    )
    assert got
    ell = PrismSpec(((0, 0), (6, 0), (6, 2), (2, 2), (2, 6), (0, 6)), -1, 1)
    got = ids(prism_contains(xyz, valid, ell))
    assert got == expect(
        SCENE,
        lambda x, y, z: (
            ((x <= 6 and y <= 2) or (x <= 2 and y <= 6)) and -1 <= z <= 1
        ),
    )


def test_geo_12_prism_boundaries_inclusive():
    sq = ((0, 0), (4, 0), (4, 4), (0, 4))
    e = 2.0**-20
    pts = [
        (2.0, 0.0, 0.5),  # on edge
        (0.0, 0.0, 0.5),  # vertex
        (4.0, 4.0, 0.5),  # vertex
        (2.0, 2.0, 0.0),  # z_min
        (2.0, 2.0, 1.0),  # z_max
        (2.0, 2.0, 1.0 + e),  # above
        (4.0 + e, 2.0, 0.5),  # outside edge
        (2.0, 2.0, 0.5),
    ]
    xyz, valid = arr(pts)
    got = ids(prism_contains(xyz, valid, PrismSpec(sq, 0, 1)))
    assert got == {0, 1, 2, 3, 4, 7}


def test_geo_13_prism_outside_mode():
    sq = ((0, 0), (4, 0), (4, 4), (0, 4))
    xyz, valid = arr(SCENE)
    ins = prism_contains(xyz, valid, PrismSpec(sq, 0, 0))
    out = prism_contains(xyz, valid, PrismSpec(sq, 0, 0, "outside"))
    assert (ins | out).all() and not (ins & out).any()


@pytest.mark.parametrize(
    "poly,zmin,zmax",
    [
        (((0, 0), (1, 1)), 0, 1),
        (((0, 0), (1, 1), (2, 2)), 0, 1),
        (((0, 0), (2, 2), (2, 0), (0, 2)), 0, 1),
        (((0, 0), (float("nan"), 0), (1, 1)), 0, 1),
        (((0, 0), (0, 0), (1, 0), (1, 1)), 0, 1),
        (((0, 0), (1, 0), (1, 1)), 2, 1),
        (((0, 0), (4, 0), (2, 0), (2, 2)), 0, 1),
    ],
)
def test_geo_14_invalid_polygons(poly, zmin, zmax):
    xyz, valid = arr([(0.0, 0.0, 0.0)])
    with pytest.raises(GeometryError) as exc:
        prism_contains(xyz, valid, PrismSpec(poly, zmin, zmax))
    assert exc.value.code == "invalid_polygon"


def test_geo_15_cancel_mid_evaluation():
    xyz, valid = arr(SCENE)
    token = CancelToken()
    calls = []

    real = valid

    class V:
        def __len__(self):
            return len(real)

        def __getitem__(self, key):
            calls.append(key)
            if len(calls) == 2:
                token.cancel()
            return real[key]

    with pytest.raises(Cancelled):
        box_contains(
            xyz, V(), BoxSpec((3, 3, 2), (100, 100, 100)), token, chunk=10
        )
    assert len(calls) < len(SCENE) // 10


def test_geo_16_chunking_is_invisible():
    xyz, valid = arr(SCENE)
    box = BoxSpec((3, 3, 2.5), (4, 4, 3), (0, 0, 17))
    tri = PrismSpec(((0, 0), (8, 0), (0, 8)), 0.5, 3.5)
    flt = DisplayFilter(x=AxisRange(True, 2, 4))
    for fn, spec in (
        (box_contains, box),
        (prism_contains, tri),
        (filter_contains, flt),
    ):
        a = fn(xyz, valid, spec, chunk=7)
        b = fn(xyz, valid, spec, chunk=len(xyz))
        assert a.tolist() == b.tolist()


def test_geo_17_tolerance_constants():
    assert tolerance.GEO_EPS_WORLD == 0.0
    assert tolerance.GEO_EPS_ROTATED == 1e-9
    assert tolerance.GEO_EPS_EDGE == 1e-9
    assert tolerance.CLUSTER_REL == 1e-12


def test_geo_18_world_axis_one_ulp_outside_excluded():
    ulp = float(np.nextafter(np.float32(1), np.float32(2))) - 1.0
    xyz, valid = arr([(1.0, 0, 0), (1.0 + ulp, 0, 0)])
    box = BoxSpec((0, 0, 0), (2, 2, 2))
    assert ids(box_contains(xyz, valid, box)) == {0}
    flt = DisplayFilter(x=AxisRange(True, -1, 1))
    assert ids(filter_contains(xyz, valid, flt)) == {0}
    sq = PrismSpec(((-1, -1), (1, -1), (1, 1), (-1, 1)), -1, 1)
    z = [(0, 0, 1.0), (0, 0, 1.0 + ulp)]
    zxyz, zvalid = arr(z)
    assert ids(prism_contains(zxyz, zvalid, sq)) == {0}


def test_geo_19_rotated_slack_boundaries():
    box = BoxSpec((0, 0, 0), (2, 2, 2), (0, 0, 45))
    s = 2**0.5
    xyz, valid = arr([(s, 0, 0), (s + 5e-10, 0, 0), (s + 1e-6, 0, 0)])
    assert ids(box_contains(xyz, valid, box)) == {0, 1}


def test_geo_20_polygon_edge_slack():
    sq = PrismSpec(((0, 0), (4, 0), (4, 4), (0, 4)), 0, 0)
    xyz, valid = arr([(2, -5e-10, 0), (2, -1e-6, 0), (2, 0, 0)])
    assert ids(prism_contains(xyz, valid, sq)) == {0, 2}


def test_geo_21_identity_rotation_exact():
    assert (rotation_matrix((0, 0, 0)) == np.eye(3)).all()


def test_geo_22_rotation_skipped_gives_same_as_identity_path():
    xyz, valid = arr(SCENE)
    a = box_contains(xyz, valid, BoxSpec((3, 3, 2.5), (4, 4, 3)))
    b = box_contains(
        xyz, valid, BoxSpec((3, 3, 2.5), (4, 4, 3), (0.0, 0, -0.0))
    )
    assert a.tolist() == b.tolist()
