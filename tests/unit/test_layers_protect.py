"""LAY-80..88: protected and locked layer flags, P = band + protected layers."""

import numpy as np
import pytest

from fixtures.pcdgen import SCENE_FLOOR, SCENE_GHOST, SCENE_INVALID
from fixtures.sessions import (
    fixture_dir,
    make_settings,
    select_box,
    wait,
    write_scene,
)
from gr_pcd.editing.layers import Layer, hidden_points, protected_points
from gr_pcd.editing.protection import (
    Interval,
    OperationProtection,
    ProtectionState,
)
from gr_pcd.editing.sparse import SparseSpec
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.session.codec import ClusterTool
from gr_pcd.session.engine import FLAG_PROTECTED, FLAG_SELECTED, SelectSpec
from gr_pcd.session.manager import SessionManager

FLOOR_BOX = BoxSpec(center=(4.5, 4.5, 0.0), dimensions=(11, 11, 0.5))
ALL_BOX = BoxSpec(center=(4.5, 4.5, 1.5), dimensions=(12, 12, 6))
GHOST_BOX = BoxSpec(center=(3.0, 3.0, 2.0), dimensions=(2, 2, 2))


@pytest.fixture
def mgr(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    m = SessionManager(settings)
    m.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    yield m
    m.jobs.shutdown()


def ids(mask):
    return set(np.flatnonzero(mask).tolist())


def pick(mgr, box, op="replace"):
    job = select_box(mgr, box, op=op)
    assert job.status == "complete", job.error
    return mgr.require(), job


def protect_floor(mgr):
    s, _ = pick(mgr, FLOOR_BOX)
    s.create_layer(s.clock.cloud, name="Floor")
    s.patch_layer(1, protected=True)
    return s


def test_lay_80_protected_points_mask():
    layer = np.array([0, 1, 2, 1, 0], dtype=np.uint8)
    layers = [Layer(1, "A", 0), Layer(2, "B", 1, protected=True)]
    assert ids(protected_points(layer, layers)) == {2}
    layers = [Layer(1, "A", 0, protected=True), layers[1]]
    assert ids(protected_points(layer, layers)) == {1, 2, 3}
    assert protected_points(layer, [Layer(1, "A", 0)]) is None
    assert protected_points(None, layers) is None
    hid = [Layer(1, "A", 0, visible=False, protected=True)]
    assert ids(hidden_points(layer, hid)) == {1, 3}


def test_lay_81_protected_layer_is_kept_from_the_candidate(mgr):
    s = protect_floor(mgr)
    s, job = pick(mgr, ALL_BOX)
    cand = job.result["candidate"]
    assert ids(s.selection) == SCENE_FLOOR | SCENE_GHOST
    assert set(s.candidate.result.ids.tolist()) == SCENE_GHOST
    assert cand["protected_retained"] == 100
    assert cand["protected_by_layers"] == 100


def test_lay_82_override_bypasses_only_the_band(mgr):
    s = protect_floor(mgr)
    s.patch_layer(1, protected=False)
    # ghosts 100..108 form the protected layer 2 (z=1 plane of the ghost grid)
    s, _ = pick(mgr, GHOST_BOX)
    keep = set(range(100, 109))
    mask = np.zeros(s.cloud.n, dtype=bool)
    mask[list(keep)] = True
    s.selection = mask
    s.create_layer(s.clock.cloud, name="Kept")
    kept_id = s.layers[-1].id
    s.patch_layer(kept_id, protected=True)
    s.patch_layer(1, protected=True)
    s.set_protection(
        ProtectionState(
            global_=Interval(True, -0.1, 0.1),
            operation=OperationProtection("inherit"),
        )
    )
    s, _ = pick(mgr, ALL_BOX)
    assert set(s.candidate.result.ids.tolist()) == SCENE_GHOST - keep
    s.set_protection(
        ProtectionState(
            global_=Interval(True, -0.1, 0.1),
            operation=OperationProtection("override", (5.0, 6.0), True),
        )
    )
    s, _ = pick(mgr, ALL_BOX)
    # the floor layer is protected too, so nothing of it is deleted
    assert set(s.candidate.result.ids.tolist()) == SCENE_GHOST - keep
    s.patch_layer(1, protected=False)
    s, _ = pick(mgr, ALL_BOX)
    assert (
        set(s.candidate.result.ids.tolist())
        == (SCENE_GHOST | SCENE_FLOOR) - keep
    )


def test_lay_83_state_counts_protected_layer_points(mgr):
    s = mgr.require()
    before = s.state()
    assert before["counts"]["protected"] == 0
    s = protect_floor(mgr)
    assert s.state()["counts"]["protected"] == 100
    s.set_protection(ProtectionState(global_=Interval(True, 0.5, 1.5)))
    band = ids((s.xyz[:, 2] >= 0.5) & (s.xyz[:, 2] <= 1.5) & s.valid)
    assert s.state()["counts"]["protected"] == len(band | SCENE_FLOOR)


def test_lay_84_protected_layer_is_not_a_cluster_bridge(mgr):
    s = protect_floor(mgr)
    seed = 100  # ghost (2, 2, 1), one grid step above the floor
    s.selection = np.zeros(s.cloud.n, dtype=bool)
    job = wait(
        mgr.submit_select(
            SelectSpec("replace", "active", ClusterTool(seed, 1.0))
        )
    )
    assert job.status == "complete", job.error
    assert ids(s.selection) == SCENE_GHOST
    job = wait(
        mgr.submit_select(
            SelectSpec(
                "replace",
                "active",
                ClusterTool(seed, 1.0, exclude_protected=False),
            )
        )
    )
    assert job.status == "complete", job.error
    assert SCENE_FLOOR <= ids(s.selection)
    snap = {
        "scope": s._selectable() & s.valid,
        "protection": s.protection,
        "layer": s.layer,
        "layers": list(s.layers),
    }
    elig = s._tool_eligible(SparseSpec(None, 3, None, True), snap, None)
    assert not (ids(elig) & SCENE_FLOOR)
    elig = s._tool_eligible(SparseSpec(None, 3, None, False), snap, None)
    assert SCENE_FLOOR <= ids(elig)


def test_lay_85_render_flags_a_protected_layer_point_as_protected(mgr):
    s = protect_floor(mgr)
    s, _ = pick(mgr, ALL_BOX)
    arrays, _ = s.render(10**6, "edited")
    flags = dict(zip(arrays.ids.tolist(), arrays.flags.tolist()))
    for i in SCENE_FLOOR:
        assert flags[i] & FLAG_PROTECTED and not flags[i] & FLAG_SELECTED
    for i in SCENE_GHOST:
        assert flags[i] & FLAG_SELECTED and not flags[i] & FLAG_PROTECTED


def test_lay_86_cosmetic_edits_keep_the_flags(mgr):
    s = protect_floor(mgr)
    s.patch_layer(1, locked=True)
    s.patch_layer(1, visible=False)
    s.patch_layer(1, name="Ground")
    s.patch_layer(1, colour=3)
    s.set_layers_visibility(None, True)
    lay = s.layers[0]
    assert (lay.name, lay.colour, lay.visible) == ("Ground", 3, True)
    assert lay.protected and lay.locked


def test_lay_87_flag_changes_and_revisions(mgr):
    s = protect_floor(mgr)
    s.patch_layer(1, protected=False)
    s, _ = pick(mgr, ALL_BOX)
    params, rev = s.clock.params, s.layers_rev
    assert s.candidate is not None
    s.patch_layer(1, protected=True)
    assert s.clock.params > params
    assert s.candidate is None and s.pending is None
    params, rev = s.clock.params, s.layers_rev
    s.unsaved = False
    for kw in ({"locked": True}, {"name": "G"}, {"colour": 2}):
        s.patch_layer(1, **kw)
    assert s.clock.params == params
    assert s.layers_rev == rev + 3 and s.unsaved
    from gr_pcd.editing.errors import EditError

    with pytest.raises(EditError) as exc:
        s.patch_layer(1, protected=1)
    assert exc.value.code == "invalid_flag"


def test_lay_88_apply_never_deletes_the_protected_layer(mgr):
    s = protect_floor(mgr)
    s, job = pick(mgr, ALL_BOX)
    s.apply(job.result["candidate"]["candidate_id"], s.clock.cloud, None)
    assert ids(s.active) == SCENE_FLOOR | SCENE_INVALID
    s.undo(s.clock.cloud)
    assert ids(s.active) == set(range(s.cloud.n))
    assert s.layers[0].protected
