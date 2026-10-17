"""PCD-00: probes of the numpy/scipy behaviour the PCD code relies on."""

import numpy as np
from scipy.spatial import cKDTree


def test_pcd_00a_ball_query_is_inclusive():
    tree = cKDTree([[0, 0, 0], [0.5, 0, 0], [1.5, 0, 0]])
    assert set(tree.query_ball_point([0, 0, 0], 0.5)) == {0, 1}


def test_pcd_00b_byte_tokens_parse_exactly():
    tokens = np.array([b"nan", b"inf", b"18446744073709551615", b"-3"])
    floats = tokens.astype(np.float64)
    assert np.isnan(floats[0])
    assert np.isinf(floats[1])
    big = np.array([b"18446744073709551615"]).astype(np.uint64)
    assert int(big[0]) == 2**64 - 1


def test_pcd_00c_packed_structured_dtype_round_trips():
    dt = np.dtype(
        [("c0", "<f4"), ("c1", "<u1", (2,)), ("c2", "<f4")], align=False
    )
    assert dt.itemsize == 10
    arr = np.zeros(3, dtype=dt)
    arr["c0"] = [1.5, np.nan, -2]
    arr["c1"] = [[1, 2], [3, 4], [5, 6]]
    arr["c2"] = [np.inf, 0, 7]
    back = np.frombuffer(arr.tobytes(), dtype=dt)
    assert back.tobytes() == arr.tobytes()
    assert back["c1"].shape == (3, 2)
