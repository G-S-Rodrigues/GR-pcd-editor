"""API-103..106: layer edits as timeline steps over HTTP (part 19, 19-5)."""

import json
import zipfile

import numpy as np
import pytest
from test_api_session import Api

from fixtures.memory import trim
from fixtures.pcdgen import SCENE_FLOOR, SCENE_GHOST
from fixtures.sessions import (
    fixture_dir,
    make_settings,
    open_via_upload,
    write_scene,
)

FLOOR_BOX = {
    "type": "box",
    "center": [4.5, 4.5, 0],
    "dimensions": [11, 11, 0.5],
}
GHOST_BOX = {"type": "box", "center": [3, 3, 2], "dimensions": [2, 2, 2]}
L = "/api/session/layers"


@pytest.fixture
def api(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    a = Api(settings)
    a.open()
    yield a
    a.client.app.state.manager.jobs.shutdown()
    a.client.close()
    trim()


def post(api, url, **body):
    body.setdefault("cloud_revision", api.cloud())
    return api.client.post(url, json=body)


def make_layer(api, tool, name):
    api.select_wait(tool)
    r = post(api, L, name=name)
    assert r.status_code == 200, r.text
    return r.json()


def sess(api):
    return api.client.app.state.manager.require()


def test_api_103_create_is_a_step_and_undo_reverts_it(api):
    out = make_layer(api, FLOOR_BOX, "Floor")
    h = out["history"]
    assert h["cursor"] == 1 and len(h["entries"]) == 1
    assert h["entries"][0]["kind"] == "layer"
    r = post(api, "/api/session/undo")
    assert r.status_code == 200, r.text
    st = api.state()
    assert "layers" not in st and st["history"]["cursor"] == 0
    raw = api.client.get(
        "/api/session/render", params={"mode": "edited", "budget": 1000}
    )
    assert "X-Layers" not in raw.headers  # the layer block follows the rows
    assert post(api, "/api/session/redo").status_code == 200
    r = api.client.get(
        "/api/session/render", params={"mode": "edited", "budget": 1000}
    )
    assert r.headers["X-Layers"] == "1"
    assert api.state()["layers"][0]["count"] == 100


def test_api_104_delete_step_refuses_a_dependent_layer_step(api):
    make_layer(api, FLOOR_BOX, "Floor")
    api.select_wait(GHOST_BOX)
    r = post(api, f"{L}/1/set-members")
    assert r.status_code == 200, r.text  # Set layer to selection
    before = api.state()
    first = before["history"]["entries"][0]["sid"]
    assert before["history"]["entries"][0]["deletable"] is False
    r = post(api, "/api/session/history/delete-step", sid=first)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "step_has_dependents"
    assert api.state()["history"] == before["history"]
    assert api.state()["layers"] == before["layers"]


def test_api_105_step_render_draws_exactly_the_moved_ids(api):
    make_layer(api, FLOOR_BOX, "Floor")
    sid = api.state()["history"]["entries"][0]["sid"]
    r = api.client.get(
        "/api/session/render",
        params={"mode": "step", "step": sid, "budget": 100000},
    )
    assert r.status_code == 200, r.text
    n = int(r.headers["X-Count"])
    ids = np.frombuffer(r.content, "<u4", n, offset=n * 12)
    assert set(ids.tolist()) == SCENE_FLOOR and n == 100


def test_api_106_save_and_open_keep_layer_steps(api):
    make_layer(api, FLOOR_BOX, "Floor")
    make_layer(api, GHOST_BOX, "Ghosts")
    job = api.wait(api.client.post("/api/session/save", json={}))
    assert job["status"] == "complete", job
    d = api.client.get(f"/api/session-archives/{job['result']['archive_id']}")
    path = fixture_dir(api.settings) / "steps.pcdsession"
    path.write_bytes(d.content)
    with zipfile.ZipFile(path) as zf:
        assert json.loads(zf.read("manifest.json"))["version"] == 3
    st = open_via_upload(api.client, path, replace=True).json()
    assert [e["kind"] for e in st["history"]["entries"]] == ["layer", "layer"]
    assert [x["name"] for x in st["layers"]] == ["Floor", "Ghosts"]
    r = post(api, "/api/session/undo")
    assert r.status_code == 200, r.text
    assert [x["name"] for x in api.state()["layers"]] == ["Floor"]
    assert set(np.flatnonzero(sess(api).layer == 1).tolist()) == SCENE_FLOOR
    assert not (
        set(np.flatnonzero(sess(api).layer == 2).tolist()) & SCENE_GHOST
    )
