"""Parsed PCD model.

`records` keeps every source record with its original fields. Because PCD
field names may repeat (PCL padding `_`), the structured dtype uses
positional names `c0, c1, ...`; `schema[i].name` is the real name.
"""

from dataclasses import dataclass

import numpy as np

from gr_pcd.pcd.errors import PcdError

DEFAULT_VIEWPOINT = ("0", "0", "0", "1", "0", "0", "0")
_KIND = {"F": "f", "U": "u", "I": "i"}


@dataclass(frozen=True)
class FieldSpec:
    name: str
    type: str
    size: int
    count: int


def field_dtype(spec: FieldSpec) -> np.dtype:
    if spec.type not in _KIND or spec.size not in (1, 2, 4, 8):
        raise PcdError(
            "unsupported_type",
            f"field {spec.name}: TYPE {spec.type} SIZE {spec.size}",
        )
    if spec.type == "F" and spec.size not in (4, 8):
        raise PcdError(
            "unsupported_type", f"field {spec.name}: float SIZE {spec.size}"
        )
    if spec.count < 1:
        raise PcdError("bad_header", f"field {spec.name}: COUNT {spec.count}")
    return np.dtype(f"<{_KIND[spec.type]}{spec.size}")


def build_dtype(schema: list[FieldSpec]) -> np.dtype:
    parts = []
    for i, spec in enumerate(schema):
        base = field_dtype(spec)
        if spec.count > 1:
            parts.append((f"c{i}", base, (spec.count,)))
        else:
            parts.append((f"c{i}", base))
    return np.dtype(parts, align=False)


def xyz_indices(schema: list[FieldSpec]) -> tuple[int, int, int]:
    found = []
    for axis in "xyz":
        idx = [i for i, s in enumerate(schema) if s.name == axis]
        if len(idx) != 1:
            raise PcdError(
                "missing_xyz",
                f"field {axis} must appear exactly once (found {len(idx)})",
            )
        spec = schema[idx[0]]
        if spec.type != "F" or spec.size not in (4, 8) or spec.count != 1:
            raise PcdError(
                "unsupported_xyz_type",
                f"field {axis} must be float32/float64 with COUNT 1",
            )
        found.append(idx[0])
    return found[0], found[1], found[2]


@dataclass(frozen=True)
class PcdCloud:
    records: np.ndarray
    schema: list[FieldSpec]
    width: int
    height: int
    viewpoint: tuple[str, ...]
    version: str
    encoding: str
    sha256: str | None = None
    file_bytes: int = 0

    @property
    def n(self) -> int:
        return int(self.records.shape[0])


def xyz64(cloud: PcdCloud) -> np.ndarray:
    """Derived float64 (N, 3) cache; exact for float32 sources."""
    ix, iy, iz = xyz_indices(cloud.schema)
    out = np.empty((cloud.n, 3), dtype=np.float64)
    for col, i in enumerate((ix, iy, iz)):
        out[:, col] = cloud.records[f"c{i}"]
    return out


def valid_mask(xyz: np.ndarray) -> np.ndarray:
    return np.isfinite(xyz).all(axis=1)
