"""LAY-92..99: protect and lock flags, order, merge and the Floor layer."""

import math

import numpy as np
import pytest
from test_api_session import Api

from fixtures.memory import trim
from fixtures.pcdgen import SCENE_FLOOR, SCENE_GHOST
from fixtures.sessions import make_settings, write_scene

FLOOR_BOX = {
    "type": "box",
    "center": [4.5, 4.5, 0],
    "dimensions": [11, 11, 0.5],
}
GHOST_BOX = {"type": "box", "center": [3, 3, 2], "dimensions": [2, 2, 2]}
L = "/api/session/layers"
PROT = "/api/session/protection"


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


def sess(api):
    return api.client.app.state.manager.require()


def members(api, lid):
    return set(np.flatnonzero(sess(api).layer == lid).tolist())


def post(api, url, **body):
    body.setdefault("cloud_revision", api.cloud())
    return api.client.post(url, json=body)


def code(r):
    return r.json()["error"]["code"]


def make_layer(api, tool, name):
    api.select_wait(tool)
    r = post(api, L, name=name)
    assert r.status_code == 200, r.text
    return max(x["id"] for x in r.json()["layers"])


def band(api, lo, hi, enabled=True):
    r = api.client.put(
        PROT, json={"global": {"enabled": enabled, "min": lo, "max": hi}}
    )
    assert r.status_code == 200, r.text


def patch(api, lid, **body):
    return api.client.patch(f"{L}/{lid}", json=body)


def test_lay_92_patch_flags_and_strict_types(api):
    lid = make_layer(api, FLOOR_BOX, "Floor")
    r = patch(api, lid, protected=True)
    assert r.status_code == 200, r.text
    row = r.json()["layers"][0]
    assert row["protected"] is True and row["locked"] is False
    assert patch(api, lid, protected=1).status_code == 422
    assert patch(api, lid, locked="yes").status_code == 422
    assert patch(api, lid, bogus=True).status_code == 422


def test_lay_93_order(api):
    a = make_layer(api, FLOOR_BOX, "A")
    b = make_layer(api, GHOST_BOX, "B")
    params = api.state()["revision"]["params"]
    r = api.client.put(f"{L}/order", json={"ids": [b, a]})
    assert r.status_code == 200, r.text
    assert [x["id"] for x in r.json()["layers"]] == [b, a]
    assert [x.id for x in sess(api).layers] == [b, a]
    assert r.json()["revision"]["params"] == params
    for bad in ([a, a], [a], [a, b, 9], []):
        r = api.client.put(f"{L}/order", json={"ids": bad})
        assert r.status_code == 422 and code(r) == "invalid_order", bad


def test_lay_94_merge(api):
    floor = make_layer(api, FLOOR_BOX, "Floor")
    ghosts = make_layer(api, GHOST_BOX, "Ghosts")
    r = post(api, f"{L}/{ghosts}/merge", into=floor, dry_run=True)
    assert r.status_code == 200, r.text
    assert r.json()["layer_op"]["moved"] == 27
    assert len(api.state()["layers"]) == 2
    s = sess(api)
    r = post(api, f"{L}/{ghosts}/merge", into=floor)
    assert r.status_code == 200, r.text
    assert [x["id"] for x in r.json()["layers"]] == [floor]
    assert members(api, floor) == SCENE_FLOOR | SCENE_GHOST
    assert not (s.layer == ghosts).any()
    r = post(api, f"{L}/{floor}/merge", into=floor)
    assert r.status_code == 422 and code(r) == "invalid_merge"
    r = post(api, f"{L}/{floor}/merge", into=99)
    assert r.status_code == 404


def test_lay_94b_merge_keeps_deleted_points(api):
    floor = make_layer(api, FLOOR_BOX, "Floor")
    ghosts = make_layer(api, GHOST_BOX, "Ghosts")
    job = api.select_wait(GHOST_BOX)
    cid = job["result"]["candidate"]["candidate_id"]
    assert api.apply(cid).status_code == 200
    assert post(api, f"{L}/{ghosts}/merge", into=floor).status_code == 200
    assert members(api, floor) == SCENE_FLOOR | SCENE_GHOST
    assert (
        api.client.post(
            "/api/session/undo", json={"cloud_revision": api.cloud()}
        ).status_code
        == 200
    )
    assert members(api, floor) == SCENE_FLOOR | SCENE_GHOST


def test_lay_95_merge_into_a_hidden_layer_leaves_the_selection(api):
    a = make_layer(api, FLOOR_BOX, "Floor")
    patch(api, a, visible=False)
    b = make_layer(api, GHOST_BOX, "Ghosts")
    api.select_wait(GHOST_BOX)
    before = api.state()["selection"]["id"]
    assert api.state()["counts"]["selected"] == 27
    r = post(api, f"{L}/{b}/merge", into=a)
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["counts"]["selected"] == 0
    assert st["selection"]["id"] != before


def test_lay_96_floor_from_the_band(api):
    band(api, -0.1, 0.1)
    api.select_wait(GHOST_BOX)
    before = api.state()
    r = post(api, f"{L}/from-protection")
    assert r.status_code == 200, r.text
    st = r.json()
    assert [x["name"] for x in st["layers"]] == ["Floor"]
    assert st["layers"][0]["protected"] is True
    assert st["layers"][0]["visible"] is True
    assert members(api, 1) == SCENE_FLOOR
    assert st["counts"]["selected"] == before["counts"]["selected"]
    assert st["revision"]["cloud"] == before["revision"]["cloud"]
    assert st["history"] == before["history"]


def test_lay_97_floor_from_the_band_errors(api):
    band(api, 0, 0, enabled=False)
    r = post(api, f"{L}/from-protection")
    assert r.status_code == 422 and code(r) == "no_protection_band"
    band(api, 5, 6)
    r = post(api, f"{L}/from-protection")
    assert r.status_code == 422 and code(r) == "empty_band"
    band(api, -0.1, 0.1)
    # ten floor points in a hidden layer are not taken
    one = {"type": "box", "center": [4.5, 0, 0], "dimensions": [10, 0.2, 0.2]}
    hid = make_layer(api, one, "H")
    patch(api, hid, visible=False)
    r = post(api, f"{L}/from-protection")
    assert r.status_code == 200, r.text
    new = max(x["id"] for x in r.json()["layers"])
    assert len(members(api, new)) == 90


def test_lay_97b_dry_run_reports_points_from_other_layers(api):
    band(api, -0.1, 0.1)
    one = {"type": "box", "center": [4.5, 0, 0], "dimensions": [10, 0.2, 0.2]}
    make_layer(api, one, "Row")
    r = post(api, f"{L}/from-protection", dry_run=True)
    assert r.status_code == 200, r.text
    assert r.json()["layer_op"] == {
        "moved": 100,
        "from_other_layers": 10,
        "released": 0,
    }
    assert len(api.state()["layers"]) == 1


def test_lay_98_tilted_band(api):
    rx, pivot = 10.0, [4.5, 4.5]
    tilt = {"rx_deg": rx, "ry_deg": 0.0, "pivot": pivot}
    r = api.client.put(
        PROT,
        json={
            "global": {"enabled": True, "min": -0.6, "max": 0.6},
            "tilt": tilt,
        },
    )
    assert r.status_code == 200, r.text
    r = post(api, f"{L}/from-protection")
    assert r.status_code == 200, r.text
    xyz = sess(api).xyz
    ny, nz = -math.sin(math.radians(rx)), math.cos(math.radians(rx))
    s = ny * (xyz[:, 1] - pivot[1]) + nz * xyz[:, 2]
    with np.errstate(invalid="ignore"):
        want = set(
            np.flatnonzero((s >= -0.6 - 1e-9) & (s <= 0.6 + 1e-9)).tolist()
        )
    want &= set(np.flatnonzero(sess(api).valid).tolist())
    assert members(api, 1) == want and 0 < len(want) < 127


def test_lay_99_locked_layers_refuse_membership_changes(api):
    floor = make_layer(api, FLOOR_BOX, "Floor")
    assert patch(api, floor, locked=True).status_code == 200
    other = make_layer(api, GHOST_BOX, "Ghosts")
    band(api, -0.1, 0.1)
    snapshot = lambda: (
        api.state()["layers"],
        api.state()["revision"],
        sess(api).layer.tobytes(),
    )

    def refused(r, text=None):
        assert r.status_code == 422 and code(r) == "layer_locked", r.text
        if text:
            assert text in r.json()["error"]["message"]

    api.select_wait(GHOST_BOX)
    before = snapshot()
    refused(post(api, f"{L}/{floor}/assign"), "Floor")  # into a locked layer
    refused(post(api, f"{L}/{floor}/set-members"))
    refused(post(api, f"{L}/{floor}/merge", into=other))
    refused(post(api, f"{L}/{other}/merge", into=floor))
    refused(
        api.client.request(
            "DELETE", f"{L}/{floor}", json={"cloud_revision": api.cloud()}
        )
    )
    refused(post(api, f"{L}/from-protection"), "100")
    api.select_wait(FLOOR_BOX)
    refused(post(api, L, name="X"), "100 of these points")
    refused(post(api, f"{L}/{other}/assign"), "Floor")
    refused(post(api, f"{L}/0/assign"), "Floor")
    assert snapshot()[2] == before[2]
    # cosmetic edits still work on a locked layer
    for body in ({"name": "G"}, {"colour": 4}, {"visible": False}):
        assert patch(api, floor, **body).status_code == 200
    assert patch(api, floor, visible=True, protected=True).status_code == 200
    assert patch(api, floor, protected=False).status_code == 200
    # Apply still deletes locked, unprotected points, and Undo returns them
    band(api, 0, 0, enabled=False)
    job = api.select_wait(FLOOR_BOX)
    cid = job["result"]["candidate"]["candidate_id"]
    assert api.apply(cid).status_code == 200
    assert not (sess(api).active & (sess(api).layer == floor)).any()
    r = api.client.post(
        "/api/session/undo", json={"cloud_revision": api.cloud()}
    )
    assert r.status_code == 200, r.text
    assert members(api, floor) == SCENE_FLOOR
