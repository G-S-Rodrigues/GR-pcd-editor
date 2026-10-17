"""API-01..30: the HTTP surface, end to end over a generated PCD."""

import json
import shutil
import struct
import time
import zipfile

import numpy as np
import pytest

from fixtures.pcdgen import (
    SCENE_FLOOR,
    SCENE_GHOST,
    build_pcd,
    scene_rows,
    xyz_fields,
)
from fixtures.sessions import make_client, make_settings, write_scene
from gr_pcd.app import create_app

GHOST_BOX = {
    "type": "box",
    "center": [3, 3, 2],
    "dimensions": [2, 2, 2],
}
CORNER_BOX = {"type": "box", "center": [0.5, 0.5, 0], "dimensions": [1, 1, 0.5]}
CORNER = {0, 1, 10, 11}
ALL_VALID = set(range(127))


class Api:
    def __init__(self, settings):
        self.settings = settings
        self.client = make_client(create_app(settings))

    def open(self, name="scene.pcd"):
        r = self.client.post("/api/session/open", json={"path": name})
        assert r.status_code == 200, r.text
        return r.json()

    def state(self):
        return self.client.get("/api/session").json()

    def cloud(self):
        return self.state()["revision"]["cloud"]

    def wait(self, response, timeout=20.0):
        assert response.status_code == 202, response.text
        jid = response.json()["id"]
        end = time.time() + timeout
        while True:
            job = self.client.get(f"/api/jobs/{jid}").json()
            if job["status"] not in ("queued", "running"):
                return job
            assert time.time() < end, job
            time.sleep(0.01)

    def select(self, tool, op="replace", scope="active", **extra):
        body = {
            "cloud_revision": self.cloud(),
            "op": op,
            "scope": scope,
            "tool": tool,
            **extra,
        }
        return self.client.post("/api/session/selection", json=body)

    def select_wait(self, *a, **k):
        return self.wait(self.select(*a, **k))

    def candidate_ids(self, cid):
        r = self.client.get(
            "/api/session/candidate/ids", params={"candidate_id": cid}
        )
        assert r.status_code == 200, r.text
        return set(r.json()["ids"])

    def apply(self, cid, **extra):
        return self.client.post(
            "/api/session/apply",
            json={"cloud_revision": self.cloud(), "candidate_id": cid, **extra},
        )

    def render(self, mode="edited", budget=1000):
        r = self.client.get(
            "/api/session/render", params={"mode": mode, "budget": budget}
        )
        assert r.status_code == 200, r.text
        n = int(r.headers["X-Count"])
        body = r.content
        assert len(body) == n * 12 + n * 4 + n
        coords = np.frombuffer(body, "<f4", n * 3).reshape(n, 3)
        ids = np.frombuffer(body, "<u4", n, n * 12)
        flags = np.frombuffer(body, "u1", n, n * 16)
        return r, coords, ids, flags


@pytest.fixture
def api(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    return Api(settings)


def write_chain(settings, n=100_000):
    rows = [(0.5 * i, 0.0, 0.0) for i in range(n)]
    (settings.data_root / "chain.pcd").write_bytes(
        build_pcd(xyz_fields(8), rows, "binary")
    )


def start_slow_cluster(api):
    write_chain(api.settings)
    api.open("chain.pcd")
    tool = {"type": "cluster", "seed_id": 0, "radius": 0.5, "max_points": None}
    r = api.select(tool, scope="active")
    jid = r.json()["id"]
    end = time.time() + 10
    while api.client.get(f"/api/jobs/{jid}").json()["status"] != "running":
        assert time.time() < end
        time.sleep(0.005)
    return jid


def test_api_01_no_session(api):
    r = api.client.get("/api/session")
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_session"


@pytest.mark.parametrize("encoding", ["ascii", "binary", "binary_compressed"])
def test_api_02_open(tmp_path, encoding):
    settings = make_settings(tmp_path)
    write_scene(settings, "s.pcd", encoding)
    a = Api(settings)
    st = a.open("s.pcd")
    assert st["encoding"] == encoding and st["counts"]["original"] == 129
    assert st["bounds"]["max"] == [9.0, 9.0, 3.0]
    assert a.client.get("/health").json() == {"status": "ok"}


def test_api_03_open_errors(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    (settings.data_root / "bad.pcd").write_bytes(b"VERSION .7\nDATA ascii\n")
    outside = tmp_path / "outside.pcd"
    outside.write_bytes(b"x")
    (settings.data_root / "link.pcd").symlink_to(outside)
    a = Api(settings)

    def code(path):
        r = a.client.post("/api/session/open", json={"path": path})
        return r.status_code, r.json()["error"]["code"]

    assert code("../outside.pcd") == (422, "path_escape")
    assert code(str(outside)) == (422, "path_escape")
    assert code("link.pcd") == (422, "path_escape")
    assert code("bad.pcd")[0] == 422
    assert code("missing.pcd") == (404, "not_found")
    small = Api(make_settings(tmp_path / "t", memory_budget_bytes=100))
    write_scene(small.settings)
    r = small.client.post("/api/session/open", json={"path": "scene.pcd"})
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "memory_budget_exceeded"


def test_api_04_state_shape(api):
    st = api.open()
    assert set(st) == {
        "session_id", "filename", "encoding", "schema", "width", "height",
        "viewpoint", "counts", "bounds", "active_bounds", "revision",
        "display_filter", "protection", "selection", "history", "unit",
        "unsaved", "client_state",
    }  # fmt: skip
    assert set(st["counts"]) == {
        "original", "active", "deleted", "invalid_total", "invalid_active",
        "displayed", "selected", "protected",
    }  # fmt: skip
    assert set(st["history"]) == {
        "entries", "cursor", "can_undo", "can_redo",
    }  # fmt: skip


def test_api_05_filter_and_protection_validation(api):
    api.open()
    c = api.client
    r = c.put(
        "/api/session/display-filter",
        content='{"x":{"enabled":true,"min":NaN,"max":1}}',
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 422
    r = c.put(
        "/api/session/display-filter",
        json={"x": {"enabled": True, "min": 2, "max": 1}},
    )
    assert (
        r.status_code == 422 and r.json()["error"]["code"] == "invalid_filter"
    )
    r = c.put(
        "/api/session/protection",
        json={"operation": {"mode": "override", "local": {"min": 0, "max": 1}}},
    )
    assert r.json()["error"]["code"] == "override_not_acknowledged"
    before = api.state()["revision"]
    r = c.put(
        "/api/session/display-filter",
        json={"z": {"enabled": True, "min": 0, "max": 1}},
    )
    after = r.json()["revision"]
    assert after["cloud"] == before["cloud"]
    assert after["params"] == before["params"] + 1


def test_api_06_box_selection(api):
    api.open()
    job = api.select_wait(GHOST_BOX)
    assert job["status"] == "complete" and job["complete"] is True
    cand = job["result"]["candidate"]
    assert job["result"]["selected"] == 27
    assert cand["candidates"] == 27 and cand["protected_retained"] == 0
    assert cand["bounds"] == {"min": [2, 2, 1], "max": [4, 4, 3]}
    assert api.candidate_ids(cand["candidate_id"]) == SCENE_GHOST


def test_api_07_prism_selection(api):
    api.open()
    tool = {
        "type": "prism",
        "polygon": [[1.5, 1.5], [4.5, 1.5], [4.5, 4.5], [1.5, 4.5]],
        "z_min": 0.5,
        "z_max": 3.5,
    }
    job = api.select_wait(tool)
    ids = api.candidate_ids(job["result"]["candidate"]["candidate_id"])
    assert ids == SCENE_GHOST


def test_api_08_filter_tool_beyond_render_budget(api):
    api.open()
    api.client.put(
        "/api/session/display-filter",
        json={"z": {"enabled": True, "min": 0, "max": 0}},
    )
    job = api.select_wait({"type": "filter"}, scope="displayed")
    cand = job["result"]["candidate"]
    assert api.candidate_ids(cand["candidate_id"]) == SCENE_FLOOR
    assert api.render(budget=5)[1].shape[0] <= 5  # sampling is display only
    api.client.put("/api/session/display-filter", json={})
    api.select_wait(GHOST_BOX)
    api.client.put(
        "/api/session/display-filter",
        json={"z": {"enabled": True, "min": 0, "max": 0}},
    )
    r = api.client.post(
        "/api/session/candidate", json={"cloud_revision": api.cloud()}
    )
    cand = api.wait(r)["result"]
    assert cand["selected_outside_display_filter"] == 27


def test_api_09_selection_algebra(api):
    api.open()

    def ids_after(tool, op, scope="active"):
        job = api.select_wait(tool, op=op, scope=scope)
        return api.candidate_ids(job["result"]["candidate"]["candidate_id"])

    assert ids_after(GHOST_BOX, "replace") == SCENE_GHOST
    assert ids_after(CORNER_BOX, "add") == SCENE_GHOST | CORNER
    assert ids_after(CORNER_BOX, "subtract") == SCENE_GHOST
    assert ids_after(CORNER_BOX, "intersect") == set()
    assert ids_after(CORNER_BOX, "replace") == CORNER
    assert ids_after(None, "invert") == ALL_VALID - CORNER


def test_api_10_protection_end_to_end(api):
    api.open()
    c = api.client

    def candidate():
        r = c.post(
            "/api/session/candidate", json={"cloud_revision": api.cloud()}
        )
        return api.wait(r)["result"]

    api.select_wait(GHOST_BOX)
    c.put(
        "/api/session/protection",
        json={"global": {"enabled": True, "min": 0.5, "max": 1.5}},
    )
    cand = candidate()
    assert (cand["protected_retained"], cand["candidates"]) == (9, 18)
    c.put(
        "/api/session/protection",
        json={
            "global": {"enabled": True, "min": 0.5, "max": 1.5},
            "operation": {
                "mode": "add_local",
                "local": {"min": 1.5, "max": 2.5},
            },
        },
    )
    cand = candidate()
    assert (cand["protected_retained"], cand["candidates"]) == (18, 9)
    assert cand["effective_protection"]["intervals"] == [[0.5, 1.5], [1.5, 2.5]]
    c.put(
        "/api/session/protection",
        json={
            "global": {"enabled": True, "min": 0.5, "max": 1.5},
            "operation": {
                "mode": "override",
                "local": {"min": 2.5, "max": 3.5},
                "acknowledge_override": True,
            },
        },
    )
    cand = candidate()
    assert (cand["protected_retained"], cand["candidates"]) == (9, 18)
    st = api.apply(cand["candidate_id"]).json()
    assert st["protection"]["operation"]["mode"] == "inherit"
    assert st["protection"]["global"]["enabled"] is True
    api.select_wait(GHOST_BOX)
    cand = candidate()
    assert cand["effective_protection"]["intervals"] == [[0.5, 1.5]]


def test_api_11_cluster(api):
    api.open()
    api.client.put(
        "/api/session/protection",
        json={"global": {"enabled": True, "min": -0.1, "max": 0.1}},
    )
    tool = {"type": "cluster", "seed_id": 100, "radius": 1.0}
    job = api.select_wait(tool)
    assert job["status"] == "complete"
    assert job["result"]["selected"] == 27
    assert job["result"]["candidate"]["cluster"]["size"] == 27
    api.client.put("/api/session/protection", json={})
    job = api.select_wait(tool)
    assert job["result"]["selected"] == 127  # floor now bridges
    job = api.select_wait({**tool, "seed_id": 127})
    assert job["status"] == "failed" and job["error"]["code"] == "invalid_seed"
    job = api.select_wait({**tool, "max_points": 5})
    assert job["status"] == "failed"
    assert job["error"]["code"] == "component_limit_reached"
    assert "result" not in job


def test_api_12_cluster_cancel(api):
    jid = start_slow_cluster(api)
    r = api.client.post(f"/api/jobs/{jid}/cancel")
    assert r.status_code == 200
    end = time.time() + 20
    while True:
        job = api.client.get(f"/api/jobs/{jid}").json()
        if job["status"] not in ("queued", "running"):
            break
        assert time.time() < end
        time.sleep(0.01)
    assert job["status"] == "cancelled" and "result" not in job
    assert api.state()["selection"]["count"] == 0


def test_api_13_apply_and_reapply(api):
    api.open()
    cand = api.select_wait(GHOST_BOX)["result"]["candidate"]
    r = api.apply(cand["candidate_id"])
    st = r.json()
    assert r.status_code == 200 and st["counts"]["deleted"] == 27
    assert st["history"]["entries"][0]["count"] == 27
    assert api.apply(cand["candidate_id"]).status_code == 409


def test_api_14_undo_redo_and_stale(api):
    api.open()
    cand = api.select_wait(GHOST_BOX)["result"]["candidate"]
    api.apply(cand["candidate_id"])
    rev = api.cloud()
    _, _, ids, _ = api.render("deleted")
    assert set(ids.tolist()) == SCENE_GHOST
    r = api.client.post("/api/session/undo", json={"cloud_revision": rev})
    assert r.json()["counts"]["deleted"] == 0
    stale = api.client.post("/api/session/redo", json={"cloud_revision": rev})
    assert stale.status_code == 409
    err = stale.json()["error"]
    assert (
        err["code"] == "stale_revision" and err["current"]["cloud"] == rev + 1
    )
    r = api.client.post("/api/session/redo", json={"cloud_revision": rev + 1})
    assert r.json()["counts"]["deleted"] == 27
    r = api.client.post("/api/session/redo", json={"cloud_revision": rev + 2})
    assert r.json()["error"]["code"] == "nothing_to_redo"


def test_api_15_remove_invalid(api):
    api.open()
    r = api.client.post(
        "/api/session/remove-invalid", json={"cloud_revision": api.cloud()}
    )
    assert r.json()["counts"]["invalid_active"] == 0
    r = api.client.post(
        "/api/session/remove-invalid", json={"cloud_revision": api.cloud()}
    )
    assert r.json()["error"]["code"] == "nothing_to_remove"
    r = api.client.post(
        "/api/session/undo", json={"cloud_revision": api.cloud()}
    )
    assert r.json()["counts"]["invalid_active"] == 2


def test_api_16_render_layout(api):
    api.open()
    r, coords, ids, flags = api.render("original", 1000)
    assert int(r.headers["X-Eligible"]) == 127 and len(ids) == 127
    origin = np.array([float(v) for v in r.headers["X-Origin"].split(",")])
    rows = np.array(scene_rows())
    back = coords.astype(np.float64) + origin
    assert (back == rows[ids, :3]).all()
    r, coords, ids, flags = api.render("original", 10)
    assert len(ids) <= 10 and int(r.headers["X-Eligible"]) == 127
    before = api.select_wait(GHOST_BOX)["result"]["candidate"]["candidates"]
    api.render("edited", 3)
    after = api.client.post(
        "/api/session/candidate", json={"cloud_revision": api.cloud()}
    )
    assert api.wait(after)["result"]["candidates"] == before == 27
    _, _, ids, flags = api.render("edited", 1000)
    assert {int(i) for i, f in zip(ids, flags) if f == 1} == SCENE_GHOST


def test_api_17_render_modes_match_counts(api):
    api.open()
    cand = api.select_wait(GHOST_BOX)["result"]["candidate"]
    st = api.apply(cand["candidate_id"]).json()
    c = st["counts"]
    n_edit = len(api.render("edited")[2])
    n_del = len(api.render("deleted")[2])
    n_orig = len(api.render("original")[2])
    assert n_edit == c["active"] - c["invalid_active"] and n_del == c["deleted"]
    assert n_orig == n_edit + n_del


def test_api_18_race_filter_during_select(api):
    api.open()
    old = api.select_wait(GHOST_BOX)["result"]["candidate"]["candidate_id"]
    r = api.select(GHOST_BOX, op="add")
    api.client.put(
        "/api/session/display-filter",
        json={"z": {"enabled": True, "min": 0, "max": 5}},
    )
    job = api.wait(r)
    assert job["status"] in ("complete", "stale")
    assert api.apply(old).status_code == 409
    if job["status"] == "complete":
        cid = job["result"]["candidate"]["candidate_id"]
        cand_rev = job["result"]["candidate"]["params_revision"]
        expect = 200 if cand_rev == api.state()["revision"]["params"] else 409
        assert api.apply(cid).status_code == expect
    else:
        fresh = api.client.post(
            "/api/session/candidate", json={"cloud_revision": api.cloud()}
        )
        cid = api.wait(fresh)["result"]["candidate_id"]
        assert api.apply(cid).status_code == 200


def test_api_19_second_tab(api):
    api.open()
    old = api.cloud()
    cand = api.select_wait(GHOST_BOX)["result"]["candidate"]
    api.apply(cand["candidate_id"])
    body = {"cloud_revision": old}
    assert api.client.post("/api/session/undo", json=body).status_code == 409
    assert (
        api.client.post("/api/session/candidate", json=body).status_code == 409
    )
    sel = {"cloud_revision": old, "op": "replace", "tool": GHOST_BOX}
    assert (
        api.client.post("/api/session/selection", json=sel).status_code == 409
    )
    r = api.client.post(
        "/api/session/apply",
        json={**body, "candidate_id": cand["candidate_id"]},
    )
    assert r.status_code == 409


def test_api_20_new_select_supersedes(api):
    jid = start_slow_cluster(api)
    other = api.select(
        {"type": "box", "center": [0, 0, 0], "dimensions": [1, 1, 1]}
    )
    api.wait(other)
    end = time.time() + 20
    while api.client.get(f"/api/jobs/{jid}").json()["status"] in (
        "queued",
        "running",
    ):
        assert time.time() < end
        time.sleep(0.01)
    assert api.client.get(f"/api/jobs/{jid}").json()["status"] == "cancelled"


def test_api_21_nearest(api):
    api.open()
    r = api.client.post(
        "/api/session/nearest", json={"point": [3.1, 3, 2], "radius": 0.5}
    )
    assert r.json()["id"] == 113 and r.json()["point"] == [3.0, 3.0, 2.0]
    r = api.client.post(
        "/api/session/nearest", json={"point": [50, 50, 50], "radius": 0.5}
    )
    assert r.json() == {"id": None}


def test_api_22_export_download(api):
    api.open()
    cand = api.select_wait(GHOST_BOX)["result"]["candidate"]
    api.apply(cand["candidate_id"])
    r = api.client.post("/api/session/export", json={"format": "binary"})
    job = api.wait(r)
    res = job["result"]
    assert res["count"] == 102 and res["invalid_retained"] == 2
    d = api.client.get(f"/api/exports/{res['export_id']}")
    assert d.status_code == 200
    assert "scene_cleaned.pcd" in d.headers["content-disposition"]
    body = d.content
    assert b"DATA binary" in body and b"POINTS 102" in body
    _head, _, data = body.partition(b"DATA binary\n")
    assert len(data) == 102 * 16
    first = struct.unpack("<4f", data[:16])
    assert first == (0.0, 0.0, 0.0, 0.5)
    r = api.client.post(
        "/api/session/export", json={"format": "ascii", "scope": "selected"}
    )
    res = api.wait(r)["result"]
    assert res["count"] == 0
    assert api.client.get("/api/exports/nope").status_code == 404


def test_api_23_export_cancel(api):
    jid = start_slow_cluster(api)
    r = api.client.post("/api/session/export", json={})
    ejid = r.json()["id"]
    cancelled = api.client.post(f"/api/jobs/{ejid}/cancel").json()
    api.client.post(f"/api/jobs/{jid}/cancel")
    assert cancelled["status"] == "cancelled"
    assert api.client.get(f"/api/exports/{ejid}").status_code == 404
    exports = api.settings.work_root / "exports"
    assert not exports.exists() or not list(exports.iterdir())


def saved(api):
    api.open()
    cand = api.select_wait(GHOST_BOX)["result"]["candidate"]
    api.apply(cand["candidate_id"])
    api.select_wait(CORNER_BOX)
    api.client.put(
        "/api/session/display-filter",
        json={"z": {"enabled": True, "min": -1, "max": 9}},
    )
    api.client.put("/api/session/client-state", json={"camera": [1, 2, 3]})
    job = api.wait(api.client.post("/api/session/save", json={}))
    assert job["status"] == "complete", job
    d = api.client.get(f"/api/session-archives/{job['result']['archive_id']}")
    assert d.status_code == 200
    return job["result"], d.content


def test_api_24_save_download(api, tmp_path):
    res, blob = saved(api)
    assert res["filename"] == "scene_session_v1.pcdsession"
    path = tmp_path / "dl.pcdsession"
    path.write_bytes(blob)
    with zipfile.ZipFile(path) as zf:
        assert "source.pcd" in zf.namelist()
        assert json.loads(zf.read("manifest.json"))["version"] == 1


def test_api_25_open_archive_and_mark_saved(api):
    _res, blob = saved(api)
    before = api.state()
    assert before["unsaved"] is True
    (api.settings.data_root / "a.pcdsession").write_bytes(blob)
    st = api.client.post(
        "/api/session/open-archive",
        json={"path": "a.pcdsession", "replace": True},
    ).json()
    assert st["counts"]["deleted"] == 27 and st["unsaved"] is False
    assert st["selection"]["count"] == 4
    assert st["display_filter"] == before["display_filter"]
    assert st["client_state"] == {"camera": [1, 2, 3]}
    assert st["history"]["cursor"] == 1
    # mark-saved flow on the original session
    api.open()
    cand = api.select_wait(GHOST_BOX)["result"]["candidate"]
    api.apply(cand["candidate_id"])
    job = api.wait(api.client.post("/api/session/save", json={}))
    assert api.state()["unsaved"] is True
    r = api.client.post(
        "/api/session/mark-saved",
        json={"archive_id": job["result"]["archive_id"]},
    )
    assert r.json()["unsaved"] is False


def test_api_26_tampered_archive_keeps_old_session(api, tmp_path):
    _, blob = saved(api)
    src = tmp_path / "src.pcdsession"
    src.write_bytes(blob)
    bad = api.settings.data_root / "bad.pcdsession"
    with zipfile.ZipFile(src) as zi, zipfile.ZipFile(bad, "w") as zo:
        for info in zi.infolist():
            data = zi.read(info)
            if info.filename == "source.pcd":
                data = data[:-1] + bytes([data[-1] ^ 1])
            zo.writestr(info.filename, data)
    before = api.state()
    r = api.client.post(
        "/api/session/open-archive",
        json={"path": "bad.pcdsession", "replace": True},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "source_hash_mismatch"
    assert api.state()["session_id"] == before["session_id"]


def test_api_27_fresh_app_reopens_archive(api, tmp_path):
    _, blob = saved(api)
    other = make_settings(tmp_path / "recreated")
    (other.data_root / "a.pcdsession").write_bytes(blob)
    fresh = Api(other)
    st = fresh.client.post(
        "/api/session/open-archive",
        json={"path": "a.pcdsession", "replace": True},
    ).json()
    assert st["counts"]["deleted"] == 27 and st["revision"]["cloud"] == 1


def test_api_28_client_state(api):
    api.open()
    before = api.state()["revision"]
    r = api.client.put("/api/session/client-state", json={"pivot": [0, 0, 0]})
    assert r.json() == {"ok": True}
    st = api.state()
    assert st["revision"] == before and st["history"]["entries"] == []
    assert st["client_state"] == {"pivot": [0, 0, 0]}
    big = {"blob": "x" * (1024 * 1024 + 10)}
    assert (
        api.client.put("/api/session/client-state", json=big).status_code == 413
    )
    r = api.client.put("/api/session/client-state", json=[1])
    assert r.status_code == 422


def test_api_29_error_shape(api):
    c = api.client
    calls = [
        c.get("/api/session"),
        c.post("/api/session/open", json={"path": "../x"}),
        c.post("/api/session/open", json={"path": "nope.pcd"}),
        c.post("/api/session/open", json={}),
        c.get("/api/jobs/none"),
        c.get("/api/exports/none"),
    ]
    api.open()
    calls += [
        c.post("/api/session/undo", json={"cloud_revision": 99}),
        c.post("/api/session/undo", json={"cloud_revision": api.cloud()}),
        c.put("/api/session/display-filter", json={"x": {"min": 3, "max": 1}}),
        c.post(
            "/api/session/apply",
            json={"cloud_revision": 1, "candidate_id": "z"},
        ),
    ]
    for r in calls:
        assert 400 <= r.status_code < 500
        err = r.json()["error"]
        assert isinstance(err["code"], str) and isinstance(err["message"], str)


def test_api_30_router_before_static_mount(tmp_path):
    settings = make_settings(tmp_path)
    app = create_app(settings)
    assert getattr(app.routes[-1], "path", None) == ""  # static mount last
    c = make_client(app)
    r = c.get("/api/session")  # the API router answers before the mount
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_session"
    c = make_client(app)
    assert c.get("/").status_code == 200
    assert c.get("/health").json() == {"status": "ok"}
    shutil.rmtree(tmp_path, ignore_errors=True)


def test_api_31_end_to_end_flow(api, tmp_path):
    """open -> box -> candidate -> apply -> undo -> export -> save -> reopen."""
    st = api.open()
    assert st["counts"]["original"] == 129
    job = api.select_wait(GHOST_BOX)
    cid = job["result"]["candidate"]["candidate_id"]
    again = api.client.post(
        "/api/session/candidate", json={"cloud_revision": api.cloud()}
    )
    cid = api.wait(again)["result"]["candidate_id"]
    st = api.apply(cid).json()
    assert st["counts"]["active"] == 102
    st = api.client.post(
        "/api/session/undo", json={"cloud_revision": api.cloud()}
    ).json()
    assert st["counts"]["active"] == 129
    st = api.client.post(
        "/api/session/redo", json={"cloud_revision": api.cloud()}
    ).json()
    exp = api.wait(api.client.post("/api/session/export", json={}))["result"]
    out = api.client.get(f"/api/exports/{exp['export_id']}").content
    assert b"POINTS 102" in out
    sav = api.wait(api.client.post("/api/session/save", json={}))["result"]
    blob = api.client.get(f"/api/session-archives/{sav['archive_id']}").content
    other = make_settings(tmp_path / "fresh")
    (other.data_root / "s.pcdsession").write_bytes(blob)
    fresh = Api(other)
    st = fresh.client.post(
        "/api/session/open-archive", json={"path": "s.pcdsession"}
    ).json()
    assert st["counts"]["active"] == 102 and st["history"]["cursor"] == 1
