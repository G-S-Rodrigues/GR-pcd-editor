"""Dict <-> dataclass conversion for filters, protection and tools."""

from dataclasses import dataclass

from gr_pcd.editing.protection import (
    Interval,
    OperationProtection,
    ProtectionState,
    Tilt,
)
from gr_pcd.editing.sparse import SparseSpec
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.geometry.errors import GeometryError
from gr_pcd.geometry.filters import AxisRange, DisplayFilter
from gr_pcd.geometry.prism import PrismSpec


@dataclass(frozen=True)
class FilterTool:
    """'Select displayed': uses the session display filter."""


@dataclass(frozen=True)
class LayerTool:
    """'Select layer': the active members of one visible layer."""

    layer_id: int


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


def tilt_to_dict(t: Tilt) -> dict:
    return {"rx_deg": t.rx_deg, "ry_deg": t.ry_deg, "pivot": list(t.pivot)}


def tilt_from_dict(d: dict | None) -> Tilt:
    if d is None:
        return Tilt()
    try:
        pivot = d["pivot"]
        return Tilt(
            _num(d, "rx_deg"),
            _num(d, "ry_deg"),
            (float(pivot[0]), float(pivot[1])),
        )
    except (KeyError, TypeError, ValueError, IndexError):
        raise GeometryError("invalid_state", "bad protection tilt")


def protection_to_dict(p: ProtectionState) -> dict:
    """Level protection keeps the pre-tilt shape: `tilt` only when tilted."""
    op = p.operation
    out = {
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
    if not p.tilt.level:
        out["tilt"] = tilt_to_dict(p.tilt)
    return out


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
            tilt_from_dict(d.get("tilt")),
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
    if isinstance(tool, SparseSpec):
        return {"type": "sparse"}
    if isinstance(tool, LayerTool):
        return {"type": "layer", "layer_id": tool.layer_id}
    return {
        "type": "cluster",
        "seed_id": tool.seed_id,
        "radius": tool.radius,
    }


MAX_SHAPE_VERTICES = 4096


def _box_shape(b: BoxSpec) -> dict:
    return {
        "type": "box",
        "center": [float(v) for v in b.center],
        "dimensions": [float(v) for v in b.dimensions],
        "rpy_deg": [float(v) for v in b.rpy_deg],
        "mode": b.mode,
    }


def _prism_shape(p: PrismSpec) -> dict:
    return {
        "type": "prism",
        "polygon": [[float(x), float(y)] for x, y in p.polygon],
        "z_min": float(p.z_min),
        "z_max": float(p.z_max),
        "mode": p.mode,
    }


def _region_shape(region) -> dict | None:
    if region is None:
        return None
    return (
        _box_shape(region)
        if isinstance(region, BoxSpec)
        else _prism_shape(region)
    )


def _filter_box(filt: DisplayFilter | None, bounds: dict | None) -> dict | None:
    """A disabled axis spans the cloud bounds; with neither a range nor bounds there is no box."""
    if filt is None:
        return None
    lo, hi = [], []
    for i, r in enumerate(filt.axes()):
        if r.enabled:
            lo.append(float(r.min))
            hi.append(float(r.max))
        elif bounds is not None:
            lo.append(float(bounds["min"][i]))
            hi.append(float(bounds["max"][i]))
        else:
            return None
    dims = [max(h - l, 1e-6) for l, h in zip(lo, hi, strict=True)]
    return {
        "type": "box",
        "center": [(l + h) / 2.0 for l, h in zip(lo, hi, strict=True)],
        "dimensions": dims,
        "rpy_deg": [0.0, 0.0, 0.0],
        "mode": "inside",
    }


def shape_of(
    tool, filt: DisplayFilter | None = None, bounds: dict | None = None
) -> dict | None:
    """The full editable shape of a selection tool (what the client needs to
    recreate it), unlike `tool_summary`, which is the short label kept for the
    selection log. A filter step becomes the box of its filter bounds."""
    if tool is None or isinstance(tool, LayerTool):
        return None
    if isinstance(tool, BoxSpec):
        return _box_shape(tool)
    if isinstance(tool, PrismSpec):
        return _prism_shape(tool)
    if isinstance(tool, FilterTool):
        return _filter_box(filt, bounds)
    if isinstance(tool, SparseSpec):
        return {
            "type": "sparse",
            "radius": None if tool.radius is None else float(tool.radius),
            "min_neighbours": int(tool.min_neighbours),
            "exclude_protected": bool(tool.exclude_protected),
            "region": _region_shape(tool.region),
        }
    if isinstance(tool, ClusterTool):
        region = tool.region
        return {
            "type": "cluster",
            "seed_id": tool.seed_id,
            "radius": float(tool.radius),
            "max_points": tool.max_points,
            "exclude_protected": bool(tool.exclude_protected),
            "region": _region_shape(region),
        }
    return None
