"""TLT-01..08: tilted protection slab (independent oracle, no production maths)."""

import math

import numpy as np
import pytest

from fixtures.pcdgen import build_pcd, xyz_fields
from fixtures.sessions import fixture_dir, make_settings, select_box, wait
from gr_pcd.editing.protection import (
    Interval,
    OperationProtection,
    ProtectionState,
    Tilt,
    effective_intervals,
    protected_mask,
    validate_protection,
)
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.geometry.errors import GeometryError
from gr_pcd.session.codec import ClusterTool
from gr_pcd.session.engine import SelectSpec
from gr_pcd.session.manager import SessionManager

# Shared with frontend/src/inspector/tilt.test.ts (UI-220): (rx, ry, pivot, p, s)
GOLDEN = [
    (0, 0, (0, 0), (1, 2, 3), 3.0),
    (0, 30, (0, 0), (2, 0, 1), 1.8660254037844386),
    (30, 0, (0, 0), (0, 2, 1), -0.13397459621556118),
    (20, -40, (1, -2), (3, 1, 0.5), -1.8741828218906362),
    (-60, 60, (5, 5), (0, 0, 0), -6.49519052838329),
]


def oracle_s(rx, ry, pivot, p):
    """Own rotation matrices: n = Ry(ry) @ Rx(rx) @ e_z; s = n . (p - pivot)."""
    a, b = math.radians(rx), math.radians(ry)
    rx_m = np.array(
        [
            [1, 0, 0],
            [0, math.cos(a), -math.sin(a)],
            [0, math.sin(a), math.cos(a)],
        ]
    )
    ry_m = np.array(
        [
            [math.cos(b), 0, math.sin(b)],
            [0, 1, 0],
            [-math.sin(b), 0, math.cos(b)],
        ]
    )
    n = ry_m @ rx_m @ np.array([0.0, 0.0, 1.0])
    q = np.array([p[0] - pivot[0], p[1] - pivot[1], p[2]])
    return float(n @ q)


def oracle_mask(xyz, valid, intervals, tilt):
    out = []
    for p, v in zip(xyz, valid, strict=True):
        if not v:
            out.append(False)
            continue
        s = oracle_s(tilt.rx_deg, tilt.ry_deg, tilt.pivot, p)
        out.append(any(lo - 1e-9 <= s <= hi + 1e-9 for lo, hi in intervals))
    return np.array(out)


@pytest.mark.parametrize("rx,ry,pivot,p,s", GOLDEN)
def test_tlt_00_golden_table(rx, ry, pivot, p, s):
    assert oracle_s(rx, ry, pivot, p) == pytest.approx(s, abs=1e-12)
    xyz = np.array([p], dtype=float)
    ok = np.array([True])
    t = Tilt(rx, ry, pivot)
    assert protected_mask(xyz, ok, [(s - 1, s)], t)[0]
    assert protected_mask(xyz, ok, [(s, s + 1)], t)[0]
    assert not protected_mask(xyz, ok, [(s + 1e-6, s + 2)], t)[0]
    assert not protected_mask(xyz, ok, [(s - 2, s - 1e-6)], t)[0]


def random_cloud(rng, n=400):
    xyz = rng.uniform(-5, 5, size=(n, 3))
    xyz[0] = (np.nan, 0, 0)
    xyz[1] = (0, np.inf, 0)
    valid = np.isfinite(xyz).all(axis=1)
    return xyz, valid


def test_tlt_01_level_is_bit_identical():
    rng = np.random.default_rng(1)
    xyz, valid = random_cloud(rng)
    xyz[10:20, 2] = 0.25  # exactly on the interval ends
    xyz[20:30, 2] = 1.5
    ivs = [(0.25, 1.5), (-3.0, -2.0)]
    old = np.zeros(len(xyz), dtype=bool)
    z = xyz[:, 2]
    with np.errstate(invalid="ignore"):
        for lo, hi in ivs:
            old |= (z >= lo) & (z <= hi)
    old &= valid
    assert np.array_equal(protected_mask(xyz, valid, ivs), old)
    assert np.array_equal(protected_mask(xyz, valid, ivs, None), old)
    assert np.array_equal(protected_mask(xyz, valid, ivs, Tilt()), old)
    # a pivot alone does not tilt
    assert np.array_equal(
        protected_mask(xyz, valid, ivs, Tilt(0.0, 0.0, (3.0, 4.0))), old
    )
    assert old[10:30].all()


def test_tlt_02_oracle_random_tilts():
    rng = np.random.default_rng(2)
    xyz, valid = random_cloud(rng, 300)
    for _ in range(20):
        t = Tilt(
            float(rng.uniform(-60, 60)),
            float(rng.uniform(-60, 60)),
            (float(rng.uniform(-3, 3)), float(rng.uniform(-3, 3))),
        )
        lo = float(rng.uniform(-3, 1))
        ivs = [(lo, lo + float(rng.uniform(0.2, 3)))]
        if rng.random() < 0.5:
            ivs.append((lo + 4, lo + 5))
        got = protected_mask(xyz, valid, ivs, t)
        assert np.array_equal(got, oracle_mask(xyz, valid, ivs, t))
        assert got.any() and not got.all()


def test_tlt_03_inclusive_boundaries():
    t = Tilt(10.0, -20.0, (1.0, 2.0))
    p = (0.7, -0.4, 0.3)
    s0 = oracle_s(10.0, -20.0, (1.0, 2.0), p)
    xyz = np.array([p])
    ok = np.array([True])
    cases = (
        (5e-10, True, True),
        (-5e-10, True, True),
        (5e-9, True, False),
        (-5e-9, False, True),
    )
    for delta, hi_in, lo_in in cases:
        assert (
            bool(protected_mask(xyz, ok, [(s0 - 10, s0 + delta)], t)[0])
            is hi_in
        )
        assert (
            bool(protected_mask(xyz, ok, [(s0 + delta, s0 + 10)], t)[0])
            is lo_in
        )
    # exactly on the end
    assert protected_mask(xyz, ok, [(s0, s0)], t)[0]


@pytest.mark.parametrize(
    "tilt",
    [
        Tilt(float("nan"), 0.0, (0.0, 0.0)),
        Tilt(0.0, float("inf"), (0.0, 0.0)),
        Tilt(60.0001, 0.0, (0.0, 0.0)),
        Tilt(0.0, -61.0, (0.0, 0.0)),
        Tilt(1.0, 1.0, (float("nan"), 0.0)),
        Tilt(1.0, 1.0, (0.0, float("inf"))),
    ],
)
def test_tlt_04_validation(tilt):
    with pytest.raises(GeometryError) as err:
        validate_protection(
            ProtectionState(Interval(True, 0.0, 1.0), tilt=tilt)
        )
    assert err.value.code == "invalid_protection"


def test_tlt_04b_limits_accepted():
    for rx, ry in ((60.0, -60.0), (-60.0, 60.0), (0.0, 0.0)):
        validate_protection(
            ProtectionState(
                Interval(True, 0.0, 1.0), tilt=Tilt(rx, ry, (1.0, 2.0))
            )
        )


def test_tlt_05_modes_share_the_tilt():
    rng = np.random.default_rng(5)
    xyz, valid = random_cloud(rng, 200)
    t = Tilt(15.0, -25.0, (0.5, -0.5))
    g, loc = Interval(True, -1.0, 0.0), (1.0, 2.0)
    cases = {
        "inherit": [(-1.0, 0.0)],
        "add_local": [(-1.0, 0.0), (1.0, 2.0)],
        "override": [(1.0, 2.0)],
    }
    for mode, expect in cases.items():
        st = ProtectionState(
            g, OperationProtection(mode, loc, mode == "override"), t
        )
        assert effective_intervals(st) == expect
        got = protected_mask(xyz, valid, effective_intervals(st), st.tilt)
        assert np.array_equal(got, oracle_mask(xyz, valid, expect, t))


TILT = Tilt(3.0, -5.0, (0.0, 0.0))


def tilted_scene(seed=6):
    """Floor on the tilted plane (s in +-0.02), ghosts above (s 0.5..2), low wall."""
    rng = np.random.default_rng(seed)
    a, b = math.radians(TILT.rx_deg), math.radians(TILT.ry_deg)
    n = (math.cos(a) * math.sin(b), -math.sin(a), math.cos(a) * math.cos(b))

    def at(x, y, s):
        return (x, y, (s - n[0] * x - n[1] * y) / n[2])

    rows, label = [], []
    for _ in range(300):
        x, y = rng.uniform(-4, 4, 2)
        rows.append(at(float(x), float(y), float(rng.uniform(-0.02, 0.02))))
        label.append("floor")
    for _ in range(80):
        x, y = rng.uniform(-4, 4, 2)
        rows.append(at(float(x), float(y), float(rng.uniform(0.5, 2.0))))
        label.append("ghost")
    for _ in range(40):  # a low wall: below the floor
        x, y = rng.uniform(-4, 4, 2)
        rows.append(at(float(x), float(y), float(rng.uniform(-1.5, -0.5))))
        label.append("wall")
    return rows, np.array(label)


@pytest.fixture
def tilted(tmp_path):
    settings = make_settings(tmp_path)
    rows, label = tilted_scene()
    path = fixture_dir(settings) / "tilted.pcd"
    path.write_bytes(build_pcd(xyz_fields(8), rows, "binary"))
    m = SessionManager(settings)
    s = m.open_pcd(path, "tilted.pcd")
    yield m, s, np.array(rows), label
    m.jobs.shutdown()


EVERYTHING = BoxSpec(center=(0.0, 0.0, 0.0), dimensions=(40, 40, 40))


def test_tlt_06_engine_candidate_and_apply_on_tilted_floor(tilted):
    m, s, xyz, label = tilted
    s.set_protection(ProtectionState(Interval(True, -0.05, 0.05), tilt=TILT))
    job = select_box(m, EVERYTHING)
    assert job.status == "complete", job.error
    cand = job.result["candidate"]
    prot = oracle_mask(xyz, np.ones(len(xyz), bool), [(-0.05, 0.05)], TILT)
    assert prot.sum() == (label == "floor").sum()
    assert cand["candidates"] == int((~prot).sum())
    assert cand["protected_retained"] == int(prot.sum())
    ids = s.candidate_ids(cand["candidate_id"], 0, 10000)["ids"]
    assert set(ids) == set(np.flatnonzero(~prot).tolist())
    s.apply(cand["candidate_id"], s.clock.cloud, None)
    assert set(np.flatnonzero(s.active)) == set(np.flatnonzero(prot))
    # the level slab at the same numbers protects something else entirely
    assert s.state()["counts"]["protected"] == int(prot.sum())


def test_tlt_07_render_flag_for_tilted(tilted):
    m, s, xyz, _ = tilted
    s.set_protection(ProtectionState(Interval(True, -0.05, 0.05), tilt=TILT))
    select_box(m, EVERYTHING)
    arr, _ = s.render(100000, "edited")
    prot = oracle_mask(xyz, np.ones(len(xyz), bool), [(-0.05, 0.05)], TILT)
    flag2 = {int(i) for i, f in zip(arr.ids, arr.flags, strict=True) if f & 2}
    flag1 = {int(i) for i, f in zip(arr.ids, arr.flags, strict=True) if f & 1}
    assert flag2 == set(np.flatnonzero(prot).tolist())
    assert flag1 == set(np.flatnonzero(~prot).tolist())
    assert s.state()["counts"]["protected"] == int(prot.sum())


def test_tlt_08_cluster_excludes_tilted_protected(tilted):
    m, s, xyz, label = tilted
    floor_ids = np.flatnonzero(label == "floor")
    seed = int(floor_ids[0])
    # unprotected: the floor seed grows into some component
    spec = SelectSpec(
        "replace",
        "active",
        ClusterTool(seed, 1.5, None, False, None, "partial"),
    )
    free = wait(m.submit_select(spec))
    assert free.status == "complete", free.error
    s.set_protection(ProtectionState(Interval(True, -0.05, 0.05), tilt=TILT))
    spec = SelectSpec(
        "replace",
        "active",
        ClusterTool(
            int(np.flatnonzero(label == "ghost")[0]),
            3.0,
            None,
            True,
            None,
            "partial",
        ),
    )
    job = wait(m.submit_select(spec))
    assert job.status == "complete", job.error
    sel = set(np.flatnonzero(s.selection).tolist())
    prot = oracle_mask(xyz, np.ones(len(xyz), bool), [(-0.05, 0.05)], TILT)
    assert sel and sel.isdisjoint(set(np.flatnonzero(prot).tolist()))
