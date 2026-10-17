"""HST-12..19: engine rollback, step deletion, rename, step render."""

import numpy as np
import pytest

from fixtures.pcdgen import SCENE_GHOST
from fixtures.sessions import (
    fixture_dir,
    make_settings,
    select_box,
    wait,
    write_scene,
)
from gr_pcd.editing.cancel import CancelToken
from gr_pcd.editing.errors import EditError
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.geometry.filters import AxisRange, DisplayFilter
from gr_pcd.geometry.prism import PrismSpec
from gr_pcd.session.codec import ClusterTool, FilterTool
from gr_pcd.session.engine import SelectSpec
from gr_pcd.session.errors import StaleRevision
from gr_pcd.session.jobs import Stale
from gr_pcd.session.manager import SessionManager

CORNER = {0, 1, 10, 11}
MIDDLE = {55, 56, 65, 66}
CORNER_BOX = BoxSpec(center=(0.5, 0.5, 0.0), dimensions=(1, 1, 0.5))
MIDDLE_BOX = BoxSpec(center=(5.5, 5.5, 0.0), dimensions=(1, 1, 0.5))
GHOST_BOX = BoxSpec(center=(3.0, 3.0, 2.0), dimensions=(2, 2, 2))


@pytest.fixture
def mgr(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    m = SessionManager(settings)
    m.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    yield m
    m.jobs.shutdown()


def apply_spec(mgr, spec):
    job = wait(mgr.submit_select(spec))
    assert job.status == "complete", job.error
    s = mgr.require()
    s.apply(job.result["candidate"]["candidate_id"], s.clock.cloud, None)
    return s


def del_box(mgr, box):
    return apply_spec(mgr, SelectSpec("replace", "active", box))


def gone(s):
    return set(np.flatnonzero(~s.active).tolist())


def three(mgr):
    s = del_box(mgr, CORNER_BOX)
    del_box(mgr, GHOST_BOX)
    del_box(mgr, MIDDLE_BOX)
    return s


def test_hst_12_rollback_back_and_forward(mgr):
    s = three(mgr)
    full = gone(s)
    assert full == CORNER | SCENE_GHOST | MIDDLE
    rev = s.clock.cloud
    s.rollback(rev, 1)
    assert gone(s) == CORNER
    assert s.clock.cloud == rev + 1 and s.candidate is None
    c = s.state()["counts"]
    assert c["deleted"] == 4 and c["active"] == 125
    s.rollback(s.clock.cloud, 0)
    assert gone(s) == set()
    s.rollback(s.clock.cloud, 3)
    assert gone(s) == full
    with pytest.raises(EditError):
        s.rollback(s.clock.cloud, 9)
    with pytest.raises(StaleRevision):
        s.rollback(1, 0)


def test_hst_13_delete_middle_step_keeps_later_steps(mgr):
    s = three(mgr)
    sid = s.history.entries[1].sid
    s.delete_step(s.clock.cloud, sid)
    assert gone(s) == CORNER | MIDDLE
    assert s.history.cursor == 2
    assert len(s.history.entries) == 2
    applied = set().union(*(set(e.ids.tolist()) for e in s.history.entries))
    assert gone(s) == applied


def test_hst_14_delete_greyed_step_then_redo_to_end(mgr):
    s = three(mgr)
    s.rollback(s.clock.cloud, 1)
    sid = s.history.entries[1].sid  # greyed ghost step
    s.delete_step(s.clock.cloud, sid)
    assert s.history.cursor == 1 and gone(s) == CORNER
    s.redo(s.clock.cloud)
    assert gone(s) == CORNER | MIDDLE
    assert not s.history.can_redo


def test_hst_15_rename_changes_no_cloud_state(mgr):
    s = three(mgr)
    select_box(mgr, GHOST_BOX)
    cand = s.candidate
    rev, edits = s.revision(), s.edit_counter
    s.mark_saved(edits)
    assert s.unsaved is False
    s.rename_step(s.history.entries[0].sid, "my cut")
    assert s.revision() == rev and s.candidate is cand
    assert s.unsaved is True and s.edit_counter == edits + 1
    assert s.state()["history"]["entries"][0]["name"] == "my cut"
    with pytest.raises(EditError):
        s.rename_step(s.history.entries[0].sid, "a\nb")


def test_hst_16_tool_recorded_per_apply(mgr):
    s = mgr.require()
    del_box(mgr, CORNER_BOX)
    square = PrismSpec(
        polygon=((5.0, 5.0), (6.0, 5.0), (6.0, 6.0), (5.0, 6.0)),
        z_min=-1.0,
        z_max=1.0,
    )
    apply_spec(mgr, SelectSpec("replace", "active", square))
    apply_spec(mgr, SelectSpec("replace", "active", ClusterTool(100, 0.5)))
    s.set_display_filter(DisplayFilter(z=AxisRange(True, -1.0, 0.5)))
    apply_spec(mgr, SelectSpec("replace", "displayed", FilterTool()))
    s.remove_invalid(s.clock.cloud)
    assert [e.tool for e in s.history.entries] == [
        "box",
        "polygon",
        "cluster",
        "filter",
        "invalid",
    ]


def test_hst_17_running_candidate_job_goes_stale_after_rollback(mgr):
    s = three(mgr)
    job = wait(mgr.submit_select(SelectSpec("replace", "active", GHOST_BOX)))
    ticket = s.clock.ticket()
    s.rollback(s.clock.cloud, 0)
    assert job.status == "complete"
    with pytest.raises(Stale):
        s.run_candidate(ticket, CancelToken())


def step_render(s, sid, budget=1000):
    arr, _ = s.render(budget, "step", step=sid)
    return arr


def test_hst_18_step_render_is_exactly_the_step(mgr):
    s = three(mgr)
    e = s.history.entries[1]
    arr = step_render(s, e.sid)
    assert sorted(arr.ids.tolist()) == sorted(SCENE_GHOST)
    assert arr.eligible == len(e.ids) == 27
    assert not arr.flags.any()
    # greyed step is drawn too
    s.rollback(s.clock.cloud, 0)
    assert sorted(step_render(s, e.sid).ids.tolist()) == sorted(SCENE_GHOST)
    # display filter hides points: eligible drops
    s.set_display_filter(DisplayFilter(z=AxisRange(True, 2.0, 5.0)))
    hidden = step_render(s, e.sid)
    assert 0 < hidden.eligible < 27
    # budget sampling keeps eligible exact
    s.set_display_filter(DisplayFilter())
    small = step_render(s, e.sid, budget=5)
    assert small.eligible == 27 and len(small.ids) == 5
    assert set(small.ids.tolist()) <= SCENE_GHOST
    with pytest.raises(EditError) as exc:
        s.render(10, "step", step=None)
    assert exc.value.code == "invalid_step"
    with pytest.raises(EditError) as exc:
        s.render(10, "step", step=9999)
    assert exc.value.code == "no_such_step"


def test_hst_18b_invalid_points_excluded_from_step_render(mgr):
    s = mgr.require()
    s.remove_invalid(s.clock.cloud)
    arr = step_render(s, s.history.entries[0].sid)
    assert arr.eligible == 0 and len(arr.ids) == 0


def test_hst_19_state_entries_carry_sid_tool_name(mgr):
    s = three(mgr)
    entry = s.state()["history"]["entries"][0]
    assert set(entry) == {
        "index",
        "sid",
        "kind",
        "tool",
        "name",
        "description",
        "count",
    }
    assert entry["sid"] == 0 and entry["tool"] == "box"
    assert entry["name"] is None and entry["count"] == 4


def test_hst_19b_unknown_step_error_type(mgr):
    s = three(mgr)
    with pytest.raises(EditError):
        s.delete_step(s.clock.cloud, 77)
