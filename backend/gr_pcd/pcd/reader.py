"""PCD reader: ascii, binary and binary_compressed into structured records."""

import hashlib
import struct
from pathlib import Path

import numpy as np

from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.header import MAX_HEADER_BYTES, PcdHeader, parse_header
from gr_pcd.pcd.lzf import lzf_decompress
from gr_pcd.pcd.model import PcdCloud, build_dtype, field_dtype
from gr_pcd.session.budget import ASCII_EXPANSION, check_budget, estimate_bytes

_TRAILING_LIMIT = 1 << 20


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(8 << 20):
            h.update(chunk)
    return h.hexdigest()


def _check_tail(extra: bytes, total_extra: int) -> None:
    if total_extra > len(extra) or extra.strip():
        raise PcdError("trailing_data", "data after the declared points")


def _ascii_records(header: PcdHeader, payload: bytes) -> np.ndarray:
    n = header.points
    dtype = build_dtype(header.schema)
    per_row = sum(s.count for s in header.schema)
    tokens = payload.split()
    if len(tokens) != n * per_row:
        raise PcdError(
            "ascii_token_count",
            f"expected {n * per_row} values, found {len(tokens)}",
        )
    records = np.empty(n, dtype=dtype)
    if n == 0:
        return records
    table = np.array(tokens).reshape(n, per_row)
    col = 0
    for i, spec in enumerate(header.schema):
        base = field_dtype(spec)
        block = table[:, col : col + spec.count]
        col += spec.count
        try:
            if spec.type == "F":
                values = block.astype(np.float64).astype(base)
            else:
                wide = np.uint64 if (spec.type == "U") else np.int64
                parsed = block.astype(wide)
                values = parsed.astype(base)
                if not np.array_equal(values.astype(wide), parsed):
                    raise ValueError("out of range")
        except (ValueError, OverflowError):
            raise PcdError(
                "ascii_token", f"unparseable value in field {spec.name}"
            )
        records[f"c{i}"] = values if spec.count > 1 else values[:, 0]
    return records


def _binary_records(header: PcdHeader, buf, offset: int) -> np.ndarray:
    dtype = build_dtype(header.schema)
    return np.frombuffer(buf, dtype=dtype, count=header.points, offset=offset)


def _compressed_records(header: PcdHeader, payload: bytes) -> np.ndarray:
    n = header.points
    if len(payload) < 8:
        raise PcdError("truncated", "compressed section shorter than 8 bytes")
    csize, usize = struct.unpack("<II", payload[:8])
    if usize != n * header.itemsize:
        raise PcdError(
            "bad_compression",
            f"uncompressed size {usize} != {n * header.itemsize}",
        )
    if len(payload) < 8 + csize:
        raise PcdError("truncated", "compressed stream is truncated")
    _check_tail(payload[8 + csize :], len(payload) - 8 - csize)
    raw = lzf_decompress(payload[8 : 8 + csize], usize)
    records = np.empty(n, dtype=build_dtype(header.schema))
    off = 0
    for i, spec in enumerate(header.schema):
        base = field_dtype(spec)
        count = n * spec.count
        col = np.frombuffer(raw, dtype=base, count=count, offset=off)
        off += count * base.itemsize
        records[f"c{i}"] = col.reshape(n, spec.count) if spec.count > 1 else col
    return records


def read_pcd(source: Path | bytes, *, budget: int | None = None) -> PcdCloud:
    """Parse a PCD file path or bytes. Never drops fields or records."""
    if isinstance(source, bytes):
        header = parse_header(source[: MAX_HEADER_BYTES + 1])
        total = len(source)
        sha = hashlib.sha256(source).hexdigest()
    else:
        with source.open("rb") as fh:
            header = parse_header(fh.read(MAX_HEADER_BYTES + 1))
        total = source.stat().st_size
        sha = _hash_file(source)
    if budget is not None:
        check_budget(estimate_bytes(header), budget)
    n = header.points
    offset = header.data_offset
    avail = total - offset

    if header.encoding == "binary":
        need = n * header.itemsize
        if avail < need:
            raise PcdError("truncated", f"expected {need} bytes, got {avail}")
        extra_n = avail - need
        if isinstance(source, bytes):
            extra = source[offset + need : offset + need + _TRAILING_LIMIT]
            records = _binary_records(header, source, offset)
        else:
            with source.open("rb") as fh:
                fh.seek(offset + need)
                extra = fh.read(_TRAILING_LIMIT)
            records = np.fromfile(
                source,
                dtype=build_dtype(header.schema),
                count=n,
                offset=offset,
            )
        _check_tail(extra, extra_n)
    else:
        if budget is not None and header.encoding == "ascii":
            # parsing tokens costs a multiple of the payload: refuse before reading it
            check_budget(
                estimate_bytes(header) + ASCII_EXPANSION * avail, budget
            )
        if isinstance(source, bytes):
            payload = source[offset:]
        else:
            with source.open("rb") as fh:
                fh.seek(offset)
                payload = fh.read()
        if header.encoding == "ascii":
            records = _ascii_records(header, payload)
        else:
            records = _compressed_records(header, payload)
    records.flags.writeable = False
    return PcdCloud(
        records=records,
        schema=header.schema,
        width=header.width,
        height=header.height,
        viewpoint=header.viewpoint,
        version=header.version,
        encoding=header.encoding,
        sha256=sha,
        file_bytes=total,
    )
