"""LAY-01..08: the pure layer model (part 15b-1); no session, no HTTP."""

import numpy as np
import pytest

from gr_pcd.editing.errors import EditError
from gr_pcd.editing.layers import (
    MAX_LAYERS,
    MAX_NAME,
    Layer,
    assign,
    clean_layer_name,
    counts_by_layer,
    delete_layer,
    from_other_layers,
    hidden_points,
    lowest_free_id,
    members,
    next_colour,
)


def mask(n, *ids):
    m = np.zeros(n, dtype=bool)
    m[list(ids)] = True
    return m


def test_lay_01_assign_sets_ids_and_creates_the_array_lazily():
    out = assign(None, mask(6, 1, 4), 3, 6)
    assert out.dtype == np.uint8 and out.tolist() == [0, 3, 0, 0, 3, 0]
    again = assign(out, mask(6, 0, 4), 2, 6)
    assert again.tolist() == [2, 3, 0, 0, 2, 0]


def test_lay_02_members_are_active_points_only():
    layer = assign(None, mask(5, 0, 1, 2), 1, 5)
    active = mask(5, 0, 2, 3, 4)
    assert members(layer, active, 1).tolist() == [
        True,
        False,
        True,
        False,
        False,
    ]
    assert not members(None, active, 1).any()


def test_lay_03_release_to_main_is_assign_zero():
    layer = assign(None, mask(4, 0, 1, 2), 2, 4)
    assert assign(layer, mask(4, 1), 0, 4).tolist() == [2, 0, 2, 0]


def test_lay_04_delete_layer_resets_deleted_points_too():
    layer = np.array([1, 2, 1, 0, 2], dtype=np.uint8)
    out = delete_layer(layer, 1)
    assert out.tolist() == [0, 2, 0, 0, 2]
    assert layer.tolist() == [1, 2, 1, 0, 2]
    assert delete_layer(None, 1) is None


def test_lay_05_lowest_free_id_is_reused_and_colours_are_the_lowest_unused():
    ls = [Layer(1, "a", 0, True), Layer(3, "b", 1, True)]
    assert lowest_free_id(ls) == 2
    assert lowest_free_id([]) == 1
    assert next_colour(ls) == 2
    assert next_colour([]) == 0
    # all 16 colours taken: cycle by the layer count
    full = [Layer(i + 1, f"l{i}", i, True) for i in range(16)]
    assert next_colour(full) == 0
    assert next_colour(full + [Layer(17, "x", 0, True)]) == 1


def test_lay_06_at_most_32_layers():
    ls = [Layer(i + 1, f"l{i}", i % 16, True) for i in range(MAX_LAYERS)]
    with pytest.raises(EditError) as err:
        lowest_free_id(ls)
    assert err.value.code == "too_many_layers"
    assert lowest_free_id(ls[:-1]) == MAX_LAYERS


@pytest.mark.parametrize(
    "bad",
    ["", "   ", "x" * (MAX_NAME + 1), "a\nb", "tab\there", "del\x7f", 5, None],
)
def test_lay_07_bad_names_are_invalid_name(bad):
    with pytest.raises(EditError) as err:
        clean_layer_name(bad)
    assert err.value.code == "invalid_name"


def test_lay_07b_good_names_are_stripped_and_keep_unicode():
    assert clean_layer_name("  Floor  ") == "Floor"
    assert clean_layer_name("x" * MAX_NAME) == "x" * MAX_NAME
    assert clean_layer_name("Boden äö") == "Boden äö"


def test_lay_08_results_are_new_read_only_arrays_and_inputs_stay_untouched():
    layer = assign(None, mask(4, 0), 1, 4)
    out = assign(layer, mask(4, 1), 2, 4)
    assert out is not layer and not out.flags.writeable
    assert layer.tolist() == [1, 0, 0, 0] and not layer.flags.writeable
    assert not delete_layer(out, 1).flags.writeable
    # bookkeeping helpers
    assert from_other_layers(out, mask(4, 0, 1, 2), 2) == 1  # only id 1 at 0
    assert from_other_layers(None, mask(4, 0), 1) == 0
    assert counts_by_layer(out, mask(4, 0, 1, 3)).tolist()[:3] == [1, 1, 1]
    ls = [Layer(1, "a", 0, False), Layer(2, "b", 1, True)]
    hid = hidden_points(out, ls)
    assert hid.tolist() == [True, False, False, False]
    assert hidden_points(out, [Layer(2, "b", 1, True)]) is None
    assert hidden_points(None, ls) is None
