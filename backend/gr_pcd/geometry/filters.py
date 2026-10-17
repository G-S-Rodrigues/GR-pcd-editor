"""Display filter: independent inclusive min/max per axis, ANDed."""

import math
from dataclasses import dataclass

import numpy as np

from gr_pcd.editing.cancel import CHUNK, CancelToken, chunked_mask
from gr_pcd.geometry.errors import GeometryError


@dataclass(frozen=True)
class AxisRange:
    enabled: bool = False
    min: float = 0.0
    max: float = 0.0


@dataclass(frozen=True)
class DisplayFilter:
    x: AxisRange = AxisRange()
    y: AxisRange = AxisRange()
    z: AxisRange = AxisRange()

    def axes(self):
        return (self.x, self.y, self.z)


def validate_range(r: AxisRange, what: str = "range") -> None:
    if not (math.isfinite(r.min) and math.isfinite(r.max)):
        raise GeometryError("invalid_filter", f"{what}: limits must be finite")
    if r.min > r.max:
        raise GeometryError("invalid_filter", f"{what}: min > max")


def validate_filter(f: DisplayFilter) -> None:
    for name, r in zip("xyz", f.axes(), strict=True):
        validate_range(r, name)


def filter_contains(
    xyz: np.ndarray,
    valid: np.ndarray,
    f: DisplayFilter,
    token: CancelToken | None = None,
    chunk: int = CHUNK,
) -> np.ndarray:
    validate_filter(f)
    active = [(i, r) for i, r in enumerate(f.axes()) if r.enabled]

    def evaluate(lo: int, hi: int) -> np.ndarray:
        m = valid[lo:hi].copy()
        for i, r in active:
            col = xyz[lo:hi, i]
            m &= (col >= r.min) & (col <= r.max)
        return m

    return chunked_mask(len(xyz), evaluate, token, chunk)
