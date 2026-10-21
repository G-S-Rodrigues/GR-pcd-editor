"""LAY-20: layer membership against a brute-force oracle (part 15b, Step 0).

Written before the layer code. The invariant under test is the retained-id
decision: a layer id stays on a point while the point is deleted, so Undo,
rollback and redo need no layer bookkeeping. The oracle is one Python id per
point and one bool per layer, plain sets, nothing clever. If this ever fails
with the implementation, the retained-id decision is wrong (see the plan,
section 6, 15b-0).

The archive leg (LAY-21, the same sequences through save and reopen) lives in
test_archive_layers.py: it cannot pass before the archive carries layers.
"""

import random

import numpy as np
import pytest

from fixtures.memory import trim
from fixtures.pcdgen import build_pcd, xyz_fields
from fixtures.sessions import make_settings, select_box
from fixtures.step_oracle import StepOracle
from gr_pcd.editing.errors import EditError
from gr_pcd.editing.layers import MAX_LAYERS
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


class Oracle(StepOracle):
    """The shared step oracle (deletion and layer steps, in-order flips) plus
    the stored selection and hidden-layer rules this file checks."""

    def __init__(self, n):
        super().__init__(n)
        self.raw_sel: set = set()  # the stored selection (not masked by active)

    @property
    def layers(self):
        return self.attrs

    # -- deletion steps
    def apply(self, ids):
        super().apply(ids)
        self.raw_sel = set()

    # -- layers
    def hidden_pts(self):
        return {
            i
            for i, k in enumerate(self.lid)
            if k and not self.attrs[k]["visible"]
        }

    def selectable(self):
        return self.active() - self.hidden_pts()

    def effective_selection(self):
        return self.raw_sel & self.active()

    def strip(self):
        # a layer change never leaves a hidden point in the stored selection
        self.raw_sel -= self.hidden_pts()

    def moved(self):
        return self.effective_selection() & self.selectable()


def check(s, o):
    active_o = o.active()
    hidden_o = o.hidden_pts()
    assert set(np.flatnonzero(s.active).tolist()) == active_o
    # the stored id of EVERY point, deleted ones included
    got = (
        np.zeros(o.n, dtype=np.uint8)
        if s.layer is None
        else np.asarray(s.layer)
    )
    assert got.tolist() == o.lid
    assert sorted(lay.id for lay in s.layers) == sorted(o.layers)
    # the row ORDER follows the oracle's in-order model (stored index, clamped)
    assert [lay.id for lay in s.layers] == o.order
    assert len(o.layers) <= MAX_LAYERS
    for lay in s.layers:
        assert lay.visible == o.layers[lay.id]["visible"]
        assert lay.name == o.layers[lay.id]["name"]
    st = s.state()
    if not o.layers:
        # a layer-less session sends exactly the keys it always sent
        assert "layers" not in st
        assert "main" not in st["counts"] and "hidden" not in st["counts"]
    else:
        assert [e["id"] for e in st["layers"]] == [lay.id for lay in s.layers]
        by_id = {e["id"]: e for e in st["layers"]}
        assert set(by_id) == set(o.layers)
        for k, e in by_id.items():
            mem = o.members(k, active_o)
            assert e["count"] == len(mem)
            assert (e["bounds"] is None) == (not mem)
            assert e["visible"] == o.layers[k]["visible"]
        assert st["counts"]["hidden"] == len(active_o & hidden_o)
        assert st["counts"]["main"] == len(
            [i for i in active_o if o.lid[i] == 0]
        )
    assert st["counts"]["active"] == len(active_o)
    # the stored selection never holds a hidden point
    eff = set(np.flatnonzero(s.selection & s.active & s.valid).tolist())
    assert eff == o.effective_selection()
    assert not (eff & hidden_o)
    # a hidden layer is not drawn, a deleted point is not drawn, nothing else is dropped
    drawn = set(s.render(10**9, "edited")[0].ids.tolist())
    assert drawn == active_o - hidden_o
    # export ignores visibility
    assert set(np.flatnonzero(s.export_mask("active")).tolist()) == active_o
    # Part 19: the history equals the oracle's steps, layer steps included
    assert [e["sid"] for e in st["history"]["entries"]] == [
        x.sid for x in o.steps
    ]
    assert [e["kind"] for e in st["history"]["entries"]] == [
        x.kind for x in o.steps
    ]
    assert st["history"]["cursor"] == o.cursor
    for e, x in zip(s.history.entries, o.steps, strict=True):
        if x.kind == "delete":
            assert set(e.ids.tolist()) == x.ids
        else:
            assert {
                int(i): (int(a), int(b))
                for i, a, b in zip(e.ids, e.frm, e.to, strict=True)
            } == x.diff
    for e in st["history"]["entries"]:
        assert ("deletable" in e) == (e["kind"] == "layer")
        if e["kind"] == "layer":
            assert e["deletable"] == o.deletable(e["sid"])


def random_box(rng):
    c = tuple(rng.randrange(0, 80) / 8.0 for _ in range(3))
    d = tuple(rng.randrange(1, 60) / 8.0 for _ in range(3))
    return BoxSpec(center=c, dimensions=d), c, d


def inside_of(xyz, c, d):
    return set(
        np.flatnonzero(
            np.all(np.abs(xyz - np.array(c)) <= np.array(d) / 2.0, axis=1)
        ).tolist()
    )


def do_select(mgr, s, o, xyz, rng):
    box, c, d = random_box(rng)
    op = rng.choice(["replace", "replace", "add"])
    job = select_box(mgr, box, op=op, scope="active")
    assert job.status == "complete", job.error
    operand = inside_of(xyz, c, d) & o.selectable()
    base = set() if op == "replace" else o.effective_selection()
    o.raw_sel = base | operand


def do_apply(mgr, s, o, xyz, rng):
    box, c, d = random_box(rng)
    job = select_box(mgr, box, scope="active")
    assert job.status == "complete", job.error
    expect = inside_of(xyz, c, d) & o.selectable()
    o.raw_sel = set(expect)
    try:
        s.apply(job.result["candidate"]["candidate_id"], s.clock.cloud, None)
    except EditError as exc:
        assert exc.code == "nothing_to_delete" and not expect
        return
    o.apply(expect)


def expect_error(code, fn, *args, **kw):
    with pytest.raises(EditError) as err:
        fn(*args, **kw)
    assert err.value.code == code


def do_create(s, o, rng, name):
    visible = rng.choice([True, True, False])
    if not o.moved():
        expect_error(
            "empty_selection",
            s.create_layer,
            s.clock.cloud,
            name=name,
            visible=visible,
        )
        return
    moved = o.moved()
    s.create_layer(s.clock.cloud, name=name, visible=visible)
    o.create(moved, name, visible)
    o.strip()


def do_assign(s, o, rng):
    target = rng.choice([0] + sorted(o.layers))
    visible = rng.choice([None, None, True, False]) if target else None
    if not o.moved():
        expect_error(
            "empty_selection",
            s.assign_layer,
            s.clock.cloud,
            target,
            visible=visible,
        )
        return
    moved = o.moved()
    s.assign_layer(s.clock.cloud, target, visible=visible)
    o.assign(moved, target)
    if visible is not None:
        o.patch(target, visible=visible)
    o.strip()


def do_set_members(s, o, rng):
    if not o.layers:
        return
    k = rng.choice(sorted(o.layers))
    if not o.layers[k]["visible"]:
        expect_error("layer_hidden", s.set_layer_members, s.clock.cloud, k)
        return
    if not o.moved():
        expect_error("empty_selection", s.set_layer_members, s.clock.cloud, k)
        return
    keep = o.moved()
    s.set_layer_members(s.clock.cloud, k)
    o.set_members(k, keep)
    o.strip()


def do_delete_layer(s, o, rng):
    if not o.layers:
        return
    k = rng.choice(sorted(o.layers))
    s.delete_layer(s.clock.cloud, k)
    o.to_main(k)


def do_merge(s, o, rng):
    if len(o.layers) < 2:
        return
    a, b = rng.sample(sorted(o.layers), 2)
    s.merge_layer(s.clock.cloud, a, b)
    o.merge(a, b)
    o.strip()


def do_delete_step(s, o, rev, sid):
    if o.deletable(sid):
        s.delete_step(rev, sid)
        o.delete_step(sid)
    else:
        expect_error("step_has_dependents", s.delete_step, rev, sid)
        assert not o.delete_step(sid)
    o.strip()


def do_visibility(s, o, rng):
    if not o.layers:
        return
    visible = rng.choice([True, False])
    if rng.random() < 0.5:
        k = rng.choice(sorted(o.layers))
        s.patch_layer(k, visible=visible)
        o.layers[k]["visible"] = visible
    else:
        ids = rng.sample(sorted(o.layers), rng.randrange(1, len(o.layers) + 1))
        s.set_layers_visibility(ids, visible)
        for k in ids:
            o.layers[k]["visible"] = visible
    o.strip()


def run_sequence(tmp_path, seed, ops=OPS):
    rng = random.Random(seed)
    n = rng.randrange(200, 2001)
    rows, xyz = make_cloud(rng, n)
    mgr = open_cloud(tmp_path, rows)
    s, o = mgr.require(), Oracle(n)
    stats = {"layered_deleted": 0, "hidden": 0}
    try:
        for step in range(ops):
            op = rng.choice(
                [
                    "select",
                    "select",
                    "create",
                    "create",
                    "create",
                    "assign",
                    "set_members",
                    "delete_layer",
                    "merge",
                    "visibility",
                    "visibility",
                    "apply",
                    "apply",
                    "apply",
                    "undo",
                    "redo",
                    "rollback",
                    "delete_step",
                ]
            )
            rev = s.clock.cloud
            if op == "select":
                do_select(mgr, s, o, xyz, rng)
            elif op == "create":
                do_select(mgr, s, o, xyz, rng)
                do_create(s, o, rng, f"L{seed}-{step}")
            elif op == "assign":
                do_select(mgr, s, o, xyz, rng)
                do_assign(s, o, rng)
            elif op == "set_members":
                do_select(mgr, s, o, xyz, rng)
                do_set_members(s, o, rng)
            elif op == "delete_layer":
                do_delete_layer(s, o, rng)
            elif op == "merge":
                do_merge(s, o, rng)
            elif op == "visibility":
                do_visibility(s, o, rng)
            elif op == "apply":
                do_apply(mgr, s, o, xyz, rng)
            elif op == "undo":
                if o.cursor:
                    s.undo(rev)
                    o.undo()
                    o.strip()
            elif op == "redo":
                if o.cursor < len(o.steps):
                    s.redo(rev)
                    o.redo()
                    o.strip()
            elif op == "rollback":
                k = rng.randrange(0, len(o.steps) + 1)
                s.rollback(rev, k)
                o.rollback(k)
                o.strip()
            elif op == "delete_step" and o.steps:
                do_delete_step(s, o, rev, rng.choice(o.steps).sid)
            check(s, o)
            if any(o.lid[i] for i in set(range(n)) - o.active()):
                stats["layered_deleted"] += 1
            if o.hidden_pts():
                stats["hidden"] += 1
        return mgr, s, o, stats
    except BaseException:
        mgr.jobs.shutdown()
        raise


@pytest.fixture(autouse=True)
def _trim():
    yield
    trim()


def test_lay_20_property_against_oracle(tmp_path):
    for seed in range(SEQUENCES):
        mgr, *_ = run_sequence(tmp_path / f"s{seed}", seed)
        mgr.jobs.shutdown()


def test_lay_20b_sequences_are_not_trivial(tmp_path):
    # the generator must really reach deleted-but-layered and hidden states
    total = {"layered_deleted": 0, "hidden": 0}
    for seed in range(40):
        mgr, _s, _o, stats = run_sequence(tmp_path / f"t{seed}", seed)
        mgr.jobs.shutdown()
        for key in total:
            total[key] += stats[key]
    assert total["layered_deleted"] > 20 and total["hidden"] > 20
