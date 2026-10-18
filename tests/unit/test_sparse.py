"""SPR-01..09: the sparse-point artifact filter (part 13-2). SPR-10 is test_sparse_perf.py.

The oracle is brute force over integer cube coordinates (no neighbour search shared with the code under test).
Written after the code: RED was not seen for these."""

import numpy as np
import pytest

from fixtures.pcdgen import SCENE_GHOST, scene_rows
from fixtures.sessions import (
    fixture_dir,
    make_settings,
    select_box,
    wait,
    write_scene,
)
from gr_pcd.editing.cancel import Cancelled, CancelToken
from gr_pcd.editing.protection import Interval, ProtectionState
from gr_pcd.editing.sparse import SparseSpec, auto_radius, sparse_mask
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.geometry.filters import AxisRange, DisplayFilter
from gr_pcd.session.engine import SelectSpec
from gr_pcd.session.manager import SessionManager

XYZ = np.array([r[:3] for r in scene_rows()], dtype=np.float64)
VALID = np.isfinite(XYZ).all(axis=1)
FLOOR_BOUNDARY = {
    i for i in range(100) if i // 10 in (0, 9) or i % 10 in (0, 9)
}  # ids are x * 10 + y
FLOOR_CORNERS = {0, 9, 90, 99}


def brute(xyz, counted, radius, minn):
    """Selected ids by the definition: counted points in the 3x3x3 cubes around the cube of the point."""
    pts = xyz[counted]
    cells = np.floor((pts - pts.min(axis=0)) / radius).astype(np.int64)
    out = set()
    for k, idx in enumerate(np.flatnonzero(counted)):
        near = np.abs(cells - cells[k]).max(axis=1) <= 1
        if int(near.sum()) < minn:
            out.add(int(idx))
    return out


def ids(mask):
    return set(np.flatnonzero(mask).tolist())


def test_spr_01_isolated_points_selected_dense_plane_not():
    g = np.arange(40) * 0.05
    plane = np.array([(x, y, 0.0) for x in g for y in g])
    floating = np.array([(0.5, 0.5, 1.0), (1.5, 0.2, 1.7), (0.1, 1.9, 0.8)])
    xyz = np.vstack([plane, floating])
    mask = sparse_mask(xyz, np.ones(len(xyz), bool), 0.3, 8)
    assert ids(mask) == {1600, 1601, 1602}


@pytest.mark.parametrize("seed", range(4))
def test_spr_02_matches_brute_force_on_random_clouds(seed):
    rng = np.random.default_rng(seed)
    xyz = rng.uniform(0, 3, (500, 3))
    counted = rng.uniform(size=500) < 0.9
    for radius, minn in [(0.4, 5), (0.7, 12), (0.25, 3)]:
        mask = sparse_mask(xyz, counted, radius, minn)
        assert ids(mask) == brute(xyz, counted, radius, minn)
        assert not mask[~counted].any()  # an uncounted point is never selected


def test_spr_03_min_neighbours_boundary():
    # 6 points in one cube plus one far away: the cube's points see exactly 6
    xyz = np.array([[0.1 * i, 0.0, 0.0] for i in range(6)] + [[50.0, 0.0, 0.0]])
    counted = np.ones(7, bool)
    assert ids(sparse_mask(xyz, counted, 1.0, 6)) == {6}  # 6 is not below 6
    assert ids(sparse_mask(xyz, counted, 1.0, 7)) == {0, 1, 2, 3, 4, 5, 6}


@pytest.fixture
def mgr(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    m = SessionManager(settings)
    m.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    yield m
    m.jobs.shutdown()


def run(mgr, tool, op="replace", scope="active"):
    job = wait(mgr.submit_select(SelectSpec(op, scope, tool)))
    assert job.status == "complete", job.error
    s = mgr.require()
    return set(np.flatnonzero(s.selection & s.active & s.valid).tolist())


def test_spr_01b_the_scene_floor_boundary_by_hand(mgr):
    # floor corners see 4 points, edges 6, interior 9 or more (ghosts add some)
    assert run(mgr, SparseSpec(1.0, 5)) == FLOOR_CORNERS
    assert run(mgr, SparseSpec(1.0, 7)) == FLOOR_BOUNDARY


def test_spr_04_a_region_restricts(mgr):
    region = BoxSpec(center=(0.0, 0.0, 0.0), dimensions=(2.0, 2.0, 2.0))
    got = run(mgr, SparseSpec(1.0, 7, region=region))
    assert got == {i for i in FLOOR_BOUNDARY if i // 10 <= 1 and i % 10 <= 1}


def test_spr_05_protected_points_are_excluded_when_asked(mgr):
    s = mgr.require()
    s.set_protection(ProtectionState(Interval(True, -0.5, 0.5)))  # the floor
    assert run(mgr, SparseSpec(1.0, 7, exclude_protected=True)) == set()
    assert (
        run(mgr, SparseSpec(1.0, 7, exclude_protected=False)) == FLOOR_BOUNDARY
    )


def test_spr_06_scope_displayed_vs_active(mgr):
    s = mgr.require()
    s.set_display_filter(DisplayFilter(x=AxisRange(True, 0.0, 4.5)))
    tool = SparseSpec(1.0, 7)
    assert run(mgr, tool, scope="active") == FLOOR_BOUNDARY
    shown = {i for i in FLOOR_BOUNDARY if i // 10 <= 4}
    assert run(mgr, tool, scope="displayed") == shown
    # the count still sees the hidden points: x = 4 is not made isolated by hiding x >= 5
    assert not {40, 41} & run(mgr, SparseSpec(1.0, 5), scope="displayed")


@pytest.mark.parametrize("op", ["add", "subtract", "intersect"])
def test_spr_07_composes_with_ops_and_preview_commit(mgr, op):
    s = mgr.require()
    assert (
        select_box(
            mgr, BoxSpec(center=(0.5, 4.5, 0.0), dimensions=(1.0, 10.0, 1.0))
        ).status
        == "complete"
    )  # x = 0 and 1 floor columns
    base = set(np.flatnonzero(s.selection & s.active & s.valid).tolist())
    shape = FLOOR_BOUNDARY
    want = {
        "add": base | shape,
        "subtract": base - shape,
        "intersect": base & shape,
    }[op]
    spec = SelectSpec(op, "active", SparseSpec(1.0, 7))
    pv = s.run_preview(spec, s.clock.ticket(), CancelToken())
    assert pv["selected_after"] == len(want)
    job = wait(mgr.submit_commit(pv["preview_id"]))
    assert job.status == "complete", job.error
    got = set(np.flatnonzero(s.selection & s.active & s.valid).tolist())
    assert got == want  # the committed mask is the previewed one


def test_spr_08_cancel_leaves_the_selection_unchanged(mgr):
    s = mgr.require()
    before = s.selection
    token = CancelToken()
    token.cancel()
    with pytest.raises(Cancelled):
        s.run_select(
            SelectSpec("replace", "active", SparseSpec(1.0, 7)),
            s.clock.ticket(),
            token,
        )
    assert s.selection is before and not s.selection.any()


@pytest.mark.parametrize(
    "bad",
    [
        SparseSpec(0.0, 8),
        SparseSpec(-1.0, 8),
        SparseSpec(float("nan"), 8),
        SparseSpec(1.0, 0),
        SparseSpec(1.0, -3),
        SparseSpec(1e-300, 8),
    ],
)
def test_spr_09_invalid_parameters_are_refused(mgr, bad):
    job = wait(mgr.submit_select(SelectSpec("replace", "active", bad)))
    assert job.status == "failed" and job.error["code"] == "invalid_tool", (
        job.error
    )


def test_spr_09b_auto_radius_follows_the_sample_spacing():
    g = np.arange(50) * 0.1
    coarse = np.array([(x, y, 0.0) for x in g for y in g])
    fine = coarse * 0.1
    assert (
        0.55 < auto_radius(coarse) < 0.65
    )  # 6 x the median nearest distance 0.1
    assert auto_radius(fine) == pytest.approx(auto_radius(coarse) * 0.1)
    assert SCENE_GHOST  # fixture sanity (ids used above)
