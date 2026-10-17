"""EDT-01..16: selection algebra, scope, protection and candidates."""

import numpy as np
import pytest

from gr_pcd.editing.candidate import candidate_deletion
from gr_pcd.editing.errors import EditError
from gr_pcd.editing.protection import (
    Interval,
    OperationProtection,
    ProtectionState,
    effective_intervals,
    protected_mask,
    validate_protection,
)
from gr_pcd.editing.selection import (
    combine_selection,
    filter_operand,
    read_selection,
    scope_mask,
)
from gr_pcd.geometry.errors import GeometryError

N = 10


def mask(*ids, n=N):
    m = np.zeros(n, dtype=bool)
    m[list(ids)] = True
    return m


def ids(m):
    return set(np.flatnonzero(m).tolist())


SCOPE = mask(*range(8))  # points 8, 9 are outside the scope


def test_edt_01_algebra():
    cur, opd = mask(0, 1, 2), mask(2, 3, 4)
    assert ids(combine_selection(cur, opd, "replace", SCOPE)) == {2, 3, 4}
    assert ids(combine_selection(cur, opd, "add", SCOPE)) == {0, 1, 2, 3, 4}
    assert ids(combine_selection(cur, opd, "subtract", SCOPE)) == {0, 1}
    assert ids(combine_selection(cur, opd, "intersect", SCOPE)) == {2}


def test_edt_02_operand_clipped_to_scope():
    cur, opd = mask(0), mask(8, 9, 5)
    assert ids(combine_selection(cur, opd, "add", SCOPE)) == {0, 5}
    assert ids(combine_selection(cur, opd, "replace", SCOPE)) == {5}


def test_edt_03_invert_relative_to_scope():
    cur = mask(0, 1)
    got = combine_selection(cur, mask(), "invert", SCOPE)
    assert ids(got) == {2, 3, 4, 5, 6, 7}
    smaller = mask(0, 1, 2, 3)
    assert ids(combine_selection(cur, mask(), "invert", smaller)) == {2, 3}


def test_edt_04_scope_masks():
    active = ~mask(1)
    valid = ~mask(2)
    display = ~mask(3)
    shown = scope_mask("displayed", active, valid, display)
    assert ids(shown) == set(range(N)) - {1, 2, 3}
    act = scope_mask("active", active, valid, display)
    assert ids(act) == set(range(N)) - {1, 2}
    with pytest.raises(EditError):
        scope_mask("nope", active, valid, display)


def test_edt_05_filter_operand_is_every_displayed_point():
    n = 5000
    active = np.ones(n, dtype=bool)
    valid = np.ones(n, dtype=bool)
    display = np.ones(n, dtype=bool)
    display[::7] = False
    got = filter_operand(active, valid, display)
    assert int(got.sum()) == int(display.sum())


def test_edt_06_selection_read_excludes_deleted_and_invalid():
    sel = mask(0, 1, 2)
    assert ids(read_selection(sel, ~mask(1), ~mask(2))) == {0}


XYZ = np.array([[0, 0, z] for z in (-1.0, -0.05, 0.0, 0.10, 0.11, 1.0, 2.0)])
XYZ = np.vstack([XYZ, [[0, 0, np.nan]]])
VALID = np.isfinite(XYZ).all(axis=1)
NN = len(XYZ)


def m(*i):
    return mask(*i, n=NN)


def test_edt_10_global_protection_inclusive():
    st = ProtectionState(global_=Interval(True, -0.05, 0.10))
    p = protected_mask(XYZ, VALID, effective_intervals(st))
    assert ids(p) == {1, 2, 3}
    assert effective_intervals(ProtectionState()) == []


def test_edt_11_add_local_is_union():
    st = ProtectionState(
        global_=Interval(True, -0.05, 0.10),
        operation=OperationProtection("add_local", (1.0, 1.0)),
    )
    p = protected_mask(XYZ, VALID, effective_intervals(st))
    assert ids(p) == {1, 2, 3, 5}
    sel = m(*range(7))
    res = candidate_deletion(XYZ, ~m(), VALID, sel, p, ~m())
    assert ids(np.isin(np.arange(NN), res.ids)) == {0, 4, 6}


def test_edt_12_override_needs_ack_and_replaces():
    st = ProtectionState(
        global_=Interval(True, -0.05, 0.10),
        operation=OperationProtection("override", (1.0, 2.0)),
    )
    with pytest.raises(GeometryError) as exc:
        validate_protection(st)
    assert exc.value.code == "override_not_acknowledged"
    st = ProtectionState(
        global_=st.global_,
        operation=OperationProtection("override", (1.0, 2.0), True),
    )
    p = protected_mask(XYZ, VALID, effective_intervals(st))
    assert ids(p) == {5, 6}
    # reset to inherit: the global applies again
    back = ProtectionState(global_=st.global_)
    p = protected_mask(XYZ, VALID, effective_intervals(back))
    assert ids(p) == {1, 2, 3}


def test_edt_13_protection_beats_inversion():
    st = ProtectionState(global_=Interval(True, -0.05, 0.10))
    p = protected_mask(XYZ, VALID, effective_intervals(st))
    scope = scope_mask("active", ~m(), VALID, ~m())
    sel = combine_selection(m(0), m(), "invert", scope)
    res = candidate_deletion(XYZ, ~m(), VALID, sel, p, ~m())
    assert set(res.ids.tolist()) == {4, 5, 6}


def test_edt_14_candidate_counts():
    st = ProtectionState(global_=Interval(True, -0.05, 0.10))
    p = protected_mask(XYZ, VALID, effective_intervals(st))
    display = ~m(6)  # point 6 is outside the display filter
    sel = m(0, 2, 4, 6)
    res = candidate_deletion(XYZ, ~m(), VALID, sel, p, display)
    assert res.ids.tolist() == [0, 4, 6]
    assert res.ids.dtype == np.uint32
    assert res.selected_active == 4
    assert res.protected_retained == 1
    assert res.candidates == 3
    assert res.selected_outside_display_filter == 1
    assert res.bounds == ((0.0, 0.0, -1.0), (0.0, 0.0, 2.0))
    # deleted points are never candidates
    res2 = candidate_deletion(XYZ, ~m(0), VALID, sel, p, display)
    assert res2.ids.tolist() == [4, 6]


def test_edt_15_invalid_never_protected_or_candidate():
    st = ProtectionState(global_=Interval(True, -100, 100))
    p = protected_mask(XYZ, VALID, effective_intervals(st))
    assert not p[7]
    res = candidate_deletion(XYZ, ~m(), VALID, m(7), m(), ~m())
    assert res.ids.tolist() == [] and res.bounds is None


@pytest.mark.parametrize(
    "st",
    [
        ProtectionState(global_=Interval(True, 1, 0)),
        ProtectionState(global_=Interval(True, float("nan"), 0)),
        ProtectionState(operation=OperationProtection("add_local", None)),
        ProtectionState(operation=OperationProtection("add_local", (2, 1))),
        ProtectionState(operation=OperationProtection("bogus", (1, 2))),
    ],
)
def test_edt_16_protection_validation(st):
    with pytest.raises(GeometryError) as exc:
        validate_protection(st)
    assert exc.value.code == "invalid_protection"
