"""Per-point surface normals for the Normal shading colour mode (part 12-9).

Voxel PCA: the points are binned into cubes, each cube's 3x3 covariance gives its plane as the eigenvector of the
smallest eigenvalue, and every point takes its cube's normal. This is a display aid computed on the points one render
returns; it is not part of selection or editing, so it carries no tolerance. A cube with fewer than 3 points falls
back to +Z. Cubes straddling two surfaces give a wrong normal at the seam (shading only).

Orientation rule: the sign is chosen so the first of the z, y, x components whose magnitude exceeds 1e-3 is positive
(floors and ceilings point up, a wall along x points +x).

`@normal` render attribute: one uint32 per point, the octahedral packing (`oct_pack`) of the normal, 16 bits per axis
(`u | v << 16`).
"""

import numpy as np

NORMAL_ATTR = "@normal"
POINTS_PER_VOXEL = 64  # target of the voxel size: this many points in a cube of an evenly filled volume
MAX_CELLS = 1 << 40  # keeps the packed voxel key inside int64
SIGN_EPS = 1e-3
UP = np.array([0.0, 0.0, 1.0])


def voxel_edge(xyz: np.ndarray) -> float:
    """Cube edge for a sample: scales with the sample spacing so a thinner sample gets bigger cubes."""
    n = len(xyz)
    if n < 2:
        return 1.0
    ext = np.maximum(xyz.max(axis=0) - xyz.min(axis=0), 0.0)
    ext = np.maximum(
        ext, 0.1 * max(float(ext.max()), 1e-9)
    )  # a flat cloud still has a volume
    volume = float(np.prod(ext))
    return max((volume * POINTS_PER_VOXEL / n) ** (1.0 / 3.0), 1e-9)


def _orient(vec: np.ndarray) -> np.ndarray:
    """Flip each row so its first component above SIGN_EPS, taken in the order z, y, x, is positive."""
    flip = np.zeros(len(vec), dtype=bool)
    undecided = np.ones(len(vec), dtype=bool)
    for axis in (2, 1, 0):
        big = undecided & (np.abs(vec[:, axis]) > SIGN_EPS)
        flip |= big & (vec[:, axis] < 0)
        undecided &= ~big
    vec[flip] *= -1.0
    return vec


def estimate_normals(xyz: np.ndarray, edge: float | None = None) -> np.ndarray:
    """Unit normals, float32 (n, 3), one per point of `xyz` (n, 3)."""
    n = len(xyz)
    out = np.tile(UP.astype(np.float32), (n, 1))
    if n < 3:
        return out
    pts = np.asarray(xyz, dtype=np.float64)
    pts = pts - pts.min(axis=0)
    edge = voxel_edge(pts) if edge is None else float(edge)
    dims = np.floor(pts.max(axis=0) / edge).astype(np.int64) + 1
    while float(np.prod(dims.astype(np.float64))) > MAX_CELLS:
        edge *= 2.0
        dims = np.floor(pts.max(axis=0) / edge).astype(np.int64) + 1
    ijk = np.floor(pts / edge).astype(np.int64)
    key = (ijk[:, 0] * dims[1] + ijk[:, 1]) * dims[2] + ijk[:, 2]
    uniq, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
    m = len(uniq)
    # per-voxel centred covariance from bincount sums (about the voxel mean, in float64)
    s1 = np.stack([np.bincount(inv, pts[:, k], m) for k in range(3)], axis=1)
    mean = s1 / cnt[:, None]
    cov = np.empty((m, 3, 3))
    for i in range(3):
        for j in range(i, 3):
            v = (
                np.bincount(inv, pts[:, i] * pts[:, j], m) / cnt
                - mean[:, i] * mean[:, j]
            )
            cov[:, i, j] = v
            cov[:, j, i] = v
    _, vecs = np.linalg.eigh(
        cov
    )  # ascending: column 0 is the smallest eigenvalue
    nrm = _orient(vecs[:, :, 0].copy())
    nrm[cnt < 3] = UP
    bad = ~np.isfinite(nrm).all(axis=1)
    nrm[bad] = UP
    return nrm[inv].astype(np.float32)


def oct_pack(vec: np.ndarray) -> np.ndarray:
    """Octahedral packing of unit vectors into uint32: 16-bit u in the low half, 16-bit v in the high half."""
    v = np.asarray(vec, dtype=np.float64)
    p = v / np.maximum(np.abs(v).sum(axis=1, keepdims=True), 1e-300)
    x, y = p[:, 0].copy(), p[:, 1].copy()
    low = p[:, 2] < 0
    sx = np.where(p[:, 0] >= 0, 1.0, -1.0)
    sy = np.where(p[:, 1] >= 0, 1.0, -1.0)
    x[low] = ((1.0 - np.abs(p[:, 1])) * sx)[low]
    y[low] = ((1.0 - np.abs(p[:, 0])) * sy)[low]
    ui = np.floor((np.clip(x, -1, 1) * 0.5 + 0.5) * 65535.0 + 0.5).astype(
        np.uint32
    )
    vi = np.floor((np.clip(y, -1, 1) * 0.5 + 0.5) * 65535.0 + 0.5).astype(
        np.uint32
    )
    return (ui | (vi << np.uint32(16))).astype(np.uint32)


def oct_unpack(words: np.ndarray) -> np.ndarray:
    """Inverse of `oct_pack`: unit vectors, float64 (n, 3)."""
    w = np.asarray(words, dtype=np.uint32)
    u = (w & np.uint32(0xFFFF)).astype(np.float64) / 65535.0 * 2.0 - 1.0
    v = (w >> np.uint32(16)).astype(np.float64) / 65535.0 * 2.0 - 1.0
    z = 1.0 - np.abs(u) - np.abs(v)
    x, y = u.copy(), v.copy()
    low = z < 0
    x[low] = ((1.0 - np.abs(v)) * np.where(u >= 0, 1.0, -1.0))[low]
    y[low] = ((1.0 - np.abs(u)) * np.where(v >= 0, 1.0, -1.0))[low]
    out = np.stack([x, y, z], axis=1)
    return out / np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-300)


def normals_u32(xyz: np.ndarray) -> np.ndarray:
    """The `@normal` attribute values of a point sample."""
    return oct_pack(estimate_normals(xyz))
