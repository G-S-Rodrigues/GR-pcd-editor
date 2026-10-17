"""PCD-01..20: PCD parsing against independently built bytes."""

import math

import numpy as np
import pytest

from fixtures.pcdgen import (
    LZF_GOLDEN,
    LZF_GOLDEN_EXPECTED,
    MIXED_FIELDS,
    MIXED_ROWS,
    MIXED_VALID,
    build_pcd,
    lzf_literal,
    xyz_fields,
)
from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.header import parse_header
from gr_pcd.pcd.lzf import lzf_decompress
from gr_pcd.pcd.model import valid_mask, xyz64
from gr_pcd.pcd.reader import read_pcd
from gr_pcd.session.budget import estimate_bytes


def _same(a, b):
    if isinstance(a, float) and math.isnan(a):
        return isinstance(b, float) and math.isnan(b)
    return a == b


def assert_rows(cloud, rows, fields=MIXED_FIELDS):
    assert cloud.n == len(rows)
    for k, spec in enumerate(fields):
        col = cloud.records[f"c{k}"]
        for r, row in enumerate(rows):
            got = col[r]
            if spec[3] > 1:
                assert [int(v) for v in got] == list(row[k])
            else:
                assert _same(float(got), float(row[k])), (spec[0], r)


def test_pcd_01_lzf_golden_vector():
    out = lzf_decompress(LZF_GOLDEN, len(LZF_GOLDEN_EXPECTED))
    assert out == LZF_GOLDEN_EXPECTED


def test_pcd_02_lzf_literal_only():
    data = bytes(range(100))
    assert lzf_decompress(lzf_literal(data), 100) == data


@pytest.mark.parametrize(
    "stream,size",
    [
        (bytes([0x20, 0x05]), 4),  # reference before start
        (bytes([0x02, 1, 2, 3]), 2),  # output overrun
        (bytes([0x05, 1, 2]), 6),  # short literal run
        (bytes([0x00, 1, 0x20]), 3),  # missing offset byte
        (bytes([0x00, 1]), 5),  # decoded size mismatch
    ],
)
def test_pcd_03_lzf_corrupt(stream, size):
    with pytest.raises(PcdError) as exc:
        lzf_decompress(stream, size)
    assert exc.value.code == "bad_compression"


@pytest.mark.parametrize("enc", ["ascii", "binary", "binary_compressed"])
def test_pcd_04_05_06_mixed_all_encodings(enc):
    cloud = read_pcd(build_pcd(MIXED_FIELDS, MIXED_ROWS, enc))
    assert_rows(cloud, MIXED_ROWS)
    assert [
        (s.name, s.type, s.size, s.count) for s in cloud.schema
    ] == MIXED_FIELDS
    assert cloud.encoding == enc


def test_pcd_05_packed_rgb_bits_identical():
    rows = [(1.0, 2.0, 3.0, 0.0, 0.0, 0, 0.0, (0, 0, 0), 0, 0)]
    cloud = read_pcd(build_pcd(MIXED_FIELDS, rows, "binary"))
    cloud2 = read_pcd(build_pcd(MIXED_FIELDS, rows, "binary_compressed"))
    assert cloud.records.tobytes() == cloud2.records.tobytes()


def test_pcd_06_compressed_equals_binary():
    a = read_pcd(build_pcd(MIXED_FIELDS, MIXED_ROWS, "binary"))
    b = read_pcd(build_pcd(MIXED_FIELDS, MIXED_ROWS, "binary_compressed"))
    assert a.records.tobytes() == b.records.tobytes()


def test_pcd_04_ascii_minus_nan():
    fields = xyz_fields()
    data = build_pcd(fields, [(1.0, 2.0, 3.0)], "ascii").replace(
        b"1.0 2.0 3.0", b"-nan nan 3.0"
    )
    cloud = read_pcd(data)
    assert np.isnan(cloud.records["c0"][0]) and np.isnan(cloud.records["c1"][0])


def test_pcd_07_header_fields_captured():
    data = build_pcd(
        xyz_fields(),
        [(0.0, 0.0, 0.0)] * 6,
        "binary",
        width=3,
        height=2,
        viewpoint="1 2 3 1 0 0 0",
        version="0.7",
    )
    cloud = read_pcd(data)
    assert (cloud.width, cloud.height) == (3, 2)
    assert cloud.viewpoint == ("1", "2", "3", "1", "0", "0", "0")
    assert cloud.version == "0.7"


def test_pcd_07_defaults_when_absent():
    data = build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)], "ascii", with_count=False)
    data = data.replace(b"VIEWPOINT 0 0 0 1 0 0 0\n", b"")
    cloud = read_pcd(data)
    assert cloud.viewpoint == ("0", "0", "0", "1", "0", "0", "0")
    assert [s.count for s in cloud.schema] == [1, 1, 1]


def test_pcd_08_invalid_xyz_kept_and_masked():
    cloud = read_pcd(build_pcd(MIXED_FIELDS, MIXED_ROWS, "binary"))
    valid = valid_mask(xyz64(cloud))
    assert valid.tolist() == MIXED_VALID
    assert cloud.n == 6
    assert int((~valid).sum()) == 3


def _fields_without(name):
    return [f for f in MIXED_FIELDS if f[0] != name]


def _rows_without(idx):
    return [tuple(v for k, v in enumerate(r) if k != idx) for r in MIXED_ROWS]


def _expect(data, code):
    with pytest.raises(PcdError) as exc:
        read_pcd(data)
    assert exc.value.code == code


def test_pcd_09_no_z():
    _expect(
        build_pcd(_fields_without("z"), _rows_without(2), "binary"),
        "missing_xyz",
    )


def test_pcd_10_duplicate_x():
    fields = MIXED_FIELDS[:3] + [("x", "F", 4, 1)]
    _expect(build_pcd(fields, [(1.0, 2.0, 3.0, 4.0)], "binary"), "missing_xyz")


@pytest.mark.parametrize(
    "x", [("x", "U", 4, 1), ("x", "F", 2, 1), ("x", "F", 4, 2)]
)
def test_pcd_11_bad_xyz_type(x):
    fields = [x, ("y", "F", 4, 1), ("z", "F", 4, 1)]
    val = (1.0, 2.0) if x[3] == 2 else 1
    row = (val, 2.0, 3.0)
    data = build_pcd(fields, [row], "ascii")
    with pytest.raises(PcdError) as exc:
        read_pcd(data)
    assert exc.value.code in ("unsupported_xyz_type", "unsupported_type")


def test_pcd_12_unknown_data():
    data = build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)], "ascii")
    _expect(data.replace(b"DATA ascii", b"DATA fancy"), "unsupported_encoding")


def test_pcd_13_old_version():
    data = build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)], "ascii", version="0.5")
    _expect(data, "unsupported_version")


def test_pcd_14_points_mismatch():
    data = build_pcd(
        xyz_fields(), [(1.0, 2.0, 3.0)] * 2, "binary", width=2, points=3
    )
    _expect(data, "points_mismatch")


def test_pcd_15_truncated_binary():
    data = build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)] * 2, "binary")
    _expect(data[:-1], "truncated")


def test_pcd_15_trailing_garbage_and_whitespace():
    data = build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)] * 2, "binary")
    _expect(data + b"junk", "trailing_data")
    assert read_pcd(data + b"\n  \n").n == 2


def test_pcd_16_ascii_short_tokens():
    data = build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)] * 2, "ascii")
    _expect(data.rstrip()[:-4], "ascii_token_count")


def test_pcd_16_header_too_large_and_no_data():
    data = build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)], "ascii")
    _expect(b"# " + b"x" * 70000 + b"\n" + data, "bad_header")
    _expect(data.replace(b"DATA ascii", b""), "bad_header")


def test_pcd_16_compressed_size_checks():
    data = build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)] * 2, "binary_compressed")
    _expect(data[:-3], "truncated")
    head, _body = data.split(b"DATA binary_compressed\n")
    comp = lzf_literal(b"\0" * 5)
    bad = head + b"DATA binary_compressed\n"
    bad += (len(comp)).to_bytes(4, "little") + (5).to_bytes(4, "little") + comp
    _expect(bad, "bad_compression")


def test_pcd_17_memory_guard_before_allocation():
    data = build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)] * 100, "binary")
    header = parse_header(data)
    assert estimate_bytes(header) == 100 * (12 + 24 + 1 + 1 + 1 + 3)
    with pytest.raises(PcdError) as exc:
        read_pcd(data, budget=1024)
    assert exc.value.code == "memory_budget_exceeded"
    assert read_pcd(data, budget=10**6).n == 100


def test_pcd_18_deterministic_and_readonly():
    data = build_pcd(MIXED_FIELDS, MIXED_ROWS, "ascii")
    a, b = read_pcd(data), read_pcd(data)
    assert a.records.tobytes() == b.records.tobytes()
    assert a.records.flags.writeable is False
    with pytest.raises(ValueError):
        a.records["c0"][0] = 5.0


def test_pcd_19_path_entry_hashes(tmp_path):
    import hashlib

    data = build_pcd(MIXED_FIELDS, MIXED_ROWS, "binary")
    path = tmp_path / "a.pcd"
    path.write_bytes(data)
    cloud = read_pcd(path)
    assert cloud.sha256 == hashlib.sha256(data).hexdigest()
    assert cloud.records.flags.writeable is False
    assert_rows(cloud, MIXED_ROWS)
    asc = tmp_path / "b.pcd"
    asc.write_bytes(build_pcd(MIXED_FIELDS, MIXED_ROWS, "binary_compressed"))
    assert_rows(read_pcd(asc), MIXED_ROWS)


def test_pcd_20_organized_cloud():
    rows = [(float(i), 0.0, 0.0) for i in range(6)]
    cloud = read_pcd(build_pcd(xyz_fields(), rows, "ascii", width=3, height=2))
    assert (cloud.width, cloud.height, cloud.n) == (3, 2, 6)


def test_pcd_ascii_uint64_exact_and_int_range():
    fields = xyz_fields() + [("big", "U", 8, 1), ("s", "I", 1, 1)]
    rows = [(0.0, 0.0, 0.0, 2**64 - 1, -128)]
    cloud = read_pcd(build_pcd(fields, rows, "ascii"))
    assert int(cloud.records["c3"][0]) == 2**64 - 1
    assert int(cloud.records["c4"][0]) == -128
    bad = build_pcd(fields, rows, "ascii").replace(b" -128", b" 200")
    _expect(bad, "ascii_token")
