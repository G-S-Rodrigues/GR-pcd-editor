"""LAY-40..56: the layer routes, and every selection path with a hidden layer."""

import pytest
from test_api_session import GHOST_BOX, Api

from fixtures.pcdgen import SCENE_FLOOR, SCENE_GHOST
from fixtures.sessions import make_settings, write_scene

FLOOR_BOX = {
    "type": "box",
    "center": [4.5, 4.5, 0],
    "dimensions": [11, 11, 0.5],
}
ALL_BOX = {"type": "box", "center": [4.5, 4.5, 1], "dimensions": [20, 20, 20]}
PRISM = {
    "type": "prism",
    "polygon": [[-1, -1], [11, -1], [11, 11], [-1, 11]],
    "z_min": -1,
    "z_max": 5,
}
L = "/api/session/layers"


@pytest.fixture
def api(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    a = Api(settings)
    a.open()
    return a


def post(api, url, **body):
    body.setdefault("cloud_revision", api.cloud())
    return api.client.post(url, json=body)


def make_layer(api, tool=FLOOR_BOX, **body):
    api.select_wait(tool)
    r = post(api, L, **body)
    assert r.status_code == 200, r.text
    return r.json()


def code(r):
    return r.json()["error"]["code"]


def exported_z(api, scope):
    r = api.client.post(
        "/api/session/export", json={"format": "ascii", "scope": scope}
    )
    res = api.wait(r)["result"]
    body = api.client.get(f"/api/exports/{res['export_id']}").content
    rows = body.partition(b"DATA ascii\n")[2].decode().split("\n")
    return [float(row.split()[2]) for row in rows if row.strip()], res["count"]


def test_lay_40_create_answers_the_state_and_changes_no_revision(api):
    before = api.state()
    rev = before["revision"]
    out = make_layer(api, name="Floor", visible=True)
    assert out["layer_op"] == {
        "moved": 100,
        "from_other_layers": 0,
        "released": 0,
    }
    assert out["layers"] == [
        {
            "id": 1,
            "name": "Floor",
            "colour": 0,
            "visible": True,
            "count": 100,
            "bounds": {"min": [0.0, 0.0, 0.0], "max": [9.0, 9.0, 0.0]},
        }
    ]
    assert out["revision"]["cloud"] == rev["cloud"]
    assert out["history"] == before["history"]  # not a timeline step
    assert out["counts"]["main"] == 27 and out["counts"]["hidden"] == 0
    assert out["unsaved"] is True


def test_lay_41_create_errors(api):
    r = post(api, L)
    assert r.status_code == 422 and code(r) == "empty_selection"
    api.select_wait(FLOOR_BOX)
    r = post(api, L, name="  ")
    assert r.status_code == 422 and code(r) == "invalid_name"
    r = post(api, L, cloud_revision=api.cloud() + 5)
    assert r.status_code == 409 and code(r) == "stale_revision"
    r = api.client.post(L, json={"cloud_revision": api.cloud(), "bogus": 1})
    assert r.status_code == 422
    for k in range(32):
        one = {
            "type": "box",
            "center": [k % 10, k // 10, 0],
            "dimensions": [0.2, 0.2, 0.2],
        }
        make_layer(api, tool=one, name=f"l{k}")
    api.select_wait(FLOOR_BOX)
    r = post(api, L)
    assert r.status_code == 422 and code(r) == "too_many_layers"
    assert len(api.state()["layers"]) == 32


def test_lay_42_dry_run_changes_nothing(api):
    api.select_wait(FLOOR_BOX)
    before = api.state()
    r = post(api, L, dry_run=True)
    assert r.status_code == 200
    assert r.json()["layer_op"]["moved"] == 100
    assert api.state() == before


def test_lay_43_assign_release_and_the_steal_numbers(api):
    make_layer(api, name="Floor")
    api.select_wait(
        {"type": "box", "center": [0.5, 0.5, 0], "dimensions": [1, 1, 0.5]}
    )
    r = post(api, L, name="Corner")
    assert r.json()["layer_op"]["from_other_layers"] == 4
    api.select_wait(FLOOR_BOX)
    r = post(api, f"{L}/2/assign", dry_run=True)
    assert r.json()["layer_op"] == {
        "moved": 100,
        "from_other_layers": 96,
        "released": 0,
    }
    r = post(api, f"{L}/0/assign")
    assert r.json()["layer_op"]["released"] == 100
    assert r.json()["counts"]["main"] == 127
    r = post(api, f"{L}/9/assign")
    assert r.status_code == 404 and code(r) == "no_such_layer"


def test_lay_44_set_members_and_delete(api):
    make_layer(api, name="Floor")
    api.select_wait(
        {"type": "box", "center": [0.5, 0.5, 0], "dimensions": [1, 1, 0.5]}
    )
    r = post(api, f"{L}/1/set-members", dry_run=True)
    assert r.json()["layer_op"]["released"] == 96
    r = post(api, f"{L}/1/set-members")
    assert r.json()["layers"][0]["count"] == 4
    r = post(api, f"{L}/9/set-members")
    assert r.status_code == 404 and code(r) == "no_such_layer"
    r = api.client.request(
        "DELETE", f"{L}/1", json={"cloud_revision": api.cloud()}
    )
    assert r.status_code == 200 and "layers" not in r.json()
    r = api.client.request(
        "DELETE", f"{L}/1", json={"cloud_revision": api.cloud()}
    )
    assert r.status_code == 404 and code(r) == "no_such_layer"


def test_lay_44b_set_members_of_a_hidden_layer_is_refused(api):
    make_layer(api, visible=False)
    api.select_wait(GHOST_BOX)
    r = post(api, f"{L}/1/set-members")
    assert r.status_code == 422 and code(r) == "layer_hidden"


def test_lay_45_box_polygon_and_candidate_skip_hidden_points(api):
    make_layer(api, visible=False)
    for tool in (FLOOR_BOX, ALL_BOX, PRISM):
        job = api.select_wait(tool)
        cand = job["result"]["candidate"]
        ids = api.candidate_ids(cand["candidate_id"])
        assert not (ids & SCENE_FLOOR), tool["type"]
        assert api.state()["selection"]["count"] == len(ids)
    assert ids == SCENE_GHOST
    z, count = exported_z(api, "selected")
    assert count == 27 and min(z) >= 1.0


def test_lay_46_select_displayed_excludes_hidden(api):
    make_layer(api, visible=False)
    job = api.select_wait({"type": "filter"}, scope="displayed")
    ids = api.candidate_ids(job["result"]["candidate"]["candidate_id"])
    assert ids == SCENE_GHOST


def test_lay_47_invert_excludes_hidden(api):
    make_layer(api, visible=False)
    api.select_wait(
        {"type": "box", "center": [3, 3, 1], "dimensions": [2, 2, 0.5]}
    )
    job = api.select_wait(None, op="invert")
    ids = api.candidate_ids(job["result"]["candidate"]["candidate_id"])
    assert ids and not (ids & SCENE_FLOOR) and ids < SCENE_GHOST


def test_lay_48_candidate_after_hiding_has_no_hidden_point(api):
    make_layer(api)  # visible, selection = floor
    r = api.client.post(
        "/api/session/candidate", json={"cloud_revision": api.cloud()}
    )
    cand = api.wait(r)["result"]
    assert cand["candidates"] == 100
    r = api.client.patch(f"{L}/1", json={"visible": False})
    assert r.status_code == 200 and r.json()["selection"]["count"] == 0
    r = api.client.post(
        "/api/session/candidate", json={"cloud_revision": api.cloud()}
    )
    assert api.wait(r)["result"]["candidates"] == 0


def test_lay_49_nearest_ignores_hidden_points(api):
    make_layer(api)
    near = {"point": [0, 0, 0], "radius": 0.1}
    assert api.client.post("/api/session/nearest", json=near).json()["id"] == 0
    api.client.patch(f"{L}/1", json={"visible": False})
    assert api.client.post("/api/session/nearest", json=near).json() == {
        "id": None
    }


def test_lay_50_cluster_and_sparse_exclude_hidden(api):
    make_layer(api, visible=False)
    tool = {
        "type": "cluster",
        "seed_id": 105,
        "radius": 1.5,
        "exclude_protected": False,
    }
    job = api.select_wait(tool)
    assert job["status"] == "complete", job
    ids = api.candidate_ids(job["result"]["candidate"]["candidate_id"])
    assert ids and ids <= SCENE_GHOST
    job = api.select_wait(
        {"type": "sparse", "radius": 1.5, "min_neighbours": 100}
    )
    assert job["status"] == "complete", job
    ids = api.candidate_ids(job["result"]["candidate"]["candidate_id"])
    assert not (ids & SCENE_FLOOR)


def test_lay_51_preview_and_commit_exclude_hidden(api):
    make_layer(api, visible=False)
    api.select_wait(GHOST_BOX)
    r = api.client.post(
        "/api/session/selection/preview",
        json={
            "cloud_revision": api.cloud(),
            "op": "add",
            "scope": "active",
            "tool": ALL_BOX,
        },
    )
    prev = api.wait(r)
    assert prev["status"] == "complete", prev
    pid = prev["result"]["preview_id"]
    r = api.client.post(
        "/api/session/selection/commit",
        json={"cloud_revision": api.cloud(), "preview_id": pid},
    )
    job = api.wait(r)
    ids = api.candidate_ids(job["result"]["candidate"]["candidate_id"])
    assert ids == SCENE_GHOST


def test_lay_52_apply_deletes_no_hidden_point_and_asks_nothing(api):
    make_layer(api)
    r = api.client.post(
        "/api/session/candidate", json={"cloud_revision": api.cloud()}
    )
    stale = api.wait(r)["result"]["candidate_id"]
    api.client.patch(f"{L}/1", json={"visible": False})
    r = api.apply(stale)
    assert (
        r.status_code == 409
    )  # the live candidate was dropped by the layer change
    job = api.select_wait(ALL_BOX)
    cand = job["result"]["candidate"]
    r = api.apply(cand["candidate_id"])
    assert r.status_code == 200
    assert r.json()["counts"]["deleted"] == 27
    assert r.json()["layers"][0]["count"] == 100


def test_lay_53_patch_name_colour_visibility(api):
    make_layer(api)
    r = api.client.patch(f"{L}/1", json={"name": "Boden", "colour": 5})
    assert r.status_code == 200
    lay = r.json()["layers"][0]
    assert (lay["name"], lay["colour"], lay["visible"]) == ("Boden", 5, True)
    for body, c in (
        ({"colour": 16}, 422),
        ({"name": ""}, 422),
        ({"name": "x" * 41}, 422),
        ({"colour": "a"}, 422),
        ({"extra": 1}, 422),
    ):
        assert api.client.patch(f"{L}/1", json=body).status_code == c, body
    r = api.client.patch(f"{L}/9", json={"name": "x"})
    assert r.status_code == 404 and code(r) == "no_such_layer"


def test_lay_54_bulk_visibility(api):
    make_layer(api, name="a")
    make_layer(api, tool=GHOST_BOX, name="b")
    r = api.client.put(f"{L}/visibility", json={"ids": None, "visible": False})
    assert [x["visible"] for x in r.json()["layers"]] == [False, False]
    assert r.json()["counts"]["hidden"] == 127
    r = api.client.put(f"{L}/visibility", json={"ids": [2], "visible": True})
    assert [x["visible"] for x in r.json()["layers"]] == [False, True]
    r = api.client.put(f"{L}/visibility", json={"ids": [2, 9], "visible": True})
    assert r.status_code == 404 and code(r) == "no_such_layer"
    r = api.client.put(f"{L}/visibility", json={"visible": True})
    assert r.status_code == 422


def test_lay_55_the_session_header_is_checked(api):
    make_layer(api)
    h = {"X-Session-Id": "0" * 32}
    rev = api.cloud()
    calls = [
        ("post", L, {"cloud_revision": rev}),
        ("post", f"{L}/1/assign", {"cloud_revision": rev}),
        ("post", f"{L}/1/set-members", {"cloud_revision": rev}),
        ("patch", f"{L}/1", {"name": "x"}),
        ("put", f"{L}/visibility", {"ids": None, "visible": True}),
    ]
    for method, url, body in calls:
        r = getattr(api.client, method)(url, headers=h, json=body)
        assert r.status_code == 409 and code(r) == "session_changed", url
    r = api.client.request(
        "DELETE", f"{L}/1", headers=h, json={"cloud_revision": rev}
    )
    assert r.status_code == 409 and code(r) == "session_changed"


def test_lay_56_the_layer_select_tool(api):
    make_layer(api, name="Floor")
    job = api.select_wait({"type": "layer", "layer_id": 1})
    assert job["status"] == "complete", job
    st = api.state()
    assert st["selection"]["count"] == 100
    assert st["selection"]["ops"][-1]["tool"] == {
        "type": "layer",
        "layer_id": 1,
    }
    r = api.select({"type": "layer", "layer_id": 9})
    assert r.status_code == 404 and code(r) == "no_such_layer"
    api.client.patch(f"{L}/1", json={"visible": False})
    r = api.select({"type": "layer", "layer_id": 1})
    assert r.status_code == 422 and code(r) == "layer_hidden"
    r = api.client.post(
        "/api/session/selection/preview",
        json={
            "cloud_revision": api.cloud(),
            "op": "add",
            "scope": "active",
            "tool": {"type": "layer", "layer_id": 1},
        },
    )
    assert r.status_code == 422 and code(r) == "layer_hidden"
    assert api.select({"type": "layer", "layer_id": 0}).status_code == 422


def test_lay_56b_a_layer_less_render_has_no_layer_header(api):
    r, _c, ids, _f = api.render()
    assert "X-Layers" not in r.headers and len(ids) == 127


def export_job(api, layers, scope="active"):
    r = api.client.post(
        "/api/session/export",
        json={"format": "ascii", "scope": scope, "layers": layers},
    )
    return api.wait(r)


def test_lay_57_export_by_layer_ignores_visibility(api):
    make_layer(api, name="Floor")
    api.client.patch(f"{L}/1", json={"visible": False})
    whole = exported_z(api, "active")[1]
    every = export_job(api, None)["result"]["count"]
    assert every == whole
    only = export_job(api, [1])["result"]["count"]
    main = export_job(api, [0])["result"]["count"]
    assert only == 100 and main == whole - 100
    both = export_job(api, [0, 1])["result"]["count"]
    assert both == whole


def test_lay_58_export_layer_errors(api):
    make_layer(api, name="Floor")
    bad = export_job(api, [7])
    assert bad["status"] == "failed", bad
    assert bad["error"]["code"] == "unknown_layer"
    none = export_job(api, [])
    assert none["status"] == "failed", none
    assert none["error"]["code"] == "no_layers_chosen"
