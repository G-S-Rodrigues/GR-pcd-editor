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


# ---- Part 19: layer steps -------------------------------------------------


def u8(*v):
    return np.array(v, dtype=np.uint8)


def row(index, k, created=True):
    from gr_pcd.editing.history import LayerRowChange
    from gr_pcd.editing.layers import Layer

    return LayerRowChange(index, Layer(k, f"L{k}", 0), created)


def push_layer(h, ids, frm, to, rows=(), desc="layer edit"):
    h.push(
        "layer",
        desc,
        u(*ids),
        tool="layer",
        frm=u8(*frm),
        to=u8(*to),
        rows=tuple(rows),
    )


def test_hst_23_push_layer_stores_diff_and_discards_the_redo_tail():
    h = three()
    h.rollback(2)
    push_layer(h, (3, 4), (0, 0), (1, 1), [row(0, 1)])
    assert [e.sid for e in h.entries] == [0, 1, 3]
    e = h.entries[-1]
    assert (e.kind, e.tool, e.shape) == ("layer", "layer", None)
    assert e.frm.tolist() == [0, 0] and e.to.tolist() == [1, 1]
    assert [r.layer.id for r in e.rows] == [1] and e.rows[0].created
    assert h.cursor == 3


def test_hst_24_a_layer_push_costs_six_bytes_per_id():
    h = History(budget_bytes=12)
    push_layer(h, (1, 2), (0, 0), (1, 1))  # 12 bytes: fits exactly
    with pytest.raises(EditError) as exc:
        push_layer(h, (3,), (0,), (1,))
    assert exc.value.code == "history_budget_exceeded"
    assert len(h.entries) == 1 and h.cursor == 1 and h.next_sid == 1
    h2 = History(budget_bytes=11)
    with pytest.raises(EditError) as exc:
        push_layer(h2, (1, 2), (0, 0), (1, 1))
    assert exc.value.code == "history_budget_exceeded" and not h2.entries


def test_hst_25_step_caps_apply_to_layer_pushes():
    h = History()
    for i in range(hist.MAX_STEPS):
        push_layer(h, (i,), (0,), (1,))
    with pytest.raises(EditError) as exc:
        push_layer(h, (9999,), (0,), (1,))
    assert exc.value.code == "too_many_steps"
    h2 = History()
    h2.next_sid = hist.MAX_SID
    with pytest.raises(EditError) as exc:
        push_layer(h2, (1,), (0,), (1,))
    assert exc.value.code == "too_many_steps"


def test_hst_26_kind_and_tool_must_pair():
    h = History()
    with pytest.raises(EditError) as exc:
        h.push("layer", "x", u(1), tool="box", frm=u8(0), to=u8(1))
    assert exc.value.code == "invalid_tool"
    with pytest.raises(EditError) as exc:
        h.push("delete", "x", u(1), tool="layer")
    assert exc.value.code == "invalid_tool"
    assert not h.entries and h.next_sid == 0


def test_hst_27_dependents_rule():
    h = History()
    push_layer(h, (1, 2), (0, 0), (1, 1), [row(0, 1)])  # sid 0 creates 1
    h.push("delete", "d", u(1, 2), tool="box")  # sid 1: never blocks
    push_layer(h, (3,), (0,), (1,))  # sid 2: assign into 1
    push_layer(h, (9,), (0,), (2,), [row(1, 2)])  # sid 3: creates 2
    push_layer(h, (10,), (0,), (3,), [row(2, 3)])  # sid 4: creates 3
    push_layer(h, (11,), (3,), (0,))  # sid 5: leaves layer 3
    assert h.dependents(0) == [2]  # later step uses the row it made
    assert h.dependents(2) == []  # last user of layer 1
    assert h.dependents(3) == []  # nothing later uses 2
    assert h.dependents(4) == [5]  # shares layer 3
    assert h.dependents(1) == []  # a deletion step is never blocked
    # an earlier step using a row a later step made
    h2 = History()
    push_layer(h2, (1,), (4,), (0,), [row(0, 4, created=False)])
    push_layer(h2, (2,), (0,), (4,), [row(0, 4)])
    assert h2.dependents(0) == [1]
    # disjoint assigns into one existing layer are independent
    h3 = History()
    push_layer(h3, (1,), (0,), (7,))
    push_layer(h3, (2,), (0,), (7,))
    assert h3.dependents(0) == [] and h3.dependents(1) == []
    # shared ids block
    push_layer(h3, (1,), (7,), (0,))
    assert h3.dependents(0) == [2]
    # greyed later steps count
    h3.rollback(0)
    assert h3.dependents(0) == [2]


def test_hst_28_replace_keeps_index_and_cursor():
    h = three()
    h.rollback(2)
    e = h.entries[1]
    from dataclasses import replace as dc_replace

    h.replace(e.sid, dc_replace(e, description="new"))
    assert [x.sid for x in h.entries] == [0, 1, 2] and h.cursor == 2
    assert h.entries[1].description == "new"
    assert h.rename_step(1, " n ").name == "n"
    assert h.entries[1].description == "new"
    with pytest.raises(EditError) as exc:
        h.replace(99, e)
    assert exc.value.code == "no_such_step"


def test_hst_29_tools_hold_layer():
    assert "layer" in hist.TOOLS


def test_hst_30_old_positional_construction_still_works():
    e = hist.HistoryEntry("delete", "d", u(1), 3, "box", None, None)
    assert e.frm is None and e.to is None and e.rows == ()
