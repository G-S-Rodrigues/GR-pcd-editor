"""API-109..116: the Planes and Thin routes. Lives in tests/unit: an integration test would raise the inherited
RSS high-water of PCD-61 (see the part 12-9 note in docs/agents/testing.md). RED was seen as 404/422 answers and
unknown tool types with the part 20 backend moved aside."""

import threading
import time

import numpy as np
import pytest

from fixtures.pcdgen import (
    SCENE_FIELDS,
    SCENE_FLOOR,
    build_pcd,
    scene_rows,
)
from fixtures.sessions import (
    fixture_dir,
    make_client,
    make_settings,
    open_via_upload,
    write_scene,
)
from gr_pcd.app import create_app
from gr_pcd.editing.planes import PlaneSpec, plane_mask
from gr_pcd.editing.protection import Interval, ProtectionState
from gr_pcd.pcd.reader import read_pcd


@pytest.fixture
def api(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    client = make_client(create_app(settings))
    r = open_via_upload(client, fixture_dir(settings) / "scene.pcd")
    assert r.status_code == 200, r.text
    client.settings = settings
    return client


def sess(api):
    return api.app.state.manager.require()


def rev(api):
    return api.get("/api/session").json()["revision"]["cloud"]


def wait(api, r, want=202):
    assert r.status_code == want, r.text
    end = time.time() + 20
    while True:
        job = api.get(f"/api/jobs/{r.json()['id']}").json()
        if job["status"] not in ("queued", "running"):
            return job
        assert time.time() < end
        time.sleep(0.01)


def detect(api, **kw):
    body = {"cloud_revision": rev(api), "scope": "active", **kw}
    return api.post("/api/session/planes/detect", json=body)


def select(api, tool, route="selection", op="replace", **extra):
    body = {
        "cloud_revision": rev(api),
        "op": op,
        "scope": "active",
        "tool": tool,
        **extra,
    }
    return api.post(f"/api/session/{route}", json=body)


def apply_candidate(api, job):
    cid = job["result"]["candidate"]["candidate_id"]
    r = api.post(
        "/api/session/apply",
        json={"cloud_revision": rev(api), "candidate_id": cid},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_api_109_detect_returns_the_floor_and_changes_nothing(api):
    before = api.get("/api/session").json()
    job = wait(api, detect(api, max_planes=1))
    assert job["status"] == "complete", job
    res = job["result"]
    assert res["cloud_revision"] == before["revision"]["cloud"]
    (p,) = res["planes"]
    assert p["count"] == len(SCENE_FLOOR)
    assert abs(p["normal"][2] - 1.0) < 1e-9 and abs(p["d"]) < 1e-9
    assert p["tilt_deg"] < 1e-6 and abs(p["z_centre"]) < 1e-9
    after = api.get("/api/session").json()
    assert after["revision"] == before["revision"]  # incl. params_revision
    assert after["counts"] == before["counts"]
    assert after["history"] == before["history"]
    assert after["counts"]["selected"] == 0


@pytest.fixture
def held(monkeypatch):
    """Replace the detection with one that waits until released or cancelled."""
    import gr_pcd.session.engine as eng

    gate = threading.Event()
    started = threading.Event()

    def slow(xyz, eligible, spec, token=None, on_progress=None, centre=None):
        started.set()
        while not gate.is_set():
            token.check()
            time.sleep(0.005)
        return []

    monkeypatch.setattr(eng, "detect_planes", slow)
    yield gate, started
    gate.set()


def status(api, r):
    return api.get(f"/api/jobs/{r.json()['id']}").json()["status"]


def test_api_110_a_new_detect_cancels_the_old_one_and_a_select_queues_behind(
    api, held
):
    gate, started = held
    first = detect(api)
    assert first.status_code == 202
    assert started.wait(5)
    second = detect(api)
    assert second.status_code == 202
    end = time.time() + 5
    while status(api, first) not in ("cancelled", "complete", "failed"):
        assert time.time() < end
        time.sleep(0.01)
    assert status(api, first) == "cancelled"
    # a select is not cancelled by a detect: it waits for the single worker and then completes
    sel = select(api, {"type": "thin", "method": "voxel", "edge": 100.0})
    assert sel.status_code == 202
    time.sleep(0.1)
    assert status(api, sel) == "queued"
    gate.set()
    assert wait(api, sel, 202)["status"] == "complete"
    # DELETE-style cancel of a running detect
    gate.clear()
    third = detect(api)
    time.sleep(0.1)
    assert api.post(f"/api/jobs/{third.json()['id']}/cancel").status_code == 200
    end = time.time() + 5
    while status(api, third) not in ("cancelled", "complete", "failed"):
        assert time.time() < end
        time.sleep(0.01)
    assert status(api, third) == "cancelled"
    gate.set()


def test_api_111_detect_refusals(api):
    for kw in (
        {"distance": 0.0},
        {"max_tilt_deg": 120.0},
        {"max_planes": 99},
        {"iterations": 0},
        {"seed": -1},
    ):
        r = detect(api, **kw)
        assert r.status_code == 422, (kw, r.text)
        assert r.json()["error"]["code"] == "invalid_tool", kw
    bad = api.post(
        "/api/session/planes/detect",
        json={"cloud_revision": rev(api) + 5, "scope": "active"},
    )
    assert bad.status_code == 409
    assert bad.json()["error"]["code"] == "stale_revision"
    sess(api).budget = 10
    r = detect(api)
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "memory_budget_exceeded"


def test_api_112_a_detected_plane_selects_the_oracle_count(api):
    (p,) = wait(api, detect(api, max_planes=1))["result"]["planes"]
    tool = {
        "type": "plane",
        "normal": p["normal"],
        "d": p["d"],
        "thickness": 0.03,
    }
    job = wait(api, select(api, tool))
    assert job["status"] == "complete", job
    s = sess(api)
    want = int(
        plane_mask(s.xyz, PlaneSpec(tuple(p["normal"]), p["d"], 0.03))[
            s.active & s.valid
        ].sum()
    )
    assert want == len(SCENE_FLOOR)
    assert job["result"]["selected"] == want
    info = job["result"]["plane"]
    assert info["count"] == want and info["thickness"] == 0.03
    assert info["normal"] == p["normal"] and info["d"] == p["d"]
    assert api.get("/api/session").json()["counts"]["selected"] == want
    for bad in (
        dict(tool, normal=[0.0, 0.0]),
        dict(tool, bogus=1),
        dict(tool, region={"type": "plane"}),
    ):
        assert select(api, bad).status_code == 422
    for bad in (dict(tool, thickness=0.0), dict(tool, normal=[0.0, 0.0, 2.0])):
        j = wait(api, select(api, bad))
        assert j["status"] == "failed" and j["error"]["code"] == "invalid_tool"


def test_api_113_plane_then_delete_then_undo_restores_exactly(api):
    s = sess(api)
    active0 = s.active.copy()
    tool = {
        "type": "plane",
        "normal": [0.0, 0.0, 1.0],
        "d": 0.0,
        "thickness": 0.5,
    }
    job = wait(api, select(api, tool))
    state = apply_candidate(api, job)
    (entry,) = state["history"]["entries"]
    assert "plane" in entry["description"].lower()
    assert str(len(SCENE_FLOOR)) in entry["description"]
    assert entry["count"] == len(SCENE_FLOOR) and entry["tool"] == "selection"
    assert entry["shape"]["type"] == "plane"
    assert not s.active[:100].any()
    r = api.post("/api/session/undo", json={"cloud_revision": rev(api)})
    assert r.status_code == 200, r.text
    assert np.array_equal(s.active, active0)


def dup_scene(settings):
    rows = scene_rows() + scene_rows()[:37]  # 37 exact duplicates of floor rows
    path = fixture_dir(settings) / "dups.pcd"
    path.write_bytes(build_pcd(SCENE_FIELDS, rows, "binary"))
    return path


def test_api_114_thin_duplicates_select_37_and_export_has_none(tmp_path):
    settings = make_settings(tmp_path)
    client = make_client(create_app(settings))
    r = open_via_upload(client, dup_scene(settings))
    assert r.status_code == 200, r.text
    job = wait(
        client,
        select(client, {"type": "thin", "method": "duplicates", "distance": 0}),
    )
    assert job["status"] == "complete", job
    assert job["result"]["selected"] == 37
    s = sess(client)
    got = set(np.flatnonzero(s.selection).tolist())
    assert got == set(
        range(129, 129 + 37)
    )  # the later copies; the lowest index is kept
    apply_candidate(client, job)
    ex = wait(
        client,
        client.post(
            "/api/session/export", json={"format": "binary", "scope": "active"}
        ),
    )
    assert ex["status"] == "complete", ex
    data = client.get(f"/api/exports/{ex['result']['export_id']}").content
    cloud = read_pcd(data)
    xyz = np.stack([cloud.records[f"c{k}"] for k in range(3)], axis=1)
    xyz = xyz[np.isfinite(xyz).all(axis=1)]
    assert len(np.unique(xyz, axis=0)) == len(xyz) == 127
    assert cloud.n == 129


def test_api_115_voxel_selects_n_minus_occupied_and_composes(api):
    edge = 2.0
    s = sess(api)
    ok = s.active & s.valid
    pts = s.xyz[ok]
    cells = np.floor((pts - pts.min(axis=0)) / edge).astype(np.int64)
    occupied = len({tuple(c) for c in cells})
    voxel = {"type": "thin", "method": "voxel", "edge": edge}
    job = wait(api, select(api, voxel))
    assert job["status"] == "complete", job
    assert job["result"]["selected"] == len(pts) - occupied
    pre = wait(api, select(api, voxel, "selection/preview", op="subtract"))
    assert pre["status"] == "complete" and pre["result"]["selected_after"] == 0
    c = wait(
        api,
        api.post(
            "/api/session/selection/commit",
            json={
                "cloud_revision": rev(api),
                "preview_id": pre["result"]["preview_id"],
            },
        ),
    )
    assert c["status"] == "complete"
    assert api.get("/api/session").json()["counts"]["selected"] == 0
    add = wait(api, select(api, voxel, "selection/preview", op="add"))
    assert add["result"]["selected_after"] == len(pts) - occupied


def test_api_116_exclude_protected_keeps_protected_points_out(api):
    s = sess(api)
    s.set_protection(ProtectionState(Interval(True, -0.5, 0.5)))  # the floor
    big = {
        "type": "thin",
        "method": "voxel",
        "edge": 100.0,
        "exclude_protected": True,
    }
    job = wait(api, select(api, big))
    got = set(np.flatnonzero(s.selection).tolist())
    assert job["status"] == "complete" and not got & set(range(100))
    assert len(got) == 26  # the 27 ghosts, the first one kept
    plane = {
        "type": "plane",
        "normal": [0.0, 0.0, 1.0],
        "d": 0.0,
        "thickness": 0.5,
        "exclude_protected": True,
    }
    wait(api, select(api, plane))
    assert int(s.selection.sum()) == 0
    wait(api, select(api, dict(plane, exclude_protected=False)))
    assert int(s.selection.sum()) == 100
