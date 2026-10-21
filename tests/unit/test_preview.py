"""SES-70..75: the pending preview of Add / Subtract / Intersect (part 12b-1).

A preview computes `S OP shape` without committing it: the selection, the
candidate, the revision ticket, the selection ops and the history stay as
they were; Commit installs exactly the previewed mask by id.
"""

import os
import subprocess
import sys
import time

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
from gr_pcd.editing.errors import EditError
from gr_pcd.editing.protection import Interval, ProtectionState
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.geometry.filters import AxisRange, DisplayFilter
from gr_pcd.geometry.prism import PrismSpec
from gr_pcd.session.codec import ClusterTool
from gr_pcd.session.engine import (
    FLAG_PROTECTED,
    FLAG_SELECTED,
    SelectSpec,
)
from gr_pcd.session.errors import StaleRevision
from gr_pcd.session.jobs import Stale
from gr_pcd.session.manager import SessionManager

PREVIEW_ADD, PREVIEW_REMOVE = 8, 16  # render flag bits (frontend parse.ts)

XYZ = np.array([r[:3] for r in scene_rows()], dtype=np.float64)
VALID = np.isfinite(XYZ).all(axis=1)

# S: 16 floor points (x, y 1..4) and the 9 ghosts of the z = 1 layer
S_BOX = BoxSpec(center=(2.5, 2.5, 0.5), dimensions=(3.5, 3.5, 1.5))
B2 = BoxSpec(center=(3.5, 3.5, 1.0), dimensions=(3.0, 3.0, 2.0))
PRISM = PrismSpec(
    polygon=((1.5, 1.5), (5.5, 1.5), (5.5, 5.5), (1.5, 5.5)),
    z_min=-0.25,
    z_max=1.25,
)
GHOST_REGION = BoxSpec(center=(3.0, 3.0, 2.0), dimensions=(3.0, 3.0, 3.0))
CLUSTER = ClusterTool(
    seed_id=100, radius=1.0, region=GHOST_REGION, exclude_protected=False
)


def in_box(b):
    c, d = np.array(b.center), np.array(b.dimensions)
    with np.errstate(invalid="ignore"):
        return VALID & np.all(np.abs(XYZ - c) <= d / 2, axis=1)


def in_prism(p):
    lo, hi = (1.5, 1.5), (5.5, 5.5)
    with np.errstate(invalid="ignore"):
        return (
            VALID
            & np.all((XYZ[:, :2] >= lo) & (XYZ[:, :2] <= hi), axis=1)
            & (XYZ[:, 2] >= p.z_min)
            & (XYZ[:, 2] <= p.z_max)
        )


def oracle_cluster():
    """Brute-force component of seed 100 inside the region (all ghosts)."""
    region = in_box(GHOST_REGION)
    seen = {100}
    todo = [100]
    while todo:
        i = todo.pop()
        for j in np.flatnonzero(region):
            if j not in seen and np.linalg.norm(XYZ[i] - XYZ[j]) <= 1.0:
                seen.add(int(j))
                todo.append(int(j))
    out = np.zeros(len(XYZ), dtype=bool)
    out[list(seen)] = True
    return out


SHAPES = {
    "box": (B2, lambda: in_box(B2)),
    "prism": (PRISM, lambda: in_prism(PRISM)),
    "cluster": (CLUSTER, oracle_cluster),
}


@pytest.fixture
def mgr(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    m = SessionManager(settings)
    m.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    yield m
    m.jobs.shutdown()


@pytest.fixture
def s(mgr):
    """The session with S committed (25 points) and its candidate evaluated."""
    job = select_box(mgr, S_BOX)
    assert job.status == "complete", job.error
    return mgr.require()


def spec(op, tool, scope="active"):
    return SelectSpec(op, scope, tool)


def preview(s, op, tool, scope="active"):
    return s.run_preview(spec(op, tool, scope), s.clock.ticket(), CancelToken())


def sel_ids(s):
    return set(np.flatnonzero(s.selection & s.active & s.valid).tolist())


def oracle(op, shape):
    s_ = np.zeros(len(XYZ), dtype=bool)
    s_[list(sel_truth())] = True
    return {
        "add": s_ | shape,
        "subtract": s_ & ~shape,
        "intersect": s_ & shape,
    }[op]


def sel_truth():
    return set(np.flatnonzero(in_box(S_BOX)).tolist())


def snapshot(s):
    return (
        s.selection,
        s.selection_id,
        s.candidate,
        s.clock.ticket(),
        list(s.selection_ops),
        list(s.history.entries),
        s.history.cursor,
        s.active,
    )


def test_ses_70_s_box_setup_is_what_the_oracle_says(s):
    assert sel_ids(s) == sel_truth() and len(sel_truth()) == 25


@pytest.mark.parametrize("op", ["add", "subtract", "intersect"])
@pytest.mark.parametrize("name", ["box", "prism", "cluster"])
def test_ses_70_preview_counts_equal_oracle_and_nothing_is_touched(s, op, name):
    tool, shape_fn = SHAPES[name]
    shape = shape_fn()
    want = oracle(op, shape)
    before = snapshot(s)
    r = preview(s, op, tool)
    base = np.zeros(len(XYZ), dtype=bool)
    base[list(sel_truth())] = True
    assert r["selected_after"] == int(want.sum())
    assert r["base_selected"] == 25
    assert r["added"] == int((want & ~base).sum())
    assert r["removed"] == int((base & ~want).sum())
    assert r["operand"] == int(shape.sum())
    assert isinstance(r["preview_id"], str) and r["preview_id"]
    if name == "cluster":
        assert r["cluster"]["size"] == int(shape.sum())
    after = snapshot(s)
    assert after[0] is before[0]  # the very same selection object
    assert after[1:3] == before[1:3] and after[2] is before[2]
    assert after[3:7] == before[3:7] and after[7] is before[7]


def test_ses_70_preview_refuses_replace_invert_and_no_tool(s):
    for op in ("replace", "invert"):
        with pytest.raises(EditError) as e:
            preview(s, op, B2)
        assert e.value.code == "invalid_op"
    with pytest.raises(EditError) as e:
        preview(s, "add", None)
    assert e.value.code == "tool_required"
    assert s.pending is None


@pytest.mark.parametrize("op", ["add", "subtract", "intersect"])
def test_ses_71_commit_installs_exactly_the_previewed_mask(mgr, s, op):
    r = preview(s, op, B2)
    pend_mask = s.pending.new_sel.copy()
    tk = s.clock.ticket()
    out = s.commit_pending(r["preview_id"], tk, CancelToken())
    assert np.array_equal(s.selection, pend_mask)
    assert s.clock.ticket() == (tk[0], tk[1] + 1)  # params bumped once
    assert s.pending is None
    assert out["selected"] == r["selected_after"]
    assert out["candidate"]["candidate_id"] == s.candidate.id
    ops_commit = s.selection_ops[-1]
    # the same spec through run_select gives the same selection and entry
    select_box(mgr, S_BOX)
    mgr_job = wait(mgr.submit_select(spec(op, B2)))
    assert mgr_job.status == "complete"
    assert np.array_equal(s.selection, pend_mask)
    ops_select = s.selection_ops[-1]
    assert {**ops_select, "cloud_revision": 0} == {
        **ops_commit,
        "cloud_revision": 0,
    }


def test_ses_72_stale_rules(mgr, s):
    def fresh():
        r = preview(s, "add", B2)
        return r["preview_id"]

    def commit(pid):
        return s.commit_pending(pid, s.clock.ticket(), CancelToken())

    # wrong and absent ids
    pid = fresh()
    with pytest.raises(StaleRevision):
        commit("nope")
    s.discard_preview()
    with pytest.raises(StaleRevision):
        commit(pid)
    # a second preview replaces the first
    first = fresh()
    second = fresh()
    assert first != second
    with pytest.raises(StaleRevision):
        commit(first)
    # display filter, protection, clear, another selection each kill it
    changes = [
        lambda: s.set_display_filter(
            DisplayFilter(x=AxisRange(True, 0.0, 9.0))
        ),
        lambda: s.set_protection(ProtectionState(Interval(True, -1.0, 0.5))),
        lambda: s.clear_selection(s.clock.cloud),
        lambda: select_box(mgr, S_BOX),
    ]
    for change in changes:
        pid = fresh()
        change()
        assert s.pending is None or s.pending.id != pid
        with pytest.raises(StaleRevision):
            commit(pid)
        if s.selection.sum() == 0:
            select_box(mgr, S_BOX)
    # apply, undo and rollback bump the cloud revision
    pid = fresh()
    cid = s.candidate.id
    s.apply(cid, s.clock.cloud, None)
    with pytest.raises(StaleRevision):
        commit(pid)
    select_box(mgr, S_BOX)
    pid = fresh()
    s.undo(s.clock.cloud)
    assert s.pending is None
    with pytest.raises(StaleRevision):
        commit(pid)


def test_ses_72_a_job_ticket_older_than_the_preview_is_stale(s):
    r = preview(s, "add", B2)
    old = (s.clock.cloud, s.clock.ticket()[1] - 1)
    with pytest.raises(Stale):
        s.commit_pending(r["preview_id"], old, CancelToken())
    assert s.pending is not None  # an untouched preview survives


def test_ses_73_cancel_and_stale_store_nothing(s, monkeypatch):
    first = preview(s, "add", B2)["preview_id"]
    tok = CancelToken()
    tok.cancel()
    with pytest.raises(Cancelled):
        s.run_preview(spec("subtract", B2), s.clock.ticket(), tok)
    assert s.pending.id == first  # the older preview is intact
    old = s.clock.ticket()
    s.set_display_filter(DisplayFilter())  # bumps params
    with pytest.raises(Stale):
        s.run_preview(spec("subtract", B2), old, CancelToken())
    assert s.pending is None  # the filter change cleared it

    # a ticket that turns stale while the job runs
    real = s._operand

    def operand_then_change(*a, **k):
        out = real(*a, **k)
        s.set_protection(ProtectionState(Interval(True, -1.0, 0.5)))
        return out

    monkeypatch.setattr(s, "_operand", operand_then_change)
    with pytest.raises(Stale):
        preview(s, "add", B2)
    assert s.pending is None


def render_flags(s, pid=None, budget=1000, mode="edited"):
    arr, _ = s.render(budget, mode, preview=pid)
    return arr, dict(zip(arr.ids.tolist(), arr.flags.tolist(), strict=True))


@pytest.mark.parametrize("op", ["add", "subtract", "intersect"])
def test_ses_74_render_flags_of_a_preview(s, op):
    r = preview(s, op, B2)
    shape = in_box(B2)
    base = np.zeros(len(XYZ), dtype=bool)
    base[list(sel_truth())] = True
    after = oracle(op, shape)
    arr, f = render_flags(s, r["preview_id"])
    assert arr.preview_id == r["preview_id"]
    drawn = {i for i, v in f.items() if v & (FLAG_SELECTED | PREVIEW_REMOVE)}
    for i in range(127):
        v = f[i]
        assert bool(v & FLAG_SELECTED) == bool(after[i]), (op, i)
        assert bool(v & PREVIEW_ADD) == bool(after[i] and not base[i])
        assert bool(v & PREVIEW_REMOVE) == bool(base[i] and not after[i])
        if base[i] and not after[i]:
            assert not v & FLAG_SELECTED  # drawn, but as "will be removed"
    assert drawn == {i for i in range(127) if base[i] or after[i]}
    # without the id it is the committed selection, no header
    plain, pf = render_flags(s, None)
    assert plain.preview_id is None
    assert {i for i, v in pf.items() if v & FLAG_SELECTED} == sel_truth()
    assert not any(v & (PREVIEW_ADD | PREVIEW_REMOVE) for v in pf.values())
    # an unknown or stale id renders exactly as no preview
    bad, bf = render_flags(s, "unknown")
    assert bad.preview_id is None and bf == pf


def test_ses_74_protected_wins_and_deleted_bit_is_unchanged(s):
    s.set_protection(ProtectionState(Interval(True, -0.5, 0.5)))  # the floor
    r = preview(s, "add", B2)
    _, f = render_flags(s, r["preview_id"])
    floor_sel = [
        i for i in range(100) if f[i] & (FLAG_SELECTED | FLAG_PROTECTED)
    ]
    assert floor_sel and all(f[i] & FLAG_PROTECTED for i in floor_sel)
    assert all(not f[i] & FLAG_SELECTED for i in floor_sel)
    assert not any(v & 4 for v in f.values())


def test_ses_74_delta_survives_thinning_and_other_modes_refuse(s):
    r = preview(s, "add", B2)
    # 127 points, budget 40: m > budget, the flagged delta is still drawn
    arr, f = render_flags(s, r["preview_id"], budget=40)
    delta = {i for i, v in f.items() if v & PREVIEW_ADD}
    want = {
        i
        for i in range(127)
        if oracle("add", in_box(B2))[i] and i not in sel_truth()
    }
    assert want and len(want) <= 20 and want <= delta
    assert arr.eligible == 127
    for mode in ("original", "deleted"):
        with pytest.raises(EditError) as e:
            s.render(1000, mode, preview=r["preview_id"])
        assert e.value.code == "invalid_mode"


def test_ses_75_apply_after_a_preview_deletes_the_committed_set_only(s):
    cand = s.candidate
    ids_before = cand.result.ids.copy()
    preview(s, "add", PRISM)
    assert s.candidate is cand
    s.apply(cand.id, s.clock.cloud, None)
    assert set(np.flatnonzero(~s.active).tolist()) == set(ids_before.tolist())
    assert set(ids_before.tolist()) == sel_truth()
    assert s.pending is None and SCENE_GHOST - set(ids_before.tolist())


def test_ses_76_one_million_points_preview_cost(tmp_path):
    # A child process, like API-85: later tests read a child's peak RSS.
    env = dict(os.environ, PYTHONPATH=os.pathsep.join(p for p in sys.path if p))
    proc = subprocess.run(
        [sys.executable, os.path.abspath(__file__), str(tmp_path)],
        capture_output=True,
        text=True,
        env=env,
        timeout=300,
        check=False,
    )
    assert proc.returncode == 0, (proc.stdout + proc.stderr)[-3000:]


def one_million_points(tmp_path):
    n = 1_000_000
    rng = np.random.default_rng(5)
    xyz = (rng.integers(0, 4000, (n, 3)) / 128.0).astype("<f4")
    head = (
        "# .PCD v.7\nVERSION .7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\n"
        f"COUNT 1 1 1\nWIDTH {n}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\n"
        f"POINTS {n}\nDATA binary\n"
    ).encode()
    settings = make_settings(tmp_path)
    (fixture_dir(settings) / "big.pcd").write_bytes(head + xyz.tobytes())
    m = SessionManager(settings)
    s = m.open_pcd(fixture_dir(settings) / "big.pcd", "big.pcd")
    first = BoxSpec(center=(10, 10, 10), dimensions=(12, 12, 12))
    second = BoxSpec(center=(18, 18, 18), dimensions=(14, 14, 14))
    assert wait(m.submit_select(spec("replace", first))).status == "complete"
    sel = in_box_big(xyz, first)
    shape = in_box_big(xyz, second)

    def best(fn, k=3):
        out = 1e9
        for _ in range(k):
            t0 = time.perf_counter()
            fn()
            out = min(out, time.perf_counter() - t0)
        return out

    plain = best(lambda: s.render(1_000_000, "edited"))
    pid = {}

    def do_preview():
        pid.update(preview(s, "add", second))

    t_job = best(do_preview)
    drawn = best(
        lambda: s.render(1_000_000, "edited", preview=pid["preview_id"])
    )
    print(
        f"render plain {plain:.3f}s with preview {drawn:.3f}s job {t_job:.3f}s"
    )
    assert pid["selected_after"] == int((sel | shape).sum())
    assert pid["added"] == int((shape & ~sel).sum())
    # the preview costs at most 100 percent more than a plain render
    # (0.25 s of slack for scheduler noise on a loaded host)
    assert drawn <= 2 * plain + 0.25, (plain, drawn)
    assert t_job <= 10 * plain + 1.0, (plain, t_job)
    # the delta is never dropped when it is below the flagged cap
    small = BoxSpec(center=(18, 18, 18), dimensions=(2, 2, 2))
    r = preview(s, "add", small)
    arr, _ = s.render(100_000, "edited", preview=r["preview_id"])
    got = int(((arr.flags & PREVIEW_ADD) != 0).sum())
    assert r["added"] <= 50_000 and got == r["added"], (got, r["added"])
    # over the cap the picture is thinned evenly, the counts stay exact
    r = preview(s, "add", second)
    arr, _ = s.render(100_000, "edited", preview=r["preview_id"])
    got = int(((arr.flags & PREVIEW_ADD) != 0).sum())
    assert r["added"] > 50_000 and 50_000 <= got < r["added"], got
    m.jobs.shutdown()


def in_box_big(xyz, b):
    c, d = np.array(b.center), np.array(b.dimensions)
    return np.all(np.abs(xyz.astype(np.float64) - c) <= d / 2, axis=1)


if __name__ == "__main__":
    import pathlib

    one_million_points(pathlib.Path(sys.argv[1]))
