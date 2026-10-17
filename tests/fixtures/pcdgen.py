"""Independent PCD byte builders for tests.

Deliberately imports nothing from production code: expected bytes and
values are produced here, by hand-written rules.
"""

import math
import struct

_FMT = {
    ("F", 4): "f",
    ("F", 8): "d",
    ("U", 1): "B",
    ("U", 2): "H",
    ("U", 4): "I",
    ("U", 8): "Q",
    ("I", 1): "b",
    ("I", 2): "h",
    ("I", 4): "i",
    ("I", 8): "q",
}
VIEWPOINT0 = "0 0 0 1 0 0 0"

# literal "abc"; copy 7 from offset 2 (overlapping); literal "Z";
# extended-length copy of 12 from offset 10.
LZF_GOLDEN = bytes(
    [0x02, 0x61, 0x62, 0x63] + [0xA0, 0x02] + [0x00, 0x5A] + [0xE0, 0x03, 0x0A]
)
LZF_GOLDEN_EXPECTED = b"abcabcabcaZ" + b"abcabcabcaZa"


def lzf_literal(data: bytes) -> bytes:
    out = bytearray()
    for i in range(0, len(data), 32):
        chunk = data[i : i + 32]
        out.append(len(chunk) - 1)
        out += chunk
    return bytes(out)


def _values(count, value):
    return list(value) if count > 1 else [value]


def _fmt(spec):
    _name, typ, size, count = spec
    return _FMT[(typ, size)] * count


def _ascii_token(typ, v):
    if typ == "F":
        if math.isnan(v):
            return "nan"
        if v in (float("inf"), float("-inf")):
            return "inf" if v > 0 else "-inf"
        return repr(float(v))
    return str(int(v))


def build_pcd(
    fields,
    rows,
    encoding,
    *,
    width=None,
    height=1,
    viewpoint=VIEWPOINT0,
    points=None,
    version=".7",
    with_count=True,
    comment=True,
):
    n = len(rows)
    width = n if width is None else width
    points = width * height if points is None else points
    lines = []
    if comment:
        lines.append("# .PCD v.7 - Point Cloud Data file format")
    lines.append(f"VERSION {version}")
    lines.append("FIELDS " + " ".join(f[0] for f in fields))
    lines.append("SIZE " + " ".join(str(f[2]) for f in fields))
    lines.append("TYPE " + " ".join(f[1] for f in fields))
    if with_count:
        lines.append("COUNT " + " ".join(str(f[3]) for f in fields))
    lines.append(f"WIDTH {width}")
    lines.append(f"HEIGHT {height}")
    lines.append(f"VIEWPOINT {viewpoint}")
    lines.append(f"POINTS {points}")
    lines.append(f"DATA {encoding}")
    head = ("\n".join(lines) + "\n").encode("ascii")
    if encoding == "ascii":
        body = []
        for row in rows:
            toks = []
            for spec, val in zip(fields, row, strict=True):
                toks += [
                    _ascii_token(spec[1], v) for v in _values(spec[3], val)
                ]
            body.append(" ".join(toks))
        return head + ("\n".join(body) + ("\n" if body else "")).encode()
    if encoding == "binary":
        out = bytearray()
        for row in rows:
            for spec, val in zip(fields, row, strict=True):
                out += struct.pack("<" + _fmt(spec), *_values(spec[3], val))
        return head + bytes(out)
    if encoding == "binary_compressed":
        raw = bytearray()
        for k, spec in enumerate(fields):
            for row in rows:
                raw += struct.pack("<" + _fmt(spec), *_values(spec[3], row[k]))
        comp = lzf_literal(bytes(raw))
        return head + struct.pack("<II", len(comp), len(raw)) + comp
    raise ValueError(encoding)


NAN = float("nan")
INF = float("inf")

MIXED_FIELDS = [
    ("x", "F", 4, 1),
    ("y", "F", 4, 1),
    ("z", "F", 4, 1),
    ("intensity", "F", 4, 1),
    ("rgb", "F", 4, 1),
    ("ring", "U", 2, 1),
    ("t", "F", 8, 1),
    ("custom", "I", 4, 3),
    ("_", "U", 1, 1),
    ("_", "U", 1, 1),
]
MIXED_ROWS = [
    (1.0, 2.0, 3.0, 0.5, 1.5, 7, 0.25, (1, -2, 3), 0, 0),
    (-1.5, 0.25, 8.0, 2.0, -0.5, 65535, 1e10, (0, 0, -1), 9, 8),
    (NAN, 1.0, 2.0, 0.0, 0.0, 0, 0.0, (5, 5, 5), 1, 2),
    (3.0, INF, 4.0, 1.0, 1.0, 1, 2.5, (-7, 8, 9), 3, 4),
    (0.5, 0.5, -INF, 3.0, 2.0, 2, 3.5, (100, 200, 300), 5, 6),
    (4.0, 5.0, 6.0, 0.125, 0.75, 3, -4.5, (2147483647, 0, 1), 255, 254),
]
MIXED_VALID = [True, True, False, False, False, True]


def xyz_fields(typ=4):
    return [("x", "F", typ, 1), ("y", "F", typ, 1), ("z", "F", typ, 1)]
