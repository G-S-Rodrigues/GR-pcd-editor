"""A plain-set oracle for timeline steps: deletions and layer edits (part 19).

Nothing clever on purpose: one layer id per point (kept on deleted points), an
ordered list of rows with attributes, and a list of steps. Deletion steps hold
an id set. Layer steps hold the per-id from/to values and the rows they created
or removed, with the row's position (the engine's rule: stored index, clamped).

Undo, redo and rollback flip steps in order. Deleting a layer step follows the
plan's rule 3.4 (a later layer step that shares ids or rows blocks it) and, when
the rule allows it, replays every remaining applied step from the initial state
and requires the same per-point layers and the same row ids as the reverted
state (soundness). Row ORDER is not part of that replay: re-inserting a row at
its stored index can legitimately drift the order after a deleted step.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field

MAX_LAYERS = 32


@dataclass
class Step:
    sid: int
    kind: str  # "delete" | "layer"
    ids: set
    diff: dict = field(default_factory=dict)  # id -> (from, to), layer steps
    rows: list = field(default_factory=list)  # [index, lid, created, attrs]

    def made(self) -> set:
        return {r[1] for r in self.rows}

    def uses(self) -> set:
        vals = set()
        for frm, to in self.diff.values():
            vals.add(frm)
            vals.add(to)
        return (vals | self.made()) - {0}


class StepOracle:
    def __init__(self, n: int) -> None:
        self.n = n
        self.steps: list[Step] = []
        self.cursor = 0
        self.next_sid = 0
        self.names: dict[int, str | None] = {}
        self.lid = [0] * n
        self.order: list[int] = []  # row ids in stored order
        self.attrs: dict[int, dict] = {}
        self.stats = {"layer_undone": 0, "delete_refused": 0}

    # -- views
    def active(self) -> set:
        gone: set = set()
        for st in self.steps[: self.cursor]:
            if st.kind == "delete":
                gone |= st.ids
        return set(range(self.n)) - gone

    def rows_view(self) -> list:
        return [(k, self.attrs[k]["name"]) for k in self.order]

    def row_ids(self) -> set:
        return set(self.order)

    def lowest_free(self) -> int:
        return next(k for k in range(1, 256) if k not in self.attrs)

    def members(self, k: int, act: set | None = None) -> set:
        act = self.active() if act is None else act
        return {i for i in act if self.lid[i] == k}

    # -- pushing
    def _push(self, st: Step) -> None:
        self.steps = self.steps[: self.cursor] + [st]
        self.names = {s.sid: self.names.get(s.sid) for s in self.steps}
        self.names[st.sid] = None
        self.next_sid += 1
        self.cursor = len(self.steps)

    def apply(self, ids) -> None:
        self._push(Step(self.next_sid, "delete", set(ids)))

    def _commit(self, new_lid: list, rows: list) -> None:
        diff = {
            i: (self.lid[i], new_lid[i])
            for i in range(self.n)
            if self.lid[i] != new_lid[i]
        }
        if not diff and not rows:
            return
        st = Step(self.next_sid, "layer", set(diff), diff, rows)
        self._push(st)  # the tail is dropped first, as the engine does
        self.lid = new_lid

    # -- layer edits (each returns nothing; an empty diff pushes nothing)
    def create(self, moved, name, visible=True, protected=False) -> int:
        k = self.lowest_free()
        new = list(self.lid)
        for i in moved:
            new[i] = k
        attrs = {"name": name, "visible": visible, "protected": protected}
        row = [len(self.order), k, True, dict(attrs)]
        self.attrs[k] = attrs
        self.order.append(k)
        self._commit(new, [row])
        return k

    def assign(self, moved, target: int) -> None:
        new = list(self.lid)
        for i in moved:
            new[i] = target
        self._commit(new, [])

    def set_members(self, k: int, moved) -> None:
        moved = set(moved)
        new = list(self.lid)
        for i in self.members(k) - moved:
            new[i] = 0
        for i in moved:
            new[i] = k
        self._commit(new, [])

    def _remove_row(self, k: int) -> list:
        row = [self.order.index(k), k, False, dict(self.attrs[k])]
        self.order.remove(k)
        del self.attrs[k]
        return row

    def merge(self, src: int, dst: int) -> None:
        new = [dst if x == src else x for x in self.lid]
        row = self._remove_row(src)
        self._commit(new, [row])

    def to_main(self, k: int) -> None:
        new = [0 if x == k else x for x in self.lid]
        row = self._remove_row(k)
        self._commit(new, [row])

    def patch(self, k: int, **kw) -> None:
        self.attrs[k].update(kw)  # settings are not steps

    # -- flips
    def _insert(self, index: int, k: int, attrs: dict) -> None:
        self.order.insert(min(index, len(self.order)), k)
        self.attrs[k] = dict(attrs)

    def _flip_back(self, st: Step) -> None:
        if st.kind != "layer":
            return
        for i, (frm, to) in st.diff.items():
            assert self.lid[i] == to, (st.sid, i, self.lid[i], to)
            self.lid[i] = frm
        for row in reversed(st.rows):
            index, k, created, _ = row
            if created:
                row[3] = dict(self.attrs[k])  # P3: snapshot what the user saw
                self.order.remove(k)
                del self.attrs[k]
            else:
                assert k not in self.attrs, ("row present", st.sid, k)
                self._insert(index, k, row[3])
        self.stats["layer_undone"] += 1

    def _flip_fwd(self, st: Step) -> None:
        if st.kind != "layer":
            return
        for i, (frm, to) in st.diff.items():
            assert self.lid[i] == frm, (st.sid, i, self.lid[i], frm)
            self.lid[i] = to
        for row in st.rows:
            index, k, created, _ = row
            if created:
                assert k not in self.attrs, ("row present", st.sid, k)
                self._insert(index, k, row[3])
            else:
                row[3] = dict(self.attrs[k])
                self.order.remove(k)
                del self.attrs[k]

    def rollback(self, cursor: int) -> None:
        old = self.cursor
        if cursor < old:
            for st in reversed(self.steps[cursor:old]):
                self._flip_back(st)
        else:
            for st in self.steps[old:cursor]:
                self._flip_fwd(st)
        self.cursor = cursor

    def undo(self) -> None:
        self.rollback(self.cursor - 1)

    def redo(self) -> None:
        self.rollback(self.cursor + 1)

    # -- deleting a step
    def index_of(self, sid: int) -> int:
        return [s.sid for s in self.steps].index(sid)

    def deletable(self, sid: int) -> bool:
        i = self.index_of(sid)
        e = self.steps[i]
        if e.kind != "layer":
            return True
        for later in self.steps[i + 1 :]:
            if later.kind != "layer":
                continue
            if (
                (later.ids & e.ids)
                or (later.made() & e.uses())
                or (e.made() & later.uses())
            ):
                return False
        return True

    def delete_step(self, sid: int) -> bool:
        """False when refused (a later layer step builds on this one)."""
        if not self.deletable(sid):
            self.stats["delete_refused"] += 1
            return False
        i = self.index_of(sid)
        e = self.steps[i]
        applied = i < self.cursor
        if applied:
            self._flip_back(e)
        self.steps.pop(i)
        del self.names[sid]
        if applied:
            self.cursor -= 1
        self.assert_replay_matches()
        return True

    # -- soundness
    def replayed(self) -> tuple[list, set]:
        """Applied layer steps replayed from the initial state."""
        scratch = StepOracle(self.n)
        scratch.steps = copy.deepcopy(self.steps)
        scratch.cursor = 0
        scratch.rollback(self.cursor)
        return scratch.lid, scratch.row_ids()

    def assert_replay_matches(self) -> None:
        lid, rows = self.replayed()
        assert lid == self.lid, "replay: per-point layers differ"
        assert rows == self.row_ids(), "replay: row ids differ"
        assert set(self.lid) - {0} <= self.row_ids()  # no dangling id
