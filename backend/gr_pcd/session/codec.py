"""Dict <-> dataclass conversion for filters, protection and tools."""

from dataclasses import dataclass

from gr_pcd.editing.protection import (
    Interval,
    OperationProtection,
    ProtectionState,
)
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.geometry.errors import GeometryError
from gr_pcd.geometry.filters import AxisRange, DisplayFilter
from gr_pcd.geometry.prism import PrismSpec


@dataclass(frozen=True)
class FilterTool:
    """'Select displayed': uses the session display filter."""


@dataclass(frozen=True)
class ClusterTool:
    seed_id: int
    radius: float
    region: BoxSpec | PrismSpec | None = None
    exclude_protected: bool = True
    max_points: int | None = 2_000_000
    on_limit: str = "fail"  # fail | partial


def _num(d: dict, key: str) -> float:
    try:
        return float(d[key])
    except (KeyError, TypeError, ValueError):
        raise GeometryError("invalid_state", f"bad or missing {key}")


def filter_to_dict(f: DisplayFilter) -> dict:
    return {
        a: {"enabled": r.enabled, "min": r.min, "max": r.max}
        for a, r in zip("xyz", f.axes(), strict=True)
    }


def filter_from_dict(d: dict) -> DisplayFilter:
    try:
        axes = {
            a: AxisRange(
                bool(d[a]["enabled"]), _num(d[a], "min"), _num(d[a], "max")
            )
            for a in "xyz"
        }
    except (KeyError, TypeError):
        raise GeometryError("invalid_state", "bad display filter")
    return DisplayFilter(**axes)


def protection_to_dict(p: ProtectionState) -> dict:
    op = p.operation
    return {
        "global": {
            "enabled": p.global_.enabled,
            "min": p.global_.min,
            "max": p.global_.max,
        },
        "operation": {
            "mode": op.mode,
            "local": None
            if op.local is None
            else {"min": op.local[0], "max": op.local[1]},
            "acknowledge_override": op.acknowledge_override,
        },
    }


def protection_from_dict(d: dict) -> ProtectionState:
    try:
        g, op = d["global"], d["operation"]
        local = op.get("local")
        return ProtectionState(
            Interval(bool(g["enabled"]), _num(g, "min"), _num(g, "max")),
            OperationProtection(
                str(op["mode"]),
                None
                if local is None
                else (_num(local, "min"), _num(local, "max")),
                bool(op.get("acknowledge_override", False)),
            ),
        )
    except (KeyError, TypeError, AttributeError):
        raise GeometryError("invalid_state", "bad protection state")


def tool_summary(tool) -> dict | None:
    if tool is None:
        return None
    if isinstance(tool, BoxSpec):
        return {"type": "box", "mode": tool.mode}
    if isinstance(tool, PrismSpec):
        return {"type": "prism", "mode": tool.mode}
    if isinstance(tool, FilterTool):
        return {"type": "filter"}
    return {
        "type": "cluster",
        "seed_id": tool.seed_id,
        "radius": tool.radius,
    }
