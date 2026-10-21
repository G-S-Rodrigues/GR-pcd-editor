"""Slab protection: global plus a per-operation interval, optionally tilted."""

import math
from dataclasses import dataclass

import numpy as np

from gr_pcd.geometry.errors import GeometryError
from gr_pcd.geometry.tolerance import GEO_EPS_ROTATED

MODES = ("inherit", "add_local", "override")
MAX_TILT_DEG = 60.0


@dataclass(frozen=True)
class Interval:
    enabled: bool = False
    min: float = 0.0
    max: float = 0.0


@dataclass(frozen=True)
class OperationProtection:
    mode: str = "inherit"
    local: tuple[float, float] | None = None
    acknowledge_override: bool = False


@dataclass(frozen=True)
class Tilt:
    """Slab orientation: normal n = Ry(ry) Rx(rx) e_z, measured from the pivot column."""

    rx_deg: float = 0.0
    ry_deg: float = 0.0
    pivot: tuple[float, float] = (0.0, 0.0)

    @property
    def level(self) -> bool:
        return self.rx_deg == 0 and self.ry_deg == 0


@dataclass(frozen=True)
class ProtectionState:
    global_: Interval = Interval()
    operation: OperationProtection = OperationProtection()
    tilt: Tilt = Tilt()


def _check_interval(lo: float, hi: float, what: str) -> None:
    if not (math.isfinite(lo) and math.isfinite(hi)):
        raise GeometryError("invalid_protection", f"{what}: must be finite")
    if lo > hi:
        raise GeometryError("invalid_protection", f"{what}: min > max")


def _check_tilt(t: Tilt) -> None:
    vals = (t.rx_deg, t.ry_deg, *t.pivot)
    if len(t.pivot) != 2 or not all(math.isfinite(v) for v in vals):
        raise GeometryError("invalid_protection", "tilt: must be finite")
    if abs(t.rx_deg) > MAX_TILT_DEG or abs(t.ry_deg) > MAX_TILT_DEG:
        raise GeometryError(
            "invalid_protection",
            f"tilt: angles are limited to +-{MAX_TILT_DEG:g}",
        )


def validate_protection(state: ProtectionState) -> None:
    _check_tilt(state.tilt)
    g = state.global_
    _check_interval(g.min, g.max, "global")
    op = state.operation
    if op.mode not in MODES:
        raise GeometryError("invalid_protection", f"unknown mode {op.mode}")
    if op.mode != "inherit":
        if op.local is None:
            raise GeometryError(
                "invalid_protection", f"{op.mode} needs a local interval"
            )
        _check_interval(op.local[0], op.local[1], "local")
    if op.mode == "override" and not op.acknowledge_override:
        raise GeometryError(
            "override_not_acknowledged",
            "override replaces global protection and must be acknowledged",
        )


def effective_intervals(state: ProtectionState) -> list[tuple[float, float]]:
    validate_protection(state)
    out: list[tuple[float, float]] = []
    g, op = state.global_, state.operation
    if op.mode in ("inherit", "add_local") and g.enabled:
        out.append((g.min, g.max))
    if op.mode in ("add_local", "override"):
        assert op.local is not None
        out.append((op.local[0], op.local[1]))
    return out


def slab_coordinate(xyz: np.ndarray, tilt: Tilt) -> np.ndarray:
    """s = n . (p - (px, py, 0)) in float64 (level: exactly z)."""
    rx, ry = math.radians(tilt.rx_deg), math.radians(tilt.ry_deg)
    nx = math.cos(rx) * math.sin(ry)
    ny = -math.sin(rx)
    nz = math.cos(rx) * math.cos(ry)
    return (
        nx * (xyz[:, 0] - tilt.pivot[0])
        + ny * (xyz[:, 1] - tilt.pivot[1])
        + nz * xyz[:, 2]
    )


def protected_mask(
    xyz: np.ndarray,
    valid: np.ndarray,
    intervals: list[tuple[float, float]],
    tilt: Tilt | None = None,
) -> np.ndarray:
    """Valid points whose slab coordinate lies in the union of the intervals.

    Level (tilt None or both angles 0): the z column, inclusive, eps 0.
    Tilted: float64 slab coordinate, inclusive with GEO_EPS_ROTATED.
    """
    out = np.zeros(len(xyz), dtype=bool)
    with np.errstate(invalid="ignore", over="ignore"):
        if tilt is None or tilt.level:
            z = xyz[:, 2]
            for lo, hi in intervals:
                out |= (z >= lo) & (z <= hi)
        else:
            s = slab_coordinate(xyz, tilt)
            for lo, hi in intervals:
                out |= (s >= lo - GEO_EPS_ROTATED) & (s <= hi + GEO_EPS_ROTATED)
    return out & valid
