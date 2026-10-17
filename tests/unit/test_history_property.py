"""HST-20 (HST-21, the archive leg, lives in test_archive_steps.py): the step algebra against a brute-force oracle.

Written before the timeline code (part 11, Step 0): the invariant is that
every step's id set is disjoint from every other step's, and that
active == ~union(applied sets) in every reachable state, including after
step deletion, rollback and redo, and after an archive round trip.
"""

import random

import numpy as np

from fixtures.pcdgen import build_pcd, xyz_fields
from fixtures.sessions import make_settings, select_box
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


class Oracle:
    """Plain sets: steps = [(sid, set)], cursor, nothing clever."""

    def __init__(self, n):
        self.n = n
        self.steps: list[tuple[int, set]] = []
        self.cursor = 0
        self.next_sid = 0
        self.names: dict[int, str | None] = {}

    def active(self):
        gone = set()
        for _, ids in self.steps[: self.cursor]:
            gone |= ids
        return set(range(self.n)) - gone

    def apply(self, ids):
        self.steps = self.steps[: self.cursor] + [(self.next_sid, set(ids))]
        self.names[self.next_sid] = None
        self.next_sid += 1
        self.cursor = len(self.steps)

    def delete(self, sid):
        idx = [s for s, _ in self.steps].index(sid)
        self.steps.pop(idx)
        if idx < self.cursor:
            self.cursor -= 1
        del self.names[sid]


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
    assert [e["sid"] for e in h["entries"]] == [sid for sid, _ in o.steps]
    assert len({e["sid"] for e in h["entries"]}) == len(h["entries"])
    sets = [set(e.ids.tolist()) for e in s.history.entries]
    assert sets == [ids for _, ids in o.steps]
    # pairwise disjoint over ALL steps, applied or greyed
    seen: set = set()
    for ids in sets:
        assert not (seen & ids)
        seen |= ids
    assert [e["name"] for e in h["entries"]] == [
        o.names[sid] for sid, _ in o.steps
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


def run_sequence(tmp_path, seed, ops=OPS):
    rng = random.Random(seed)
    n = rng.randrange(200, 2001)
    rows, xyz = make_cloud(rng, n)
    mgr = open_cloud(tmp_path, rows)
    s, o = mgr.require(), Oracle(n)
    try:
        for _ in range(ops):
            op = rng.choice(
                [
                    "apply",
                    "apply",
                    "apply",
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
            elif op == "undo":
                if o.cursor:
                    s.undo(rev)
                    o.cursor -= 1
            elif op == "redo":
                if o.cursor < len(o.steps):
                    s.redo(rev)
                    o.cursor += 1
            elif op == "rollback":
                k = rng.randrange(0, len(o.steps) + 1)
                s.rollback(rev, k)
                o.cursor = k
            elif op == "delete" and o.steps:
                sid = rng.choice(o.steps)[0]
                s.delete_step(rev, sid)
                o.delete(sid)
            elif op == "rename" and o.steps:
                sid = rng.choice(o.steps)[0]
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
    reached = {"greyed": 0, "deleted_applied": 0}
    for seed in range(40):
        mgr, _s, o = run_sequence(tmp_path / f"t{seed}", seed)
        mgr.jobs.shutdown()
        if o.cursor < len(o.steps):
            reached["greyed"] += 1
        if o.next_sid > len(o.steps):
            reached["deleted_applied"] += 1
    assert reached["greyed"] > 3 and reached["deleted_applied"] > 3
