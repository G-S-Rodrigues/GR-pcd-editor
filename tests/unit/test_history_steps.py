"""HST-01..07: History steps (sid, rollback, delete, rename, caps)."""

import numpy as np
import pytest

from gr_pcd.editing import history as hist
from gr_pcd.editing.errors import EditError
from gr_pcd.editing.history import History


def u(*v):
    return np.array(v, dtype=np.uint32)


def three():
    h = History()
    h.push("delete", "a", u(1, 2), tool="box")
    h.push("delete", "b", u(5), tool="prism")
    h.push("delete", "c", u(7, 8, 9))
    return h


def test_hst_01_sids_are_monotonic_and_never_reused():
    h = three()
    assert [e.sid for e in h.entries] == [0, 1, 2]
    assert h.next_sid == 3
    h.delete_step(2)
    h.push("delete", "d", u(20))
    assert [e.sid for e in h.entries] == [0, 1, 3]
    assert h.entries[0].tool == "box"


def test_hst_02_rollback_returns_entries_to_flip_and_bounds():
    h = three()
    entries, back = h.rollback(1)
    assert back and [e.sid for e in entries] == [1, 2] and h.cursor == 1
    entries, back = h.rollback(3)
    assert not back and [e.sid for e in entries] == [1, 2] and h.cursor == 3
    assert h.rollback(3) == ([], False)
    for bad in (-1, 4):
        with pytest.raises(EditError) as exc:
            h.rollback(bad)
        assert exc.value.code == "invalid_cursor"
    assert h.cursor == 3


def test_hst_03_undo_redo_are_rollback_by_one():
    h = three()
    e = h.undo()
    assert e is h.entries[2] and h.cursor == 2
    assert h.redo() is e and h.cursor == 3
    h.rollback(0)
    with pytest.raises(EditError):
        h.undo()


def test_hst_04_delete_step_applied_and_greyed():
    h = three()
    entry, applied = h.delete_step(1)
    assert applied and entry.ids.tolist() == [5] and h.cursor == 2
    h.rollback(0)
    entry, applied = h.delete_step(2)
    assert not applied and h.cursor == 0
    assert [e.sid for e in h.entries] == [0]
    with pytest.raises(EditError) as exc:
        h.delete_step(99)
    assert exc.value.code == "no_such_step"


def test_hst_05_rename_trims_clears_and_rejects():
    h = three()
    assert h.rename_step(0, "  cut walls ").name == "cut walls"
    assert h.entries[0].name == "cut walls"
    assert h.rename_step(0, "   ").name is None
    assert h.rename_step(1, "x" * 80).name == "x" * 80
    for bad in ("x" * 81, "a\nb", "a\x00", "a\tb"):
        with pytest.raises(EditError) as exc:
            h.rename_step(0, bad)
        assert exc.value.code == "invalid_name"
    with pytest.raises(EditError) as exc:
        h.rename_step(42, "n")
    assert exc.value.code == "no_such_step"
    assert hist.clean_name(None) is None


def test_hst_06_push_after_rollback_discards_greyed_steps():
    h = three()
    h.rollback(1)
    h.push("delete", "d", u(30))
    assert [e.sid for e in h.entries] == [0, 3] and h.cursor == 2
    assert len({e.sid for e in h.entries}) == 2


def test_hst_07_budget_and_step_cap():
    h = History(budget_bytes=12)
    h.push("delete", "a", u(1, 2, 3))
    with pytest.raises(EditError) as exc:
        h.push("delete", "b", u(4))
    assert exc.value.code == "history_budget_exceeded"
    h.delete_step(0)  # frees the bytes
    h.push("delete", "b", u(4, 5, 6))
    full = History()
    for i in range(hist.MAX_STEPS):
        full.push("delete", "s", u(i))
    with pytest.raises(EditError) as exc:
        full.push("delete", "s", u(hist.MAX_STEPS))
    assert exc.value.code == "too_many_steps"
