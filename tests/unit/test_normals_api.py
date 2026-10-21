"""NRM-06: the render route serves normals as a u32 attribute block named @normal."""

import numpy as np
import pytest

from fixtures.sessions import (
    fixture_dir,
    make_client,
    make_settings,
    open_via_upload,
    write_scene,
)
from gr_pcd.app import create_app
from gr_pcd.geometry.normals import oct_unpack


class _Api:
    def __init__(self, settings):
        self.settings = settings
        self.client = make_client(create_app(settings))

    def open(self, name="scene.pcd"):
        r = open_via_upload(self.client, fixture_dir(self.settings) / name)
        assert r.status_code == 200, r.text


def _render_attr(api, **params):
    return api.client.get(
        "/api/session/render",
        params={"mode": "original", "budget": 1000, **params},
    )


@pytest.fixture
def api(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    return _Api(settings)


def test_nrm_06_render_attr_normal_is_an_oriented_u32_block(api):
    api.open()
    r = _render_attr(api, attr="@normal")
    assert r.status_code == 200, r.text
    n = int(r.headers["X-Count"])
    assert n > 0
    assert len(r.content) == n * 17 + n * 4
    assert r.headers["X-Attr-Field"] == "@normal"
    assert r.headers["X-Attr-Kind"] == "u32"
    words = np.frombuffer(r.content, "<u4", n, n * 17)
    vec = oct_unpack(words)
    assert np.allclose(np.linalg.norm(vec, axis=1), 1.0, atol=1e-3)
    assert (vec[:, 2] > -1e-3).all()  # the oriented hemisphere


def test_nrm_06_the_plain_name_stays_an_unknown_field(api):
    api.open()
    for name in ("normal", "normals", "@normals"):
        r = _render_attr(api, attr=name)
        assert r.status_code == 422, name
        assert r.json()["error"]["code"] == "unknown_field"


def test_nrm_06_other_modes_and_the_unattributed_render_are_unchanged(api):
    api.open()
    for mode in ("edited", "original", "deleted"):
        r = api.client.get(
            "/api/session/render",
            params={"mode": mode, "budget": 1000, "attr": "@normal"},
        )
        assert r.status_code == 200, (mode, r.text)
        n = int(r.headers["X-Count"])
        assert len(r.content) == n * 17 + n * 4
    plain = _render_attr(api)
    assert "X-Attr-Field" not in plain.headers
