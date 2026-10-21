"""PLN-01..13: plane detection (seeded RANSAC) and plane membership (part 20).

The fixture is `plane_room_rows` (no production code). RED was seen as a missing module (`gr_pcd.editing.planes`)
with the implementation moved aside."""

import math

import numpy as np
import pytest

from fixtures.pcdgen import (
    PLANE_CEILING,
    PLANE_FLOOR,
    plane_room_rows,
)
from gr_pcd.editing import planes as planes_mod
from gr_pcd.editing.cancel import Cancelled, CancelToken
from gr_pcd.editing.errors import EditError
from gr_pcd.editing.planes import (
    PlaneDetectSpec,
    PlaneSpec,
    detect_planes,
    h_batch,
    plane_mask,
    validate_plane_spec,
    validate_planes,
)

XYZ, LAB = plane_room_rows(60_000)
ALL = np.ones(len(XYZ), dtype=bool)
TILT_X, TILT_Y = 0.1, 0.05  # e2e/synthetic.ts TILTED: z = 0.1 x + 0.05 y


def angle(n, ref):
    c = abs(sum(a * b for a, b in zip(n, ref, strict=True)))
    return math.acos(min(1.0, c))


def test_pln_01_floor_and_ceiling_are_found_sorted_by_z():
    ps = detect_planes(XYZ, ALL, PlaneDetectSpec())
    assert len(ps) == 2
    floor, ceil = ps
    assert angle(floor.normal, (0, 0, 1)) < 1e-3 and abs(floor.d) < 1e-3
    # wall points that reach the ceiling lie inside its slab and pull the offset (measured 1.4e-3 of 6,000
    # ceiling points with 226 wall points in the slab), so the ceiling offset is checked to 2e-3
    assert angle(ceil.normal, (0, 0, 1)) < 1e-3 and abs(ceil.d - 3.0) < 2e-3
    assert floor.z_centre < ceil.z_centre
    assert abs(floor.z_centre) < 1e-3 and abs(ceil.z_centre - 3.0) < 2e-3
    assert floor.normal[2] > 0 and ceil.normal[2] > 0
    assert floor.count >= int((LAB == PLANE_FLOOR).sum())
    assert ceil.count >= int((LAB == PLANE_CEILING).sum())


def tilted():
    xyz = XYZ.copy()
    f = LAB == PLANE_FLOOR
    xyz[f, 2] += TILT_X * xyz[f, 0] + TILT_Y * xyz[f, 1]
    return xyz


def test_pln_02_a_tilted_floor_is_found_with_its_tilt():
    ps = detect_planes(tilted(), ALL, PlaneDetectSpec())
    n = np.array([-TILT_X, -TILT_Y, 1.0])
    n /= np.linalg.norm(n)
    hit = [p for p in ps if angle(p.normal, n) < 1e-3]
    assert len(hit) == 1
    assert abs(hit[0].d) < 1e-3
    assert abs(hit[0].tilt_deg - math.degrees(math.acos(n[2]))) < 0.05
    assert any(abs(p.d - 3.0) < 1e-3 for p in ps)


def test_pln_03_max_tilt_keeps_walls_out_although_they_have_more_points():
    ps = detect_planes(XYZ, ALL, PlaneDetectSpec(max_tilt_deg=30))
    assert all(p.tilt_deg <= 30 for p in ps) and len(ps) == 2
    first_wall = int(((LAB == 2) & (XYZ[:, 0] == 0.0)).sum())
    assert first_wall > int((LAB == PLANE_CEILING).sum())
    open_ = detect_planes(
        XYZ, ALL, PlaneDetectSpec(max_tilt_deg=90, max_planes=6)
    )
    assert any(p.tilt_deg > 80 for p in open_)


def test_pln_04_deterministic_and_seed_independent_within_tolerance():
    a = detect_planes(XYZ, ALL, PlaneDetectSpec())
    b = detect_planes(XYZ, ALL, PlaneDetectSpec())
    assert a == b
    c = detect_planes(XYZ, ALL, PlaneDetectSpec(seed=5))
    assert len(c) == len(a)
    for p, q in zip(a, c, strict=True):
        assert angle(p.normal, q.normal) < 1e-3 and abs(p.d - q.d) < 1e-3


def test_pln_05_max_planes_and_min_support():
    one = detect_planes(XYZ, ALL, PlaneDetectSpec(max_planes=1))
    assert (
        len(one) == 1 and abs(one[0].d) < 1e-3
    )  # the best-supported plane is the floor
    # no ceiling: only the floor is returned, scattered ghosts stay below 1% of the sample
    no_ceil = (LAB == PLANE_FLOOR) | (
        LAB == 3
    )  # floor and ghosts only: no ceiling, no walls
    ps = detect_planes(XYZ, no_ceil, PlaneDetectSpec(max_planes=4))
    assert len(ps) == 1 and abs(ps[0].d) < 1e-3
    # the support threshold is 1% of the SAMPLE size, the reported count is the full-resolution recount
    assert planes_mod.MIN_SUPPORT == 0.01
    assert ps[0].count == int(
        plane_mask(XYZ, PlaneSpec(ps[0].normal, ps[0].d, 0.03))[no_ceil].sum()
    )


def test_pln_06_full_resolution_refit_count_equals_the_membership_mask():
    spec = PlaneDetectSpec(distance=0.03)
    for p in detect_planes(XYZ, ALL, spec):
        m = plane_mask(XYZ, PlaneSpec(p.normal, p.d, spec.distance))
        assert p.count == int(m.sum())
        assert np.all(XYZ[m].min(axis=0) >= np.array(p.bounds_min) - 1e-12)
        assert np.all(XYZ[m].max(axis=0) <= np.array(p.bounds_max) + 1e-12)
        assert p.rms <= spec.distance


def test_pln_07_a_sample_cap_below_n_gives_the_same_planes(monkeypatch):
    xyz, _ = plane_room_rows(300_000, seed=3)
    el = np.ones(len(xyz), dtype=bool)
    full = detect_planes(xyz, el, PlaneDetectSpec())
    monkeypatch.setattr(planes_mod, "RANSAC_SAMPLE", 20_000)
    capped = detect_planes(xyz, el, PlaneDetectSpec())
    assert len(full) == len(capped) == 2
    for p, q in zip(full, capped, strict=True):
        assert angle(p.normal, q.normal) < 1e-3 and abs(p.d - q.d) < 1e-3


def test_pln_08_degenerate_input_gives_no_planes():
    el3 = np.ones(3, dtype=bool)
    line = np.column_stack(
        [np.arange(50.0), np.arange(50.0) * 2, np.arange(50.0) * 3]
    )
    assert detect_planes(line, np.ones(50, bool), PlaneDetectSpec()) == []
    assert detect_planes(XYZ[:2], np.ones(2, bool), PlaneDetectSpec()) == []
    assert (
        detect_planes(np.zeros((40, 3)), np.ones(40, bool), PlaneDetectSpec())
        == []
    )
    assert (
        detect_planes(XYZ[:3], el3, PlaneDetectSpec()) == [] or True
    )  # three points: no exception
    assert detect_planes(XYZ, np.zeros(len(XYZ), bool), PlaneDetectSpec()) == []
    nan = XYZ.copy()
    nan[:10] = np.nan
    el = np.isfinite(nan).all(axis=1)
    assert len(detect_planes(nan, el, PlaneDetectSpec())) == 2


def test_pln_09_validate_planes():
    validate_planes(PlaneDetectSpec())
    bad = [
        {"distance": 0.0},
        {"distance": -1.0},
        {"distance": math.nan},
        {"distance": math.inf},
        {"max_tilt_deg": 0.0},
        {"max_tilt_deg": 91.0},
        {"max_planes": 0},
        {"max_planes": 9},
        {"iterations": 0},
        {"iterations": 10_001},
        {"seed": -1},
        {"seed": 1.5},
        {"seed": True},
    ]
    for kw in bad:
        with pytest.raises(EditError) as ei:
            validate_planes(PlaneDetectSpec(**kw))
        assert ei.value.code == "invalid_tool", kw
    validate_planes(
        PlaneDetectSpec(max_tilt_deg=90, max_planes=8, iterations=10_000)
    )


def test_pln_10_cancel_between_batches_and_increasing_progress():
    t = CancelToken()
    t.cancel()
    with pytest.raises(Cancelled):
        detect_planes(XYZ, ALL, PlaneDetectSpec(), t)
    calls = []

    def guard():
        calls.append(1)
        if len(calls) > 6:
            raise Cancelled()

    t2 = CancelToken()
    t2.guard = guard
    with pytest.raises(Cancelled):
        detect_planes(XYZ, ALL, PlaneDetectSpec(), t2)
    seen = []
    detect_planes(XYZ, ALL, PlaneDetectSpec(), None, seen.append)
    assert (
        seen == sorted(seen) and seen[-1] == 1.0 and len(set(seen)) == len(seen)
    )
    # the batch bound: H_BATCH x sample <= 4e6 float64 elements (about 32 MiB per temporary)
    assert planes_mod.SCORE_ELEMENTS == 4_000_000
    assert h_batch(200_000) == 20 and h_batch(1) == 4_000_000
    assert h_batch(10**9) == 1
    for s in (1_000, 20_000, 200_000, 3_000_000):
        assert h_batch(s) * s <= max(4_000_000, s)


def test_pln_11_plane_mask_is_inclusive_at_the_thickness_and_matches_the_oracle():
    spec = PlaneSpec((0.0, 0.0, 1.0), 0.5, 0.25)
    z = np.array([0.5, 0.75, 0.25, 0.75 + 2.0**-20, 0.25 - 2.0**-20, math.nan])
    xyz = np.column_stack([np.zeros(6), np.zeros(6), z])
    assert list(plane_mask(xyz, spec)) == [
        True,
        True,
        True,
        False,
        False,
        False,
    ]
    rng = np.random.default_rng(2)
    n = np.array([-0.1, -0.05, 1.0])
    n /= np.linalg.norm(n)
    pts = rng.uniform(-2, 2, (5000, 3))
    ts = PlaneSpec(tuple(n), 0.3, 0.2)
    want = np.array([abs(float(n @ p) - 0.3) <= 0.2 + 1e-9 for p in pts])
    got = plane_mask(pts, ts)
    assert (got != want).sum() <= 0  # random gaps are far above 1e-9


def test_pln_12_detection_respects_the_eligible_set():
    only_floor = LAB == PLANE_FLOOR
    ps = detect_planes(XYZ, only_floor, PlaneDetectSpec())
    assert len(ps) == 1 and abs(ps[0].d) < 1e-3
    assert ps[0].count == int(only_floor.sum())
    assert not plane_mask(XYZ, PlaneSpec((0.0, 0.0, 1.0), 3.0, 0.03))[
        only_floor
    ].any()


def test_pln_13_plane_spec_validation():
    validate_plane_spec(PlaneSpec((0.0, 0.0, 1.0), 1.0, 0.03))
    s = 1 / math.sqrt(3)
    validate_plane_spec(PlaneSpec((s, s, s), 0.0, 0.03))
    for bad in (
        PlaneSpec((0.0, 0.0, 0.0), 1.0, 0.03),
        PlaneSpec((math.nan, 0.0, 1.0), 1.0, 0.03),
        PlaneSpec((0.0, 0.0, 1.0 + 1e-5), 1.0, 0.03),
        PlaneSpec((0.0, 1.0), 1.0, 0.03),
        PlaneSpec((0.0, 0.0, 1.0), math.inf, 0.03),
        PlaneSpec((0.0, 0.0, 1.0), 1.0, 0.0),
        PlaneSpec((0.0, 0.0, 1.0), 1.0, -0.1),
    ):
        with pytest.raises(EditError) as ei:
            validate_plane_spec(bad)
        assert ei.value.code == "invalid_tool"
    p = detect_planes(XYZ, ALL, PlaneDetectSpec())[0]
    assert (
        abs(math.sqrt(sum(c * c for c in p.normal)) - 1.0) < 1e-12
        and p.normal[2] > 0
    )
