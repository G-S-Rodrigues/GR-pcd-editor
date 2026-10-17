"""Oriented box membership."""

import math
from dataclasses import dataclass

import numpy as np

from gr_pcd.editing.cancel import CHUNK, CancelToken, chunked_mask
from gr_pcd.geometry.errors import GeometryError
from gr_pcd.geometry.tolerance import GEO_EPS_ROTATED, GEO_EPS_WORLD


@dataclass(frozen=True)
class BoxSpec:
    center: tuple[float, float, float]
    dimensions: tuple[float, float, float]
    rpy_deg: tuple[float, float, float] = (0.0, 0.0, 0.0)
    mode: str = "inside"


def validate_box(box: BoxSpec) -> None:
    vals = [*box.center, *box.dimensions, *box.rpy_deg]
    if len(box.center) != 3 or len(box.dimensions) != 3:
        raise GeometryError("invalid_box", "box needs 3 values per vector")
    if not all(math.isfinite(v) for v in vals):
        raise GeometryError("invalid_box", "box values must be finite")
    if not all(d > 0 for d in box.dimensions):
        raise GeometryError("invalid_box", "box dimensions must be > 0")
    if box.mode not in ("inside", "outside"):
        raise GeometryError("invalid_box", f"unknown mode {box.mode}")


def _cs(deg: float) -> tuple[float, float]:
    if deg == 0:
        return 1.0, 0.0
    r = math.radians(deg)
    return math.cos(r), math.sin(r)


def rotation_matrix(rpy_deg) -> np.ndarray:
    """R = Rz(yaw) Ry(pitch) Rx(roll), local -> world; rpy_deg=[r, p, y]."""
    cr, sr = _cs(rpy_deg[0])
    cp, sp = _cs(rpy_deg[1])
    cy, sy = _cs(rpy_deg[2])
    rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]], dtype=np.float64)
    ry = np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]], dtype=np.float64)
    rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]], dtype=np.float64)
    return rz @ ry @ rx


def box_contains(
    xyz: np.ndarray,
    valid: np.ndarray,
    box: BoxSpec,
    token: CancelToken | None = None,
    chunk: int = CHUNK,
) -> np.ndarray:
    validate_box(box)
    center = np.asarray(box.center, dtype=np.float64)
    half = np.asarray(box.dimensions, dtype=np.float64) / 2.0
    aligned = all(a == 0 for a in box.rpy_deg)
    rot = None if aligned else rotation_matrix(box.rpy_deg)
    eps = GEO_EPS_WORLD if aligned else GEO_EPS_ROTATED

    def evaluate(lo: int, hi: int) -> np.ndarray:
        with np.errstate(invalid="ignore", over="ignore"):
            local = xyz[lo:hi] - center
            if rot is not None:
                local = local @ rot  # == R^T (p - c) for row vectors
            inside = (np.abs(local) <= half + eps).all(axis=1)
        ok = valid[lo:hi]
        return ok & (inside if box.mode == "inside" else ~inside)

    return chunked_mask(len(xyz), evaluate, token, chunk)
