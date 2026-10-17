"""Z-interval protection: global plus a per-operation interval."""

import math
from dataclasses import dataclass

import numpy as np

from gr_pcd.geometry.errors import GeometryError

MODES = ("inherit", "add_local", "override")


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
class ProtectionState:
    global_: Interval = Interval()
    operation: OperationProtection = OperationProtection()


def _check_interval(lo: float, hi: float, what: str) -> None:
    if not (math.isfinite(lo) and math.isfinite(hi)):
        raise GeometryError("invalid_protection", f"{what}: must be finite")
    if lo > hi:
        raise GeometryError("invalid_protection", f"{what}: min > max")


def validate_protection(state: ProtectionState) -> None:
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


def protected_mask(
    xyz: np.ndarray, valid: np.ndarray, intervals: list[tuple[float, float]]
) -> np.ndarray:
    """Valid points whose z lies in the union of the intervals (inclusive)."""
    out = np.zeros(len(xyz), dtype=bool)
    z = xyz[:, 2]
    with np.errstate(invalid="ignore"):
        for lo, hi in intervals:
            out |= (z >= lo) & (z <= hi)
    return out & valid
