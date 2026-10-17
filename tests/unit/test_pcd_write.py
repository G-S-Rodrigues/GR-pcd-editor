"""PCD-21..30: writer round trips against the independent builder."""

import io
import struct

import numpy as np
import pytest

from fixtures.pcdgen import (
    MIXED_FIELDS,
    MIXED_ROWS,
    build_pcd,
    xyz_fields,
)
from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.reader import read_pcd
from gr_pcd.pcd.writer import verify_written, write_pcd, write_pcd_file


def _dump(cloud, sel=None, fmt="binary", **kw):
    buf = io.BytesIO()
    write_pcd(buf, cloud, sel, fmt, **kw)
    return buf.getvalue()


def _split(data):
    head, _, body = data.partition(b"DATA ")
    body = body.split(b"\n", 1)[1]
    return head.decode().splitlines(), body


def test_pcd_21_binary_round_trip_bit_identical():
    for enc in ("ascii", "binary", "binary_compressed"):
        src = read_pcd(build_pcd(MIXED_FIELDS, MIXED_ROWS, enc))
        back = read_pcd(_dump(src))
        assert back.records.tobytes() == src.records.tobytes()
        assert back.schema == src.schema


def test_pcd_22_bytes_match_independent_builder():
    src = read_pcd(build_pcd(MIXED_FIELDS, MIXED_ROWS, "ascii"))
    got_head, got_body = _split(_dump(src))
    exp_head, exp_body = _split(build_pcd(MIXED_FIELDS, MIXED_ROWS, "binary"))
    assert got_head == exp_head
    assert got_body == exp_body


def test_pcd_23_ascii_round_trip_and_nan_payload_limit():
    src = read_pcd(build_pcd(MIXED_FIELDS, MIXED_ROWS, "binary"))
    text = _dump(src, fmt="ascii")
    assert b"nan" in text and b"inf" in text and b"-inf" in text
    back = read_pcd(text)
    assert back.records.tobytes() == src.records.tobytes()
    # float32 values that need 9 digits
    fields = xyz_fields()
    vals = np.array([0.1, 1 / 3, 16777217.0], dtype=np.float32)
    rows = [(float(v), 0.0, 0.0) for v in vals]
    cloud = read_pcd(build_pcd(fields, rows, "binary"))
    again = read_pcd(_dump(cloud, fmt="ascii"))
    assert again.records.tobytes() == cloud.records.tobytes()
    # quiet NaN with payload in a non-XYZ field is not preserved in ASCII
    fields = xyz_fields() + [("v", "F", 4, 1)]
    raw = build_pcd(fields, [(0.0, 0.0, 0.0, 0.0)], "binary")
    raw = raw[:-4] + struct.pack("<I", 0x7FC00001)
    cloud = read_pcd(raw)
    again = read_pcd(_dump(cloud, fmt="ascii"))
    assert np.isnan(again.records["c3"][0])
    assert again.records.tobytes() != cloud.records.tobytes()
    assert read_pcd(_dump(cloud)).records.tobytes() == cloud.records.tobytes()


def test_pcd_24_all_encodings_to_binary():
    expected = read_pcd(build_pcd(MIXED_FIELDS, MIXED_ROWS, "binary"))
    for enc in ("ascii", "binary_compressed"):
        src = read_pcd(build_pcd(MIXED_FIELDS, MIXED_ROWS, enc))
        assert read_pcd(_dump(src)).records.tobytes() == (
            expected.records.tobytes()
        )


def test_pcd_25_width_height():
    rows = [(float(i), 0.0, 0.0) for i in range(6)]
    src = read_pcd(build_pcd(xyz_fields(), rows, "binary", width=3, height=2))
    head, _ = _split(_dump(src))
    assert "WIDTH 3" in head and "HEIGHT 2" in head and "POINTS 6" in head
    sel = np.array([True, False, True, True, False, False])
    head, _ = _split(_dump(src, sel))
    assert "WIDTH 3" in head and "HEIGHT 1" in head and "POINTS 3" in head
    head, _ = _split(_dump(src, sel, keep_organization=True))
    assert "HEIGHT 2" in head


def test_pcd_26_viewpoint_verbatim():
    vp = "1.5 -2 3 0.7071 0 0.7071 0"
    src = read_pcd(
        build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)], "binary", viewpoint=vp)
    )
    head, _ = _split(_dump(src))
    assert f"VIEWPOINT {vp}" in head
    assert read_pcd(_dump(src, fmt="ascii")).viewpoint == tuple(vp.split())


def test_pcd_27_atomic_and_refusals(tmp_path, monkeypatch):
    import gr_pcd.pcd.writer as w

    src = read_pcd(build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)] * 3, "binary"))
    dest = tmp_path / "out.pcd"

    class Failing(io.BytesIO):
        def write(self, b):
            raise OSError("disk full")

    with pytest.raises(OSError):
        write_pcd(Failing(), src)

    def boom(fh, *a, **k):
        fh.write(b"partial")
        raise OSError("disk full")

    monkeypatch.setattr(w, "write_pcd", boom)
    with pytest.raises(OSError):
        write_pcd_file(dest, src)
    assert list(tmp_path.iterdir()) == []
    monkeypatch.undo()

    assert write_pcd_file(dest, src) == 3
    with pytest.raises(PcdError) as exc:
        write_pcd_file(dest, src)
    assert exc.value.code == "destination_exists"
    assert write_pcd_file(dest, src, overwrite=True) == 3
    with pytest.raises(PcdError) as exc:
        write_pcd_file(dest, src, overwrite=True, source_path=dest)
    assert exc.value.code == "would_overwrite_source"
    assert [p.name for p in tmp_path.iterdir()] == ["out.pcd"]


def test_pcd_28_verify_written(tmp_path):
    src = read_pcd(build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)] * 3, "binary"))
    path = tmp_path / "a.pcd"
    write_pcd_file(path, src)
    verify_written(path, 3, src.schema)
    with pytest.raises(PcdError):
        verify_written(path, 4, src.schema)
    path.write_bytes(path.read_bytes()[:-1])
    with pytest.raises(PcdError) as exc:
        verify_written(path, 3, src.schema)
    assert exc.value.code == "verify_failed"


@pytest.mark.parametrize("fmt", ["ascii", "binary"])
def test_pcd_29_order_and_counts_preserved(fmt):
    src = read_pcd(build_pcd(MIXED_FIELDS, MIXED_ROWS, "binary"))
    back = read_pcd(_dump(src, fmt=fmt))
    assert [s.name for s in back.schema] == [f[0] for f in MIXED_FIELDS]
    assert back.records["c7"].tolist() == [list(r[7]) for r in MIXED_ROWS]


def test_pcd_30_zero_rows():
    src = read_pcd(build_pcd(xyz_fields(), [(1.0, 2.0, 3.0)] * 2, "binary"))
    for fmt in ("binary", "ascii"):
        data = _dump(src, np.zeros(2, dtype=bool), fmt)
        assert b"POINTS 0" in data
        assert read_pcd(data).n == 0
