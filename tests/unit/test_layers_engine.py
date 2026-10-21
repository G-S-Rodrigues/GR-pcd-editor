"""LAY-09..19: layers inside the editing session (part 15b-2), no HTTP."""

import numpy as np
import pytest

from fixtures.pcdgen import SCENE_FLOOR, SCENE_GHOST
from fixtures.sessions import (
    fixture_dir,
    make_settings,
    select_box,
    wait,
    write_scene,
)
from gr_pcd.editing.errors import EditError
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.geometry.filters import AxisRange, DisplayFilter
from gr_pcd.session.codec import FilterTool, LayerTool, shape_of, tool_summary
from gr_pcd.session.engine import SelectSpec, _step_tool
from gr_pcd.session.errors import NotFoundError, StaleRevision
from gr_pcd.session.manager import SessionManager

FLOOR_BOX = BoxSpec(center=(4.5, 4.5, 0.0), dimensions=(11, 11, 0.5))
GHOST_BOX = BoxSpec(center=(3.0, 3.0, 2.0), dimensions=(2, 2, 2))
CORNER_BOX = BoxSpec(center=(0.5, 0.5, 0.0), dimensions=(1, 1, 0.5))


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


def layer_ids(s, k):
    return ids(s.layer == k) if s.layer is not None else set()


def drawn(s, mode="edited", budget=10**6):
    arrays, _ = s.render(budget, mode)
    return set(arrays.ids.tolist()), arrays


def make_floor_layer(mgr, name="Floor", visible=True):
    s = pick(mgr, FLOOR_BOX)
    s.create_layer(s.clock.cloud, name=name, visible=visible)
    return s


def test_lay_09_a_fresh_session_has_no_layer_array(mgr):
    s = mgr.require()
    assert s.layer is None and s.layers == []
    st = s.state()
    # a layer-less session sends exactly the keys it always sent
    assert "layers" not in st
    assert "main" not in st["counts"] and "hidden" not in st["counts"]
    assert s._selectable() is s.active


def test_lay_10_create_moves_the_selection_and_changes_no_revision(mgr):
    s = pick(mgr, FLOOR_BOX)
    assert ids(s.selection) == SCENE_FLOOR
    cloud, params = s.clock.cloud, s.clock.params
    entries = len(s.history.entries)
    s.candidate = object()  # any live candidate must be dropped
    out = s.create_layer(cloud, name="  Floor ")
    assert out == {"moved": 100, "from_other_layers": 0, "released": 0}
    assert layer_ids(s, 1) == SCENE_FLOOR
    assert [(x.id, x.name, x.colour, x.visible) for x in s.layers] == [
        (1, "Floor", 0, True)
    ]
    assert s.clock.cloud == cloud and s.clock.params > params
    # Part 19: a layer edit is one timeline step (the revision stays)
    assert len(s.history.entries) == entries + 1
    step = s.history.entries[-1]
    assert (step.kind, step.tool) == ("layer", "layer")
    assert set(step.ids.tolist()) == SCENE_FLOOR
    assert s.candidate is None and s.pending is None
    assert s.unsaved and s.layers_rev == 1
    assert ids(s.selection) == SCENE_FLOOR  # D3: the selection is kept
    assert s.layer.flags.writeable is False


def test_lay_10b_default_name_ids_colours_and_dry_run(mgr):
    s = pick(mgr, FLOOR_BOX)
    before = s.layers_rev
    assert s.create_layer(s.clock.cloud, dry_run=True)["moved"] == 100
    assert s.layer is None and s.layers == [] and s.layers_rev == before
    s.create_layer(s.clock.cloud)
    assert s.layers[0].name == "Layer 1"
    pick(mgr, GHOST_BOX)
    out = s.create_layer(s.clock.cloud)
    assert (
        out["moved"] == 27 and s.layers[1].id == 2 and s.layers[1].colour == 1
    )
    assert layer_ids(s, 2) == SCENE_GHOST


def test_lay_10c_errors(mgr):
    s = mgr.require()
    with pytest.raises(EditError) as err:
        s.create_layer(s.clock.cloud)
    assert err.value.code == "empty_selection"
    pick(mgr, FLOOR_BOX)
    with pytest.raises(StaleRevision):
        s.create_layer(s.clock.cloud + 1)
    with pytest.raises(EditError) as err:
        s.create_layer(s.clock.cloud, name="   ")
    assert err.value.code == "invalid_name"
    assert s.layer is None  # a refused call changed nothing


def test_lay_10d_the_33rd_layer_is_refused(mgr):
    s = mgr.require()
    for k in range(32):
        s.selection = np.eye(1, s.cloud.n, k, dtype=bool)[0]
        s.create_layer(s.clock.cloud, name=f"l{k}")
    s.selection = np.eye(1, s.cloud.n, 40, dtype=bool)[0]
    with pytest.raises(EditError) as err:
        s.create_layer(s.clock.cloud)
    assert err.value.code == "too_many_layers"


def test_lay_10e_assign_release_set_members_and_delete(mgr):
    s = make_floor_layer(mgr)
    pick(mgr, CORNER_BOX)  # ids 0, 1, 10, 11 in the floor layer
    s.create_layer(s.clock.cloud, name="Corner")
    assert layer_ids(s, 2) == {0, 1, 10, 11}
    assert layer_ids(s, 1) == SCENE_FLOOR - {0, 1, 10, 11}
    # steal confirmation numbers
    pick(mgr, FLOOR_BOX)
    dry = s.assign_layer(s.clock.cloud, 2, dry_run=True)
    assert dry == {"moved": 100, "from_other_layers": 96, "released": 0}
    assert layer_ids(s, 1) == SCENE_FLOOR - {0, 1, 10, 11}
    # release to main
    pick(mgr, CORNER_BOX)
    assert s.assign_layer(s.clock.cloud, 0)["released"] == 4
    assert layer_ids(s, 2) == set() and layer_ids(s, 1) == SCENE_FLOOR - {
        0,
        1,
        10,
        11,
    }
    # set-members: members not selected go to main
    pick(mgr, GHOST_BOX)
    s.assign_layer(s.clock.cloud, 2)
    pick(mgr, BoxSpec(center=(3.0, 3.0, 1.0), dimensions=(2, 2, 0.5)))
    kept = ids(s.selection)
    out = s.set_layer_members(s.clock.cloud, 2)
    assert layer_ids(s, 2) == kept
    assert out["released"] == 27 - len(kept)
    # delete returns the members to main
    s.delete_layer(s.clock.cloud, 2)
    assert [x.id for x in s.layers] == [1]
    assert layer_ids(s, 2) == set() and not (s.layer == 2).any()
    s.delete_layer(s.clock.cloud, 1)
    assert s.layer is None and s.layers == []


def test_lay_10f_unknown_layer_and_hidden_set_members(mgr):
    s = make_floor_layer(mgr)
    for call in (
        lambda: s.assign_layer(s.clock.cloud, 9),
        lambda: s.set_layer_members(s.clock.cloud, 9),
        lambda: s.delete_layer(s.clock.cloud, 9),
        lambda: s.patch_layer(9, name="x"),
        lambda: s.set_layers_visibility([1, 9], False),
    ):
        with pytest.raises(NotFoundError) as err:
            call()
        assert err.value.code == "no_such_layer"
    s.patch_layer(1, visible=False)
    pick(mgr, GHOST_BOX)
    with pytest.raises(EditError) as err:
        s.set_layer_members(s.clock.cloud, 1)
    assert err.value.code == "layer_hidden"


def test_lay_10g_patch_name_colour_visibility(mgr):
    s = make_floor_layer(mgr)
    params = s.clock.params
    s.patch_layer(1, name="Boden", colour=7)
    assert (s.layers[0].name, s.layers[0].colour) == ("Boden", 7)
    assert (
        s.clock.params == params
    )  # cosmetic: no selection or candidate change
    for bad in (16, -1, 1.5, "a"):
        with pytest.raises(EditError) as err:
            s.patch_layer(1, colour=bad)
        assert err.value.code == "invalid_colour"
    with pytest.raises(EditError):
        s.patch_layer(1, name="x" * 41)
    s.patch_layer(1, visible=False)
    assert not s.layers[0].visible and s.clock.params > params
    rev = s.layers_rev
    s.set_layers_visibility(None, False)  # nothing changes: no bump
    assert s.layers_rev == rev
    s.set_layers_visibility(None, True)
    assert s.layers[0].visible


def test_lay_10h_hiding_strips_the_selection_and_the_stale_state(mgr):
    s = make_floor_layer(mgr)
    pick(mgr, FLOOR_BOX, op="add")
    pick(mgr, GHOST_BOX, op="add")
    sel_id = s.selection_id
    s.patch_layer(1, visible=False)
    assert ids(s.selection) == SCENE_GHOST and s.selection_id > sel_id
    assert s.selection_ops  # a non-empty selection keeps its log
    s.patch_layer(1, visible=True)
    pick(mgr, FLOOR_BOX)
    s.patch_layer(1, visible=False)
    assert not s.selection.any()
    assert s.selection_ops == [] and s._selection_scope is None
    assert s.state()["selection"]["count"] == 0


def test_lay_11_render_omits_hidden_points_per_mode(mgr):
    s = make_floor_layer(mgr, visible=False)
    valid_active = ids(s.active & s.valid)
    got, _ = drawn(s)
    assert got == valid_active - SCENE_FLOOR
    # original: hidden points that are still active are not drawn either
    got, _ = drawn(s, "original")
    assert got == ids(s.valid) - SCENE_FLOOR
    # delete the ghosts (they are in no layer), hide the floor again
    s.patch_layer(1, visible=True)
    job = select_box(mgr, GHOST_BOX)
    s.apply(job.result["candidate"]["candidate_id"], s.clock.cloud, None)
    s.patch_layer(1, visible=False)
    assert drawn(s, "deleted")[0] == SCENE_GHOST
    got, _ = drawn(s, "original")
    assert got == ids(s.valid) - SCENE_FLOOR  # ghosts (deleted) stay drawn
    # the floor layer's create is step 0 now; the ghost deletion is the last
    sid = s.history.entries[-1].sid
    assert s.history.entries[-1].kind == "delete"
    arrays, _ = s.render(10**6, "step", step=sid)
    assert set(arrays.ids.tolist()) == SCENE_GHOST


def test_lay_12_eligible_counts_only_drawn_candidates(mgr):
    s = make_floor_layer(mgr, visible=False)
    arrays, _ = s.render(20, "edited")
    n_valid = len(ids(s.active & s.valid)) - 100
    assert arrays.eligible == n_valid
    assert len(arrays.ids) <= 20 + 20 // 2
    assert not (set(arrays.ids.tolist()) & SCENE_FLOOR)


def test_lay_13_a_layer_less_render_equals_a_deleted_layer_render(mgr):
    s = mgr.require()
    base, _ = s.render(10**6, "edited")
    assert base.ids.tolist() == sorted(ids(s.active & s.valid))
    pick(mgr, FLOOR_BOX)
    s.create_layer(s.clock.cloud)
    s.delete_layer(s.clock.cloud, 1)
    s.selection = np.zeros(s.cloud.n, dtype=bool)
    after, _ = s.render(10**6, "edited")
    assert s.layer is None
    for name in ("coords", "ids", "flags"):
        assert getattr(after, name).tobytes() == getattr(base, name).tobytes()
    assert after.eligible == base.eligible and after.origin == base.origin


def test_lay_14_selectable_is_cached_and_free_when_nothing_is_hidden(mgr):
    s = make_floor_layer(mgr)
    assert s._selectable() is s.active
    s.patch_layer(1, visible=False)
    first = s._selectable()
    assert first is not s.active and ids(first) == ids(s.active) - SCENE_FLOOR
    assert s._selectable() is first
    s.patch_layer(1, visible=True)
    assert s._selectable() is s.active


def test_lay_15_the_layer_tool(mgr):
    s = make_floor_layer(mgr)
    pick(mgr, GHOST_BOX)
    s.create_layer(s.clock.cloud, name="Ghost")
    job = wait(mgr.submit_select(SelectSpec("replace", "active", LayerTool(2))))
    assert job.status == "complete", job.error
    assert ids(s.selection) == SCENE_GHOST
    assert s.selection_ops[-1]["tool"] == {"type": "layer", "layer_id": 2}
    assert shape_of(LayerTool(2)) is None
    assert tool_summary(LayerTool(2)) == {"type": "layer", "layer_id": 2}
    assert s._last_tool_text == "layer" and _step_tool("layer") == "selection"
    assert s._last_tool_shape is None
    # a missing and a hidden layer fail with their own code
    for lid, code in ((9, "no_such_layer"), (2, "layer_hidden")):
        if lid == 2:
            s.patch_layer(2, visible=False)
        spec = SelectSpec("replace", "active", LayerTool(lid))
        job = wait(mgr.submit_select(spec))
        assert job.status == "failed" and job.error["code"] == code


def test_lay_16_every_selection_path_excludes_hidden_points(mgr):
    s = make_floor_layer(mgr, visible=False)
    big = BoxSpec(center=(4.5, 4.5, 1.0), dimensions=(20, 20, 20))
    pick(mgr, big)
    assert ids(s.selection) == SCENE_GHOST  # floor and invalid are not picked
    wait(mgr.submit_select(SelectSpec("replace", "displayed", FilterTool())))
    assert ids(s.selection) == SCENE_GHOST
    pick(mgr, BoxSpec(center=(3.0, 3.0, 1.0), dimensions=(2, 2, 0.5)))
    nine = ids(s.selection)
    assert len(nine) == 9
    job = wait(mgr.submit_select(SelectSpec("invert", "active")))
    assert job.status == "complete"
    assert ids(s.selection) == SCENE_GHOST - nine  # not the hidden floor
    s.patch_layer(1, visible=True)
    s.selection = np.ones(s.cloud.n, dtype=bool)  # even a forced selection
    s.patch_layer(1, visible=False)  # is cleaned by the next layer change
    assert not (ids(s.selection) & SCENE_FLOOR)


def test_lay_16b_apply_never_deletes_a_hidden_point(mgr):
    s = make_floor_layer(mgr)
    pick(mgr, FLOOR_BOX)
    s.patch_layer(1, visible=False)
    assert s.candidate is None
    job = select_box(mgr, FLOOR_BOX)
    assert job.result["candidate"]["candidates"] == 0
    assert job.result["candidate"]["selected_active"] == 0
    assert ids(s.active) == set(range(s.cloud.n))


def test_lay_17_state_layers_counts_and_bounds(mgr):
    s = make_floor_layer(mgr)
    st = s.state()
    assert st["layers"] == [
        {
            "id": 1,
            "name": "Floor",
            "colour": 0,
            "visible": True,
            "protected": False,
            "locked": False,
            "count": 100,
            "bounds": {"min": [0.0, 0.0, 0.0], "max": [9.0, 9.0, 0.0]},
        }
    ]
    assert st["counts"]["main"] == 27 and st["counts"]["hidden"] == 0
    # deleted points belong to no layer in anything reported
    job = select_box(mgr, CORNER_BOX)
    s.apply(job.result["candidate"]["candidate_id"], s.clock.cloud, None)
    st = s.state()
    assert st["layers"][0]["count"] == 96
    assert layer_ids(s, 1) == SCENE_FLOOR  # but the stored ids are kept
    s.undo(s.clock.cloud)
    assert s.state()["layers"][0]["count"] == 100
    s.patch_layer(1, visible=False)
    st = s.state()
    assert st["counts"]["hidden"] == 100 and st["counts"]["main"] == 27
    # the bounds ignore the visibility
    assert st["layers"][0]["bounds"]["max"] == [9.0, 9.0, 0.0]


def test_lay_18_export_mask_by_layer(mgr):
    s = make_floor_layer(mgr, visible=False)
    all_active = ids(s.export_mask("active"))
    assert ids(s.export_mask("active", None)) == all_active
    assert ids(s.export_mask("active", [0, 1])) == all_active
    assert (
        ids(s.export_mask("active", [1])) == SCENE_FLOOR
    )  # hidden: still exported
    main = ids(s.export_mask("active", [0]))
    assert main == all_active - SCENE_FLOOR
    s.patch_layer(1, visible=True)
    pick(mgr, GHOST_BOX)
    assert ids(s.export_mask("selected", [0])) == SCENE_GHOST
    assert ids(s.export_mask("selected", [1])) == set()
    for bad, code in (([9], "unknown_layer"), ([], "no_layers_chosen")):
        with pytest.raises(EditError) as err:
            s.export_mask("active", bad)
        assert err.value.code == code


def test_lay_19_restore_copies_layers_and_resets_the_layer_clock(mgr):
    from types import SimpleNamespace

    from gr_pcd.editing.layers import Layer

    s = mgr.require()
    layer = np.zeros(s.cloud.n, dtype=np.uint8)
    layer[:10] = 4
    layer.flags.writeable = False
    loaded = SimpleNamespace(
        active=s.active,
        selection=np.ones(s.cloud.n, dtype=bool),
        ops=[],
        display_filter=s.display_filter,
        protection=s.protection,
        entries=[],
        cursor=0,
        next_sid=0,
        client_state={},
        unit="m",
        layer=layer,
        layers=[Layer(4, "Back", 3, False)],
    )
    s.layers_rev = 5
    s.restore(loaded)
    assert s.layers == [Layer(4, "Back", 3, False)] and s.layer is layer
    assert s.layers_rev == 0
    assert not (ids(s.selection) & set(range(10)))  # hidden points not selected
    assert drawn(s)[0] == ids(s.valid) - set(range(10))


def test_lay_19b_nearest_ignores_hidden_points(mgr):
    s = make_floor_layer(mgr)
    assert s.nearest((0.0, 0.0, 0.0), 0.1)["id"] == 0
    s.patch_layer(1, visible=False)
    assert s.nearest((0.0, 0.0, 0.0), 0.1)["id"] is None
    s.patch_layer(1, visible=True)
    assert s.nearest((0.0, 0.0, 0.0), 0.1)["id"] == 0


def test_lay_19c_select_displayed_respects_the_display_filter_and_layers(mgr):
    s = make_floor_layer(mgr, visible=False)
    s.set_display_filter(DisplayFilter(z=AxisRange(True, -1.0, 0.5)))
    job = wait(
        mgr.submit_select(SelectSpec("replace", "displayed", FilterTool()))
    )
    assert job.status == "complete"
    assert not s.selection.any()
