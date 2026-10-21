"""API-72: a filter side sitting exactly at the cloud bound hides nothing."""

import numpy as np
from test_api_session import Api

from fixtures.pcdgen import build_pcd, xyz_fields
from fixtures.sessions import fixture_dir, make_settings


def test_api_72_filter_at_bounds_hides_nothing(tmp_path):
    settings = make_settings(tmp_path)
    rng = np.random.default_rng(72)
    pts = rng.uniform(-37.3, 91.7, size=(5000, 3)).astype(np.float32)
    rows = [tuple(float(v) for v in p) for p in pts]
    rows.append((float("nan"), 0.0, 0.0))
    (fixture_dir(settings) / "nd.pcd").write_bytes(
        build_pcd(xyz_fields(4), rows, "binary")
    )
    api = Api(settings)
    api.open("nd.pcd")
    b = api.state()["bounds"]
    body = {
        a: {"enabled": True, "min": b["min"][i], "max": b["max"][i]}
        for i, a in enumerate("xyz")
    }
    assert (
        api.client.put("/api/session/display-filter", json=body).status_code
        == 200
    )
    st = api.state()
    assert st["counts"]["displayed"] == 5000
    assert (
        st["counts"]["displayed"]
        == st["counts"]["active"] - st["counts"]["invalid_active"]
    )
