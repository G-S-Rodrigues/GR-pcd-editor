"""SES-01..14, 28..30: session engine and manager."""

import dataclasses
import hashlib

import numpy as np
import pytest

from fixtures.pcdgen import (
    SCENE_FLOOR,
    SCENE_GHOST,
    SCENE_INVALID,
    scene_rows,
)
from fixtures.sessions import (
    box_all_ghost,
    delete_ghost,
    fixture_dir,
    make_settings,
    select_box,
    wait,
    write_scene,
)
from gr_pcd.editing.errors import EditError
from gr_pcd.editing.protection import (
    Interval,
    OperationProtection,
    ProtectionState,
)
from gr_pcd.geometry.filters import AxisRange, DisplayFilter
from gr_pcd.pcd.errors import PcdError
from gr_pcd.session.codec import FilterTool
from gr_pcd.session.engine import SelectSpec
from gr_pcd.session.errors import StaleRevision
from gr_pcd.session.manager import SessionManager


@pytest.fixture
def mgr(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    m = SessionManager(settings)
    m.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    yield m
    m.jobs.shutdown()


def deleted(session):
    return set(np.flatnonzero(~session.active).tolist())


def test_ses_01_open_state(mgr):
    st = mgr.require().state()
    c = st["counts"]
    assert c["original"] == 129 and c["active"] == 129 and c["deleted"] == 0
    assert c["invalid_total"] == 2 and c["invalid_active"] == 2
    assert st["bounds"] == {"min": [0.0, 0.0, 0.0], "max": [9.0, 9.0, 3.0]}
    assert st["filename"] == "scene.pcd" and st["encoding"] == "binary"
    assert [f["name"] for f in st["schema"]] == ["x", "y", "z", "intensity"]
    assert st["revision"] == {"cloud": 1, "params": 1}
    assert st["unsaved"] is False


def test_ses_02_source_records_immutable(mgr):
    s = mgr.require()
    before = hashlib.sha256(s.cloud.records.tobytes()).hexdigest()
    delete_ghost(mgr)
    s.undo(s.clock.cloud)
    assert hashlib.sha256(s.cloud.records.tobytes()).hexdigest() == before
    with pytest.raises(ValueError):
        s.cloud.records["c0"][0] = 5.0
    with pytest.raises(ValueError):
        s.active[0] = False


def test_ses_03_box_delete_exact(mgr):
    s = delete_ghost(mgr)
    assert deleted(s) == SCENE_GHOST
    assert s.state()["counts"]["active"] == 129 - 27
    assert SCENE_FLOOR.isdisjoint(deleted(s))


def test_ses_04_global_protection(mgr):
    s = mgr.require()
    s.set_protection(ProtectionState(Interval(True, 0.5, 1.5)))
    job = select_box(mgr, box_all_ghost())
    cand = job.result["candidate"]
    # ghost z=1 layer (9 points) is protected
    assert cand["protected_retained"] == 9 and cand["candidates"] == 18
    s.apply(cand["candidate_id"], s.clock.cloud, None)
    survivors = {i for i in SCENE_GHOST if s.active[i]}
    assert survivors == {i for i in SCENE_GHOST if scene_rows()[i][2] == 1.0}


def test_ses_05_deleted_not_reselectable_invert_active_scope(mgr):
    s = delete_ghost(mgr)
    job = select_box(mgr, box_all_ghost())
    assert job.result["selected"] == 0
    job = wait(mgr.submit_select(SelectSpec("invert", "active", None)))
    assert job.status == "complete"
    assert job.result["selected"] == 100  # floor only; invalid never scoped
    assert not s.selection[list(SCENE_GHOST)].any()


def test_ses_06_candidate_stale_after_each_change(mgr):
    s = mgr.require()

    def fresh():
        job = select_box(mgr, box_all_ghost())
        return job.result["candidate"]["candidate_id"]

    cid = fresh()
    s.set_display_filter(DisplayFilter(z=AxisRange(True, -1.0, 9.0)))
    with pytest.raises(StaleRevision):
        s.apply(cid, s.clock.cloud, None)
    cid = fresh()
    s.set_protection(ProtectionState(Interval(True, 0.0, 0.0)))
    with pytest.raises(StaleRevision):
        s.apply(cid, s.clock.cloud, None)
    cid = fresh()
    select_box(mgr, box_all_ghost(), op="subtract")
    with pytest.raises(StaleRevision):
        s.apply(cid, s.clock.cloud, None)
    s.set_protection(ProtectionState())
    cid = fresh()
    s.apply(cid, s.clock.cloud, None)
    with pytest.raises(StaleRevision):
        s.apply(cid, s.clock.cloud, None)
    s.undo(s.clock.cloud)
    with pytest.raises(StaleRevision):
        s.apply(cid, s.clock.cloud, None)
    with pytest.raises(StaleRevision):
        s.undo(1)  # obsolete cloud revision


def test_ses_07_stale_select_job_changes_nothing(mgr):
    s = mgr.require()
    from gr_pcd.editing.cancel import CancelToken
    from gr_pcd.session.jobs import Stale

    ticket = s.clock.ticket()
    s.remove_invalid(s.clock.cloud)  # cloud revision bump
    with pytest.raises(Stale):
        s.run_select(
            SelectSpec("replace", "active", box_all_ghost()),
            ticket,
            CancelToken(),
        )
    assert not s.selection.any()


def test_ses_08_apply_resets(mgr):
    s = mgr.require()
    s.set_protection(
        ProtectionState(
            Interval(), OperationProtection("add_local", (100.0, 101.0))
        )
    )
    job = select_box(mgr, box_all_ghost())
    rev = s.revision()
    s.apply(job.result["candidate"]["candidate_id"], rev["cloud"], None)
    st = s.state()
    assert st["protection"]["operation"]["mode"] == "inherit"
    assert not s.selection.any()
    assert st["revision"]["cloud"] == rev["cloud"] + 1
    assert st["revision"]["params"] > rev["params"]
    assert st["history"]["entries"][0]["description"] == (
        "Deleted 27 points (box)"
    )
    assert st["history"]["cursor"] == 1


def test_ses_09_render_budget_and_flags(mgr):
    s = mgr.require()
    select_box(mgr, box_all_ghost())
    sel_before = s.selection.copy()
    arr, _ = s.render(10, "edited")
    assert (
        len(arr.ids) <= 10 + 10 // 2 and arr.eligible == 127
    )  # flagged extras up to budget // 2 (decision 8)
    arr_all, _ = s.render(1000, "edited")
    assert len(arr_all.ids) == 127
    assert (s.selection == sel_before).all()
    flags = dict(zip(arr_all.ids.tolist(), arr_all.flags.tolist()))
    assert all(flags[i] == 1 for i in SCENE_GHOST)
    assert all(flags[i] == 0 for i in SCENE_FLOOR)
    s.set_protection(ProtectionState(Interval(True, 0.5, 1.5)))
    arr_all, _ = s.render(1000, "edited")
    flags = dict(zip(arr_all.ids.tolist(), arr_all.flags.tolist()))
    assert flags[100] == 2 and flags[101] == 1  # z=1 protected, z=2 plain


def test_ses_10_render_modes(mgr):
    s = delete_ghost(mgr)
    ed, _ = s.render(1000, "edited")
    og, _ = s.render(1000, "original")
    dl, _ = s.render(1000, "deleted")
    assert len(ed.ids) == 100 and len(dl.ids) == 27 and len(og.ids) == 127
    assert set(og.ids.tolist()) == set(ed.ids.tolist()) | set(dl.ids.tolist())
    assert set(dl.ids.tolist()) == SCENE_GHOST
    assert (dl.flags == 4).all()
    assert og.origin == (4.5, 4.5, 1.5)
    back = og.coords.astype(np.float64) + np.array(og.origin)
    rows = np.array(scene_rows())[og.ids, :3]
    assert (back == rows).all()


def test_ses_11_nearest(mgr):
    s = mgr.require()
    r = s.nearest((3.1, 3.0, 2.0), 0.5)
    assert r["id"] == 100 + 1 * 9 + 1 * 3 + 1 and r["point"] == [3.0, 3.0, 2.0]
    delete_ghost(mgr)
    r = s.nearest((3.1, 3.0, 2.0), 0.5)
    assert r == {"id": None}
    assert s.nearest((3.1, 3.0, 0.1), 0.5)["id"] == 33


def test_ses_12_memory_guard_keeps_old_session(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings, "a.pcd")
    write_scene(settings, "b.pcd")
    m = SessionManager(settings)
    old = m.open_pcd(fixture_dir(settings) / "a.pcd", "a.pcd")
    m.settings = dataclasses.replace(settings, memory_budget_bytes=100)
    with pytest.raises(PcdError):
        m.open_pcd(fixture_dir(settings) / "b.pcd", "b.pcd")
    assert m.session is old and old.state()["counts"]["original"] == 129
    m.jobs.shutdown()


def test_ses_13_replace_session(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings, "a.pcd")
    (fixture_dir(settings) / "bad.pcd").write_bytes(b"VERSION .7\n")
    m = SessionManager(settings)
    a = m.open_pcd(fixture_dir(settings) / "a.pcd", "a.pcd")
    with pytest.raises(PcdError):
        m.open_pcd(fixture_dir(settings) / "bad.pcd", "bad.pcd")
    assert m.session is a and a.source_path.exists()
    assert [p.name for p in (settings.work_root / "sessions").iterdir()] == [
        a.id
    ]
    b = m.open_pcd(fixture_dir(settings) / "a.pcd", "a2.pcd")
    assert m.session is b and not a.source_path.exists()
    m.close()
    assert m.session is None
    m.jobs.shutdown()


def test_ses_14_source_untouched(mgr, tmp_path):
    s = mgr.require()
    path = fixture_dir(mgr.settings) / "scene.pcd"
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    assert s.source_path.parent.parent == mgr.settings.work_root / "sessions"
    delete_ghost(mgr)
    wait(mgr.submit_export("binary", "active"))
    wait(mgr.submit_save())
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    assert hashlib.sha256(s.source_path.read_bytes()).hexdigest() == before


def test_ses_28_unsaved_flag(mgr):
    s = mgr.require()
    s.set_client_state({"camera": [1, 2, 3]})
    select_box(mgr, box_all_ghost())
    assert s.unsaved is False
    delete_ghost(mgr)
    assert s.unsaved is True
    job = wait(mgr.submit_save())
    assert s.unsaved is True  # a save job alone does not clear it
    mgr.mark_saved(job.result["archive_id"])
    assert s.unsaved is False
    s.undo(s.clock.cloud)
    assert s.unsaved is True


def test_ses_29_history_budget(mgr):
    s = mgr.require()
    s.history.budget_bytes = 4
    job = select_box(mgr, box_all_ghost())
    with pytest.raises(EditError) as err:
        s.apply(job.result["candidate"]["candidate_id"], s.clock.cloud, None)
    assert err.value.code == "history_budget_exceeded"
    assert s.active.all()


def test_ses_30_open_cancels_running_job(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    m = SessionManager(settings)
    m.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    import threading

    gate = threading.Event()
    blocker = m.jobs.submit("export", lambda ctx: (gate.wait(5), {})[1])
    queued = m.submit_select(SelectSpec("replace", "active", FilterTool()))
    m.open_pcd(fixture_dir(settings) / "scene.pcd", "again.pcd")
    gate.set()
    wait(queued)
    wait(blocker)
    assert queued.status == "cancelled"
    assert m.require().filename == "again.pcd"
    m.jobs.shutdown()


def test_ses_filter_tool_includes_all_displayed(mgr):
    s = mgr.require()
    s.set_display_filter(DisplayFilter(z=AxisRange(True, 1.0, 3.0)))
    job = wait(
        mgr.submit_select(SelectSpec("replace", "displayed", FilterTool()))
    )
    assert job.result["selected"] == 27
    assert job.result["candidate"]["selected_outside_display_filter"] == 0
    assert not (SCENE_INVALID & set(np.flatnonzero(s.selection).tolist()))


def test_edt_40_filter_change_outdates_displayed_selection(mgr):
    """F-02: a selection made in scope displayed is frozen under the old filter."""
    from gr_pcd.geometry.box import BoxSpec

    s = mgr.require()
    everything = BoxSpec(center=(4.5, 4.5, 1.5), dimensions=(12, 12, 6))
    job = select_box(mgr, everything, scope="displayed")
    assert job.result["selected"] == 127
    old = job.result["candidate"]["candidate_id"]
    s.set_display_filter(DisplayFilter(z=AxisRange(True, 0.5, 9.0)))
    # the stored selection still holds the hidden floor: no candidate may be built from it
    cand = wait(mgr.submit_candidate())
    assert cand.status == "failed"
    assert cand.error["code"] == "selection_outdated"
    with pytest.raises(StaleRevision):
        s.apply(old, s.clock.cloud, None)
    # selecting again under the new filter gives the truth (ghost only)
    job = select_box(mgr, everything, scope="displayed")
    assert job.result["candidate"]["candidates"] == 27
    cid = job.result["candidate"]["candidate_id"]
    s.apply(cid, s.clock.cloud, None)
    assert deleted(s) == SCENE_GHOST
    # undo/redo and clear drop the flag
    s.undo(s.clock.cloud)
    s.set_display_filter(DisplayFilter())
    s.set_display_filter(DisplayFilter(z=AxisRange(True, 0.5, 9.0)))
    s.clear_selection(s.clock.cloud)
    assert wait(mgr.submit_candidate()).status == "complete"


def test_edt_41_active_scope_selection_survives_filter_change(mgr):
    from gr_pcd.geometry.box import BoxSpec

    s = mgr.require()
    everything = BoxSpec(center=(4.5, 4.5, 1.5), dimensions=(12, 12, 6))
    select_box(mgr, everything, scope="active")
    s.set_display_filter(DisplayFilter(z=AxisRange(True, 0.5, 9.0)))
    job = wait(mgr.submit_candidate())
    assert job.status == "complete"
    assert job.result["selected_outside_display_filter"] == 100
