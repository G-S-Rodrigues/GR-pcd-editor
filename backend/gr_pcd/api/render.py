"""Binary render body: float32[3] coords, uint32 ids, uint8 flags, then the
optional 4-byte attribute block and, only for a session with layers, one uint8
layer id per point (header X-Layers: 1)."""

import numpy as np

from gr_pcd.session.engine import RenderArrays


def render_body(arr: RenderArrays) -> bytes:
    return (
        np.ascontiguousarray(arr.coords, dtype="<f4").tobytes()
        + np.ascontiguousarray(arr.ids, dtype="<u4").tobytes()
        + np.ascontiguousarray(arr.flags, dtype="u1").tobytes()
        + (_attr_bytes(arr.attr) if arr.attr is not None else b"")
        + (arr.layer.tobytes() if arr.layer is not None else b"")
    )


def render_headers(arr: RenderArrays, rev: dict) -> dict[str, str]:
    extra = {}
    if arr.attr is not None:
        extra = {"X-Attr-Field": arr.attr_field, "X-Attr-Kind": arr.attr_kind}
    if arr.preview_id is not None:
        extra["X-Preview-Id"] = arr.preview_id
    if arr.layer is not None:
        extra["X-Layers"] = "1"
    return {
        **extra,
        "X-Origin": ",".join(repr(float(v)) for v in arr.origin),
        "X-Count": str(len(arr.ids)),
        "X-Eligible": str(arr.eligible),
        "X-Cloud-Revision": str(rev["cloud"]),
        "X-Params-Revision": str(rev["params"]),
    }


def _attr_bytes(a: np.ndarray) -> bytes:
    return np.ascontiguousarray(a, dtype=a.dtype.newbyteorder("<")).tobytes()
