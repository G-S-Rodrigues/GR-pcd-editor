"""HST-20 (HST-21, the archive leg, lives in test_archive_steps.py): the step algebra against a brute-force oracle.

Written before the timeline code (part 11, Step 0): the invariant is that
every step's id set is disjoint from every other step's, and that
active == ~union(applied sets) in every reachable state, including after
step deletion, rollback and redo, and after an archive round trip.
"""

import random

import numpy as np
import pytest

from fixtures.pcdgen import build_pcd, xyz_fields
from fixtures.sessions import make_settings, select_box
from fixtures.step_oracle import StepOracle
from gr_pcd.editing.errors import EditError
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.session.manager import SessionManager

SEQUENCES = 300
OPS = 25


def make_cloud(rng, n):
    # dyadic coordinates: float32 holds them exactly, box edges tie exactly
    rows = [
        (
            rng.randrange(0, 80) / 8.0,
            rng.randrange(0, 80) / 8.0,
            rng.randrange(0, 80) / 8.0,
        )
        for _ in range(n)
    ]
    return rows, np.array(rows, dtype=np.float64)


def open_cloud(tmp_path, rows):
    settings = make_settings(tmp_path)
    path = tmp_path / "data" / "prop.pcd"
    path.write_bytes(build_pcd(xyz_fields(4), rows, "binary"))
    mgr = SessionManager(settings)
    mgr.open_pcd(path, "prop.pcd")
    return mgr


def check(s, o):
    active_o = o.active()
    got = set(np.flatnonzero(s.active).tolist())
    assert got == active_o
    st = s.state()
    assert st["counts"]["active"] == len(active_o)
    assert st["counts"]["deleted"] == o.n - len(active_o)
    assert set(np.flatnonzero(s.export_mask("active")).tolist()) == active_o
    h = st["history"]
    assert h["cursor"] == o.cursor
    assert [e["sid"] for e in h["entries"]] == [x.sid for x in o.steps]
    assert len({e["sid"] for e in h["entries"]}) == len(h["entries"])
    assert [e["kind"] for e in h["entries"]] == [x.kind for x in o.steps]
    # deletion steps are pairwise disjoint over ALL of them, applied or greyed;
    # layer steps overlap by design (Part 19)
    seen: set = set()
    for e, x in zip(s.history.entries, o.steps, strict=True):
        if x.kind == "delete":
            ids = set(e.ids.tolist())
            assert ids == x.ids
            assert not (seen & ids)
            seen |= ids
        else:
            assert {
                int(i): (int(a), int(b))
                for i, a, b in zip(e.ids, e.frm, e.to, strict=True)
            } == x.diff
    # the per-point layer (kept on deleted points), the rows in order, and
    # which layer steps may be deleted
    got_lid = [0] * o.n if s.layer is None else np.asarray(s.layer).tolist()
    assert got_lid == o.lid
    assert [lay.id for lay in s.layers] == o.order
    assert [lay.name for lay in s.layers] == [
        o.attrs[k]["name"] for k in o.order
    ]
    for e in h["entries"]:
        assert ("deletable" in e) == (e["kind"] == "layer")
        if e["kind"] == "layer":
            assert e["deletable"] == o.deletable(e["sid"])
    assert [e["name"] for e in h["entries"]] == [
        o.names[x.sid] for x in o.steps
    ]


def random_box(rng):
    c = tuple(rng.randrange(0, 80) / 8.0 for _ in range(3))
    d = tuple(rng.randrange(1, 60) / 8.0 for _ in range(3))
    return BoxSpec(center=c, dimensions=d), c, d


def do_apply(mgr, s, o, xyz, rng):
    box, c, d = random_box(rng)
    job = select_box(mgr, box, scope="active")
    assert job.status == "complete", job.error
    inside = np.all(np.abs(xyz - np.array(c)) <= np.array(d) / 2.0, axis=1)
    expect = set(np.flatnonzero(inside).tolist()) & o.active()
    cand = job.result["candidate"]
    try:
        s.apply(cand["candidate_id"], s.clock.cloud, None)
    except EditError as exc:
        assert exc.code == "nothing_to_delete" and not expect
        return
    o.apply(expect)


def select_some(mgr, s, o, xyz, rng):
    """Select (replace) the active points inside a random box; the oracle's
    movable set (no layer is hidden here, so every active one)."""
    box, c, d = random_box(rng)
    job = select_box(mgr, box, op="replace", scope="active")
    assert job.status == "complete", job.error
    inside = np.all(np.abs(xyz - np.array(c)) <= np.array(d) / 2.0, axis=1)
    return set(np.flatnonzero(inside).tolist()) & o.active()


def do_layer(mgr, s, o, xyz, rng, op, tag):
    rev = s.clock.cloud
    rows = sorted(o.row_ids())
    if op == "merge":
        if len(rows) >= 2:
            a, b = rng.sample(rows, 2)
            s.merge_layer(rev, a, b)
            o.merge(a, b)
        return
    if op == "to_main":
        if rows:
            k = rng.choice(rows)
            s.delete_layer(rev, k)
            o.to_main(k)
        return
    moved = select_some(mgr, s, o, xyz, rng)
    if not moved:
        return
    if op == "create":
        s.create_layer(rev, name=tag)
        o.create(moved, tag)
    elif op == "assign" and rows:
        k = rng.choice(rows)
        s.assign_layer(rev, k)
        o.assign(moved, k)
    elif op == "release":
        s.assign_layer(rev, 0)
        o.assign(moved, 0)
    elif op == "members" and rows:
        k = rng.choice(rows)
        s.set_layer_members(rev, k)
        o.set_members(k, moved)


def delete_step_both(s, o, rev, sid):
    if o.deletable(sid):
        s.delete_step(rev, sid)
        o.delete_step(sid)
        return
    with pytest.raises(EditError) as err:
        s.delete_step(rev, sid)
    assert err.value.code == "step_has_dependents"
    assert not o.delete_step(sid)


def run_sequence(tmp_path, seed, ops=OPS):
    rng = random.Random(seed)
    n = rng.randrange(200, 2001)
    rows, xyz = make_cloud(rng, n)
    mgr = open_cloud(tmp_path, rows)
    s, o = mgr.require(), StepOracle(n)
    try:
        for _ in range(ops):
            op = rng.choice(
                [
                    "apply",
                    "apply",
                    "apply",
                    "create",
                    "create",
                    "assign",
                    "release",
                    "members",
                    "merge",
                    "to_main",
                    "undo",
                    "redo",
                    "rollback",
                    "delete",
                    "rename",
                ]
            )
            rev = s.clock.cloud
            if op == "apply":
                do_apply(mgr, s, o, xyz, rng)
            elif op in {
                "create",
                "assign",
                "release",
                "members",
                "merge",
                "to_main",
            }:
                do_layer(mgr, s, o, xyz, rng, op, f"L{seed}-{len(o.steps)}")
            elif op == "undo":
                if o.cursor:
                    s.undo(rev)
                    o.undo()
            elif op == "redo":
                if o.cursor < len(o.steps):
                    s.redo(rev)
                    o.redo()
            elif op == "rollback":
                k = rng.randrange(0, len(o.steps) + 1)
                s.rollback(rev, k)
                o.rollback(k)
            elif op == "delete" and o.steps:
                delete_step_both(s, o, rev, rng.choice(o.steps).sid)
            elif op == "rename" and o.steps:
                sid = rng.choice(o.steps).sid
                name = rng.choice(["  first  ", "cut", "", "x" * 80])
                s.rename_step(sid, name)
                o.names[sid] = name.strip() or None
            check(s, o)
        return mgr, s, o
    except BaseException:
        mgr.jobs.shutdown()
        raise


def test_hst_20_property_against_oracle(tmp_path):
    for seed in range(SEQUENCES):
        mgr, _, _ = run_sequence(tmp_path / f"s{seed}", seed)
        mgr.jobs.shutdown()


def test_hst_20b_sequences_are_not_trivial(tmp_path):
    # the generator must really reach rolled-back and deleted-step states
    reached = {
        "greyed": 0,
        "deleted_applied": 0,
        "layer_undone": 0,
        "refused": 0,
    }
    for seed in range(40):
        mgr, _s, o = run_sequence(tmp_path / f"t{seed}", seed)
        mgr.jobs.shutdown()
        reached["layer_undone"] += o.stats["layer_undone"]
        reached["refused"] += o.stats["delete_refused"]
        if o.cursor < len(o.steps):
            reached["greyed"] += 1
        if o.next_sid > len(o.steps):
            reached["deleted_applied"] += 1
    assert reached["greyed"] > 3 and reached["deleted_applied"] > 3
    assert reached["layer_undone"] > 3 and reached["refused"] > 3
