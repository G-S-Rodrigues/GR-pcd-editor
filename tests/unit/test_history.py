"""EDT-30..37: history, remove-invalid and revision tickets."""

import numpy as np
import pytest

from gr_pcd.editing.errors import EditError
from gr_pcd.editing.history import History, RevisionClock, with_ids
from gr_pcd.editing.invalid import remove_invalid


def ids(m):
    return np.flatnonzero(m).tolist()


def test_edt_30_push_undo_redo_restore_exact_sets():
    records = np.arange(10, dtype=np.float32)
    before = records.tobytes()
    h = History()
    active = np.ones(10, dtype=bool)
    a1 = with_ids(active, np.array([1, 2], np.uint32), False)
    h.push("delete", "first", np.array([1, 2]))
    a2 = with_ids(a1, np.array([5], np.uint32), False)
    h.push("delete", "second", np.array([5]))
    assert ids(~a2) == [1, 2, 5]
    entry = h.undo()
    cur = with_ids(a2, entry.ids, True)
    assert ids(~cur) == [1, 2]
    cur = with_ids(cur, h.undo().ids, True)
    assert ids(~cur) == []
    cur = with_ids(cur, h.redo().ids, False)
    cur = with_ids(cur, h.redo().ids, False)
    assert ids(~cur) == [1, 2, 5]
    assert records.tobytes() == before
    assert active.all()  # original array untouched (copy-on-write)


def test_edt_31_new_edit_clears_redo_tail():
    h = History()
    h.push("delete", "Deleted 1 points", np.array([1]))
    h.push("delete", "Deleted 2 points", np.array([2, 3]))
    h.undo()
    assert h.can_redo
    h.push("delete", "other", np.array([9]))
    assert not h.can_redo
    assert [e.description for e in h.entries] == ["Deleted 1 points", "other"]
    assert [len(e.ids) for e in h.entries] == [1, 1]


def test_edt_32_undo_redo_bounds():
    h = History()
    with pytest.raises(EditError) as exc:
        h.undo()
    assert exc.value.code == "nothing_to_undo"
    with pytest.raises(EditError) as exc:
        h.redo()
    assert exc.value.code == "nothing_to_redo"


def test_edt_33_remove_invalid():
    valid = np.array([True, False, True, False])
    active = np.ones(4, dtype=bool)
    h = History()
    new = remove_invalid(active, valid, h)
    assert ids(~new) == [1, 3]
    assert h.entries[0].kind == "remove_invalid"
    with pytest.raises(EditError) as exc:
        remove_invalid(new, valid, h)
    assert exc.value.code == "nothing_to_remove"
    assert ids(with_ids(new, h.undo().ids, True)) == [0, 1, 2, 3]


def test_edt_34_history_budget_exceeded_changes_nothing():
    h = History(budget_bytes=16)
    h.push("delete", "a", np.arange(4))
    with pytest.raises(EditError) as exc:
        h.push("delete", "b", np.arange(1))
    assert exc.value.code == "history_budget_exceeded"
    assert len(h.entries) == 1 and h.cursor == 1


def test_edt_35_37_revision_tickets():
    clock = RevisionClock()
    t = clock.ticket()
    assert clock.is_current(t)
    clock.bump_params()
    assert not clock.is_current(t)
    t = clock.ticket()
    assert clock.is_current(t)
    clock.bump_cloud()
    assert not clock.is_current(t)
    assert clock.ticket() == (2, 3)
    # a stale compute commits nothing
    state = {"selection": "old"}
    ticket = clock.ticket()
    clock.bump_params()
    result = "new"
    if clock.is_current(ticket):
        state["selection"] = result
    assert state["selection"] == "old"
