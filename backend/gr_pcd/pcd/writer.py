"""PCD writer. Binary output is bit-exact; ASCII round-trips finite values.

ASCII limit: NaN payload bits of non-XYZ fields are not preserved (tokens
are `nan`/`inf`/`-inf`); binary output preserves them.
"""

import os
import tempfile
from pathlib import Path
from typing import BinaryIO

import numpy as np

from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.header import MAX_HEADER_BYTES, parse_header
from gr_pcd.pcd.model import FieldSpec, PcdCloud

CHUNK = 200_000


def _indices(cloud: PcdCloud, selection) -> np.ndarray:
    if selection is None:
        return np.arange(cloud.n, dtype=np.int64)
    sel = np.asarray(selection)
    if sel.dtype == np.bool_:
        if sel.shape != (cloud.n,):
            raise ValueError("mask length differs from the cloud")
        return np.flatnonzero(sel)
    return sel.astype(np.int64, copy=False)


def header_bytes(
    cloud: PcdCloud, count: int, fmt: str, keep_organization: bool
) -> bytes:
    schema = cloud.schema
    width, height = (
        (cloud.width, cloud.height) if keep_organization else (count, 1)
    )
    lines = [
        "# .PCD v.7 - Point Cloud Data file format",
        "VERSION .7",
        "FIELDS " + " ".join(s.name for s in schema),
        "SIZE " + " ".join(str(s.size) for s in schema),
        "TYPE " + " ".join(s.type for s in schema),
        "COUNT " + " ".join(str(s.count) for s in schema),
        f"WIDTH {width}",
        f"HEIGHT {height}",
        "VIEWPOINT " + " ".join(cloud.viewpoint),
        f"POINTS {count}",
        f"DATA {fmt}",
    ]
    return ("\n".join(lines) + "\n").encode("ascii")


def _tokens(spec: FieldSpec, column: np.ndarray) -> list[list[str]]:
    """Return per-component token lists for one field."""
    if spec.type == "F":
        pat = "%.9g" if spec.size == 4 else "%.17g"
    else:
        pat = "%d"
    col = column.reshape(len(column), spec.count)
    return [[pat % v for v in col[:, j].tolist()] for j in range(spec.count)]


def _ascii_chunk(cloud: PcdCloud, rows: np.ndarray) -> bytes:
    cols: list[list[str]] = []
    for i, spec in enumerate(cloud.schema):
        cols += _tokens(spec, rows[f"c{i}"])
    return ("\n".join(" ".join(r) for r in zip(*cols)) + "\n").encode("ascii")


def write_pcd(
    fileobj: BinaryIO,
    cloud: PcdCloud,
    selection=None,
    fmt: str = "binary",
    keep_organization: bool | None = None,
    token=None,
) -> int:
    """Write the selected records in source order; returns the count."""
    if fmt not in ("binary", "ascii"):
        raise PcdError("unsupported_encoding", f"cannot write {fmt}")
    ids = _indices(cloud, selection)
    count = int(ids.shape[0])
    if keep_organization is None:
        keep_organization = count == cloud.n
    fileobj.write(header_bytes(cloud, count, fmt, keep_organization))
    for start in range(0, count, CHUNK):
        if token is not None:
            token.check()
        rows = cloud.records[ids[start : start + CHUNK]]
        if fmt == "binary":
            fileobj.write(rows.tobytes())
        else:
            fileobj.write(_ascii_chunk(cloud, rows))
    return count


def write_pcd_file(
    path: Path,
    cloud: PcdCloud,
    selection=None,
    fmt: str = "binary",
    *,
    overwrite: bool = False,
    source_path: Path | None = None,
    keep_organization: bool | None = None,
    token=None,
) -> int:
    """Atomic write: temp file in the target directory, fsync, replace."""
    path = Path(path)
    if source_path is not None and (
        path.resolve() == Path(source_path).resolve()
    ):
        raise PcdError("would_overwrite_source", "refusing to overwrite source")
    if path.exists() and not overwrite:
        raise PcdError("destination_exists", f"{path.name} already exists")
    fd, tmp_name = tempfile.mkstemp(
        dir=path.parent, prefix=".export-", suffix=".part"
    )
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as fh:
            count = write_pcd(
                fh, cloud, selection, fmt, keep_organization, token
            )
            fh.flush()
            os.fsync(fh.fileno())
        if overwrite:
            os.replace(tmp, path)
        else:
            try:
                os.link(tmp, path)
            except FileExistsError:
                raise PcdError(
                    "destination_exists", f"{path.name} already exists"
                )
            tmp.unlink()
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return count


def verify_written(
    path: Path, expected_count: int, schema: list[FieldSpec]
) -> None:
    """Header-level check: count, schema and size match what was intended."""
    path = Path(path)
    with path.open("rb") as fh:
        header = parse_header(fh.read(MAX_HEADER_BYTES + 1))
    size = path.stat().st_size
    if header.points != expected_count:
        raise PcdError("verify_failed", "point count differs from expected")
    if header.schema != schema:
        raise PcdError("verify_failed", "schema differs from expected")
    if header.encoding == "binary":
        if size != header.data_offset + header.points * header.itemsize:
            raise PcdError("verify_failed", "file size differs from header")
    elif header.encoding == "ascii":
        with path.open("rb") as fh:
            fh.seek(header.data_offset)
            lines = sum(1 for ln in fh if ln.strip())
        if lines != header.points:
            raise PcdError("verify_failed", "row count differs from header")
