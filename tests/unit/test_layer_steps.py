"""LAY-100..112: layer edits are timeline steps (part 19, 19-3), no HTTP."""

import numpy as np
import pytest

from fixtures.pcdgen import SCENE_FLOOR, SCENE_GHOST
from fixtures.sessions import (
    delete_ghost,
    fixture_dir,
    make_settings,
    select_box,
    write_scene,
)
from gr_pcd.editing.errors import EditError
from gr_pcd.editing.history import MAX_SID
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.session.manager import SessionManager

FLOOR_BOX = BoxSpec(center=(4.5, 4.5, 0.0), dimensions=(11, 11, 0.5))
GHOST_BOX = BoxSpec(center=(3.0, 3.0, 2.0), dimensions=(2, 2, 2))


@pytest.fixture
def mgr(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    m = SessionManager(settings)
    m.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    yield m
    m.jobs.shutdown()


def pick(mgr, box, op="replace"):
    job = select_box(mgr, box, op=op)
    assert job.status == "complete", job.error
    return mgr.require()


def ids(mask):
    return set(np.flatnonzero(mask).tolist())


def members(s, k):
    return ids(s.layer == k) if s.layer is not None else set()


def floor(mgr, name="Floor", visible=True):
    s = pick(mgr, FLOOR_BOX)
    s.create_layer(s.clock.cloud, name=name, visible=visible)
    return s


def ghosts(mgr, name="Ghosts", visible=True):
    s = pick(mgr, GHOST_BOX)
    s.create_layer(s.clock.cloud, name=name, visible=visible)
    return s


def rev(s):
    return s.clock.cloud


def test_lay_100_create_pushes_one_layer_step(mgr):
    s = pick(mgr, FLOOR_BOX)
    cloud, params = s.clock.cloud, s.clock.params
    s.create_layer(cloud, name="Floor")
    assert len(s.history.entries) == 1 and s.history.cursor == 1
    e = s.history.entries[0]
    assert (e.kind, e.tool) == ("layer", "layer")
    assert set(e.ids.tolist()) == SCENE_FLOOR
    assert set(e.frm.tolist()) == {0} and set(e.to.tolist()) == {1}
    assert len(e.rows) == 1 and e.rows[0].created and e.rows[0].layer.id == 1
    assert s.clock.cloud == cloud and s.clock.params > params


def test_lay_100b_a_dry_run_pushes_nothing(mgr):
    s = pick(mgr, FLOOR_BOX)
    s.create_layer(rev(s), name="Floor", dry_run=True)
    assert s.history.entries == [] and s.history.cursor == 0
    s.create_layer(rev(s), name="Floor")
    ghosts(mgr)
    n = len(s.history.entries)
    pick(mgr, GHOST_BOX)
    s.assign_layer(rev(s), 1, dry_run=True)
    s.set_layer_members(rev(s), 1, dry_run=True)
    s.merge_layer(rev(s), 2, 1, dry_run=True)
    assert len(s.history.entries) == n and s.history.cursor == n


def test_lay_101_undo_of_a_create_and_redo(mgr):
    s = floor(mgr)
    s.undo(rev(s))
    assert s.layer is None and s.layers == []
    assert "layers" not in s.state()
    s.redo(rev(s))
    assert members(s, 1) == SCENE_FLOOR
    assert [(x.id, x.name) for x in s.layers] == [(1, "Floor")]


def test_lay_102_attributes_changed_after_a_create_survive_undo_redo(mgr):
    s = floor(mgr)
    s.patch_layer(1, name="Ground", colour=5, protected=True)
    s.undo(rev(s))
    assert s.layers == []
    s.redo(rev(s))
    (lay,) = s.layers
    assert (lay.name, lay.colour, lay.protected) == ("Ground", 5, True)


def test_lay_103_set_layer_to_selection_is_one_step(mgr):
    s = floor(mgr)
    pick(mgr, GHOST_BOX)
    before = members(s, 1)
    n = len(s.history.entries)
    s.set_layer_members(rev(s), 1)
    assert len(s.history.entries) == n + 1
    assert members(s, 1) == SCENE_GHOST
    s.undo(rev(s))
    assert members(s, 1) == before
    assert not (ids(s.layer != 0) & SCENE_GHOST)


def test_lay_104_merge_undo_restores_the_source_row_and_members(mgr):
    s = floor(mgr)
    pick(mgr, GHOST_BOX)
    s.create_layer(rev(s), name="Ghosts")
    delete_ghost(mgr)  # ghost points are deleted but keep their layer
    s.merge_layer(rev(s), 1, 2)
    assert [x.id for x in s.layers] == [2]
    assert members(s, 2) == SCENE_FLOOR | SCENE_GHOST
    s.undo(rev(s))
    assert [x.id for x in s.layers] == [1, 2]
    assert members(s, 1) == SCENE_FLOOR and members(s, 2) == SCENE_GHOST
    s.redo(rev(s))
    assert [x.id for x in s.layers] == [2]


def test_lay_105_to_main_of_the_last_layer_and_undo(mgr):
    s = floor(mgr)
    delete_ghost(mgr)
    s.delete_layer(rev(s), 1)
    assert s.layer is None and s.layers == []
    s.undo(rev(s))
    assert members(s, 1) == SCENE_FLOOR and [x.id for x in s.layers] == [1]
    s.redo(rev(s))
    assert s.layer is None


def test_lay_106_hide_selected_is_undone_without_touching_visibility(mgr):
    s = floor(mgr)
    pick(mgr, GHOST_BOX)
    s.create_layer(rev(s), name="Hidden", visible=False)
    assert not (ids(s.selection) & SCENE_GHOST)  # hidden points leave it
    s.set_layers_visibility([2], True)
    pick(mgr, GHOST_BOX)
    s.assign_layer(rev(s), 1)
    pick(mgr, GHOST_BOX)
    s.assign_layer(rev(s), 2, visible=False)
    assert members(s, 2) == SCENE_GHOST and not s.layers[1].visible
    s.undo(rev(s))
    assert members(s, 1) >= SCENE_GHOST  # back in its earlier layer
    assert s.layers[1].visible is False  # the flag is not part of the step
    drawn = set(s.render(10**6, "edited")[0].ids.tolist())
    assert SCENE_GHOST <= drawn


def test_lay_107_settings_are_not_steps(mgr):
    s = floor(mgr)
    ghosts(mgr)
    n = len(s.history.entries)
    s.patch_layer(1, name="A", colour=3, visible=False, protected=True)
    s.patch_layer(1, locked=True)
    s.patch_layer(1, locked=False)
    s.set_layer_order([2, 1])
    s.set_layers_visibility(None, True)
    assert len(s.history.entries) == n and s.history.cursor == n
    # an assign that changes nothing pushes nothing either
    pick(mgr, GHOST_BOX)
    s.assign_layer(rev(s), 2)
    assert len(s.history.entries) == n


def test_lay_108_a_layer_edit_while_rolled_back_drops_the_greyed_tail(mgr):
    s = floor(mgr)
    delete_ghost(mgr)
    ghosts_sel = pick(mgr, FLOOR_BOX)
    ghosts_sel.assign_layer(rev(s), 0)
    assert len(s.history.entries) == 3
    s.rollback(rev(s), 1)
    pick(mgr, GHOST_BOX)
    s.create_layer(rev(s), name="G")
    assert [e.kind for e in s.history.entries] == ["layer", "layer"]
    assert s.history.cursor == 2


def test_lay_109_delete_step_on_layer_steps(mgr):
    s = floor(mgr)
    ghosts(mgr)
    sids = [e.sid for e in s.history.entries]
    s.delete_step(rev(s), sids[0])  # independent: reverted and removed
    assert members(s, 1) == set() and [x.id for x in s.layers] == [2]
    assert [e.sid for e in s.history.entries] == [sids[1]]
    # a dependent one is refused and nothing changes
    pick(mgr, GHOST_BOX)
    s.assign_layer(rev(s), 0)
    first = s.history.entries[0].sid
    snap = (s.layer.copy(), list(s.layers), len(s.history.entries))
    with pytest.raises(EditError) as err:
        s.delete_step(rev(s), first)
    assert err.value.code == "step_has_dependents"
    assert np.array_equal(s.layer, snap[0])
    assert s.layers == snap[1] and len(s.history.entries) == snap[2]


def test_lay_109b_a_greyed_layer_step_is_removed_without_a_revert(mgr):
    s = floor(mgr)
    ghosts(mgr)
    s.undo(rev(s))
    greyed = s.history.entries[-1].sid
    before = (s.layer.copy(), list(s.layers))
    s.delete_step(rev(s), greyed)
    assert np.array_equal(s.layer, before[0]) and s.layers == before[1]
    assert [e.kind for e in s.history.entries] == ["layer"]


def test_lay_110_a_refused_push_changes_nothing(mgr):
    s = pick(mgr, FLOOR_BOX)
    s.history.next_sid = MAX_SID  # push refuses: no sid left
    sel = s.selection.copy()
    with pytest.raises(EditError):
        s.create_layer(rev(s), name="Floor")
    assert s.layer is None and s.layers == [] and s.history.entries == []
    assert np.array_equal(s.selection, sel)


def test_lay_111_state_rows_carry_the_layer_step_keys(mgr):
    s = floor(mgr)
    delete_ghost(mgr)
    rows = s.state()["history"]["entries"]
    layer_row, delete_row = rows
    assert layer_row["kind"] == "layer" and layer_row["tool"] == "layer"
    assert layer_row["count"] == 100 and layer_row["deletable"] is True
    assert layer_row["bounds"] is not None
    assert "deletable" not in delete_row
    assert set(delete_row) == {
        "sid", "index", "kind", "tool", "description", "name", "count", "shape",
        "bounds",
    }  # fmt: skip


def test_lay_112_undo_ignores_a_lock_but_a_new_assign_does_not(mgr):
    s = floor(mgr)
    s.patch_layer(1, locked=True)
    s.undo(rev(s))
    assert s.layers == [] and s.layer is None
    s.redo(rev(s))
    assert [x.locked for x in s.layers] == [True]
    s.rollback(rev(s), 0)
    s.rollback(rev(s), 1)
    pick(mgr, GHOST_BOX)
    with pytest.raises(EditError) as err:
        s.assign_layer(rev(s), 1)
    assert err.value.code == "layer_locked"
