"""Named sub layers: a partition of the points (pure numpy, no session).

One uint8 id per point: 0 is the main cloud, 1..255 a sub layer. The array is
absent (None) until the first layer exists, so a layer-less session pays
nothing and behaves exactly as before. Ids are the lowest free one; deleting a
layer resets every point that carried it (deleted points included), so no
dangling id can exist. All helpers return new read-only arrays.
"""

from dataclasses import dataclass

import numpy as np

from gr_pcd.editing.errors import EditError
from gr_pcd.editing.history import clean_name

MAX_LAYERS = 32
MAX_NAME = 40
COLOURS = 16


@dataclass(frozen=True)
class Layer:
    id: int
    name: str
    colour: int  # 0..15, an index into the client palette
    visible: bool = True


def clean_layer_name(name) -> str:
    """1..40 characters, stripped, no control characters."""
    out = clean_name(name, MAX_NAME, "a layer name")
    if out is None:
        raise EditError("invalid_name", "a layer needs a name")
    return out


def lowest_free_id(layers: list[Layer]) -> int:
    if len(layers) >= MAX_LAYERS:
        raise EditError(
            "too_many_layers", f"at most {MAX_LAYERS} layers are allowed"
        )
    used = {lay.id for lay in layers}
    return next(k for k in range(1, 256) if k not in used)


def next_colour(layers: list[Layer]) -> int:
    used = {lay.colour for lay in layers}
    for c in range(COLOURS):
        if c not in used:
            return c
    return len(layers) % COLOURS


def _ro(a: np.ndarray) -> np.ndarray:
    a.flags.writeable = False
    return a


def assign(layer: np.ndarray | None, mask: np.ndarray, layer_id: int, n: int):
    """New id array with `layer_id` on every point of `mask` (0 releases)."""
    out = np.zeros(n, dtype=np.uint8) if layer is None else layer.copy()
    out[mask] = layer_id
    return _ro(out)


def delete_layer(layer: np.ndarray | None, layer_id: int):
    """New id array where every point of `layer_id` is main again."""
    if layer is None:
        return None
    out = layer.copy()
    out[out == layer_id] = 0
    return _ro(out)


def members(
    layer: np.ndarray | None, active: np.ndarray, layer_id: int
) -> np.ndarray:
    if layer is None:
        return np.zeros(len(active), dtype=bool)
    return (layer == layer_id) & active


def from_other_layers(
    layer: np.ndarray | None, mask: np.ndarray, layer_id: int
) -> int:
    """How many points of `mask` sit in a sub layer other than `layer_id`."""
    if layer is None:
        return 0
    ids = layer[mask]
    return int(np.count_nonzero((ids != 0) & (ids != layer_id)))


def counts_by_layer(layer: np.ndarray | None, mask: np.ndarray) -> np.ndarray:
    """Points of `mask` per id (index 0 = main), length 256."""
    if layer is None:
        out = np.zeros(256, dtype=np.int64)
        out[0] = int(mask.sum())
        return out
    return np.bincount(layer[mask], minlength=256).astype(np.int64)


def hidden_points(
    layer: np.ndarray | None, layers: list[Layer]
) -> np.ndarray | None:
    """Mask of points in a hidden layer, or None when nothing is hidden."""
    hidden = [lay.id for lay in layers if not lay.visible]
    if layer is None or not hidden:
        return None
    lut = np.zeros(256, dtype=bool)
    lut[hidden] = True
    return lut[layer]
