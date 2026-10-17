"""PCD header parsing."""

from dataclasses import dataclass

from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.model import (
    DEFAULT_VIEWPOINT,
    FieldSpec,
    build_dtype,
    xyz_indices,
)

MAX_HEADER_BYTES = 64 * 1024
ENCODINGS = ("ascii", "binary", "binary_compressed")
_KEYS = {
    "VERSION",
    "FIELDS",
    "SIZE",
    "TYPE",
    "COUNT",
    "WIDTH",
    "HEIGHT",
    "VIEWPOINT",
    "POINTS",
    "DATA",
}


@dataclass(frozen=True)
class PcdHeader:
    version: str
    schema: list[FieldSpec]
    width: int
    height: int
    viewpoint: tuple[str, ...]
    points: int
    encoding: str
    data_offset: int

    @property
    def itemsize(self) -> int:
        return int(build_dtype(self.schema).itemsize)


def _int(key: str, token: str) -> int:
    try:
        value = int(token)
    except ValueError:
        raise PcdError("bad_header", f"{key}: not an integer: {token}")
    if value < 0:
        raise PcdError("bad_header", f"{key}: negative value")
    return value


def parse_header(prefix: bytes) -> PcdHeader:
    """Parse the header from the first bytes of a file."""
    head = prefix[: MAX_HEADER_BYTES + 1]
    values: dict[str, list[str]] = {}
    pos = 0
    data_offset = -1
    while pos < len(head):
        nl = head.find(b"\n", pos)
        if nl < 0:
            break
        raw = head[pos:nl]
        pos = nl + 1
        if pos > MAX_HEADER_BYTES:
            break
        try:
            line = raw.decode("ascii").strip()
        except UnicodeDecodeError:
            raise PcdError("bad_header", "header is not ASCII")
        if not line or line.startswith("#"):
            continue
        tokens = line.split()
        key = tokens[0]
        if key not in _KEYS:
            raise PcdError("bad_header", f"unknown header keyword: {key}")
        if key in values:
            raise PcdError("bad_header", f"duplicate header keyword: {key}")
        values[key] = tokens[1:]
        if key == "DATA":
            data_offset = pos
            break
    if data_offset < 0:
        raise PcdError(
            "bad_header", "no DATA line within the first 64 KiB of the file"
        )

    version = " ".join(values.get("VERSION", [".7"]))
    if version not in (".7", "0.7"):
        raise PcdError("unsupported_version", f"VERSION {version}")

    for key in ("FIELDS", "SIZE", "TYPE"):
        if not values.get(key):
            raise PcdError("bad_header", f"missing {key}")
    names = values["FIELDS"]
    sizes = [_int("SIZE", t) for t in values["SIZE"]]
    types = values["TYPE"]
    counts = (
        [_int("COUNT", t) for t in values["COUNT"]]
        if "COUNT" in values
        else [1] * len(names)
    )
    if not (len(names) == len(sizes) == len(types) == len(counts)):
        raise PcdError("bad_header", "FIELDS/SIZE/TYPE/COUNT length mismatch")
    schema = [
        FieldSpec(n, t, s, c)
        for n, t, s, c in zip(names, types, sizes, counts, strict=True)
    ]

    data = values["DATA"]
    encoding = data[0] if len(data) == 1 else ""
    if encoding not in ENCODINGS:
        raise PcdError("unsupported_encoding", f"DATA {' '.join(data)}")

    vp = values.get("VIEWPOINT")
    if vp is None:
        viewpoint = DEFAULT_VIEWPOINT
    else:
        if len(vp) != 7:
            raise PcdError("bad_header", "VIEWPOINT needs 7 values")
        try:
            [float(t) for t in vp]
        except ValueError:
            raise PcdError("bad_header", "VIEWPOINT is not numeric")
        viewpoint = tuple(vp)

    width = _int("WIDTH", values["WIDTH"][0]) if values.get("WIDTH") else None
    height = (
        _int("HEIGHT", values["HEIGHT"][0]) if values.get("HEIGHT") else None
    )
    points = (
        _int("POINTS", values["POINTS"][0]) if values.get("POINTS") else None
    )
    if width is None and points is None:
        raise PcdError("bad_header", "neither WIDTH nor POINTS given")
    if height is None:
        height = 1
    if width is None:
        assert points is not None
        width = points // height if height else 0
        if width * height != points:
            raise PcdError("points_mismatch", "POINTS not divisible by HEIGHT")
    if points is None:
        points = width * height
    if points != width * height:
        raise PcdError(
            "points_mismatch",
            f"POINTS {points} != WIDTH {width} * HEIGHT {height}",
        )
    if points >= 2**32:
        raise PcdError("too_many_points", "more than 2^32 - 1 points")

    xyz_indices(schema)
    build_dtype(schema)
    return PcdHeader(
        version=version,
        schema=schema,
        width=width,
        height=height,
        viewpoint=viewpoint,
        points=points,
        encoding=encoding,
        data_offset=data_offset,
    )
