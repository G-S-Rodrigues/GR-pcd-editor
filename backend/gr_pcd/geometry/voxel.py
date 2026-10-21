"""Packed int64 voxel keys on a regular grid (shared by the sparse filter and the thin tool)."""

import numpy as np

from gr_pcd.editing.errors import EditError

MAX_KEY = 1 << 62


def voxel_keys(
    rel: np.ndarray, edge: float, message: str, margin: int = 1
) -> tuple[np.ndarray, np.ndarray]:
    """Packed key and grid dimensions for `rel` (n, 3) float64, all rows >= 0 (the cloud minimum subtracted).

    A voxel is [i * edge, (i + 1) * edge) per axis (floor, so a face belongs to the upper voxel). `margin` empty
    voxels are kept on every side, so key arithmetic on neighbours never wraps. A grid whose key does not fit in
    63 bits raises `invalid_tool` with `message`."""
    cells = rel.max(axis=0) / edge + (2 * margin + 1)
    if (
        not np.isfinite(cells).all()
        or float(np.prod(np.minimum(cells, 1e30))) >= MAX_KEY
    ):
        raise EditError("invalid_tool", message)
    ijk = np.floor(rel / edge).astype(np.int64) + margin
    dims = ijk.max(axis=0) + margin + 1
    key = (ijk[:, 0] * dims[1] + ijk[:, 1]) * dims[2] + ijk[:, 2]
    return key, dims
