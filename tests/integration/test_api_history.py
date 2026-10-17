"""API-80..86: history routes (rollback, delete-step, rename, step render)."""

import os
import subprocess
import sys

import numpy as np
import pytest
from test_api_session import CORNER_BOX, GHOST_BOX, Api

from fixtures.pcdgen import SCENE_GHOST, scene_rows
from fixtures.sessions import (
    fixture_dir,
    make_settings,
    write_scene,
)

MID_BOX = {"type": "box", "center": [5.5, 5.5, 0], "dimensions": [1, 1, 0.5]}
CORNER = {0, 1, 10, 11}
MIDDLE = {55, 56, 65, 66}
H = "/api/session/history"


@pytest.fixture
def api(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    a = Api(settings)
    a.open()
    return a


def delete(api, box):
    job = api.select_wait(box)
    assert job["status"] == "complete", job
    r = api.apply(job["result"]["candidate"]["candidate_id"])
    assert r.status_code == 200, r.text
    return r.json()


def three(api):
    for box in (CORNER_BOX, GHOST_BOX, MID_BOX):
        st = delete(api, box)
    return st


def gone(api):
    _r, _, ids, _ = api.render("deleted", budget=1000)
    return set(ids.tolist())


def post(api, route, **body):
    return api.client.post(f"{H}/{route}", json=body)


def test_api_80_rollback_route(api):
    st = three(api)
    assert st["history"]["cursor"] == 3
    r = post(api, "rollback", cloud_revision=api.cloud(), cursor=1)
    assert r.status_code == 200, r.text
    assert r.json()["history"]["cursor"] == 1
    assert gone(api) == CORNER
    r = post(api, "rollback", cloud_revision=api.cloud(), cursor=7)
    assert (
        r.status_code == 422 and r.json()["error"]["code"] == "invalid_cursor"
    )
    r = post(api, "rollback", cloud_revision=1, cursor=0)
    err = r.json()["error"]
    assert r.status_code == 409 and err["code"] == "stale_revision"
    assert err["current"]["cloud"] == api.cloud()
    r = api.client.post(
        f"{H}/rollback",
        json={"cloud_revision": api.cloud(), "cursor": 0},
        headers={"X-Session-Id": "nope"},
    )
    assert (
        r.status_code == 409 and r.json()["error"]["code"] == "session_changed"
    )
    r = post(api, "rollback", cloud_revision=api.cloud(), cursor=0, extra=1)
    assert r.status_code == 422


def test_api_81_delete_step_route(api):
    st = three(api)
    sid = st["history"]["entries"][1]["sid"]
    r = post(api, "delete-step", cloud_revision=api.cloud(), sid=sid)
    assert r.status_code == 200, r.text
    h = r.json()["history"]
    assert [e["tool"] for e in h["entries"]] == ["box", "box"]
    assert r.json()["counts"]["deleted"] == 8
    assert gone(api) == CORNER | MIDDLE
    r = post(api, "delete-step", cloud_revision=api.cloud(), sid=999)
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_such_step"
    r = post(api, "delete-step", cloud_revision=1, sid=0)
    assert r.status_code == 409


def test_api_82_rename_route(api):
    st = three(api)
    sid = st["history"]["entries"][0]["sid"]
    rev = api.state()["revision"]
    r = post(api, "rename", sid=sid, name=" corner ")
    assert r.status_code == 200, r.text
    assert r.json()["history"]["entries"][0]["name"] == "corner"
    assert api.state()["revision"] == rev
    r = post(api, "rename", sid=sid, name="")
    assert r.json()["history"]["entries"][0]["name"] is None
    r = post(api, "rename", sid=sid, name="x" * 81)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_name"
    r = post(api, "rename", sid=999, name="a")
    assert r.status_code == 404


def test_api_83_step_render_route(api):
    st = three(api)
    e = st["history"]["entries"][1]
    r = api.client.get(
        "/api/session/render",
        params={"mode": "step", "step": e["sid"], "budget": 1000},
    )
    assert r.status_code == 200, r.text
    n = int(r.headers["X-Count"])
    ids = np.frombuffer(r.content, "<u4", n, n * 12)
    assert set(ids.tolist()) == SCENE_GHOST
    assert int(r.headers["X-Eligible"]) == e["count"] == 27
    r = api.client.get("/api/session/render", params={"mode": "step"})
    assert r.status_code == 422
    r = api.client.get(
        "/api/session/render", params={"mode": "step", "step": 999}
    )
    assert r.status_code == 404


def test_api_84_apply_after_rollback_discards_greyed_steps(api):
    three(api)
    post(api, "rollback", cloud_revision=api.cloud(), cursor=1)
    st = delete(api, MID_BOX)
    h = st["history"]
    assert len(h["entries"]) == 2 and h["cursor"] == 2 and not h["can_redo"]
    assert len({e["sid"] for e in h["entries"]}) == 2


def big_pcd(n):
    rng = np.random.default_rng(5)
    xyz = (rng.integers(0, 4000, (n, 3)) / 128.0).astype("<f4")  # dyadic
    head = (
        "# .PCD v.7\nVERSION .7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\n"
        f"COUNT 1 1 1\nWIDTH {n}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\n"
        f"POINTS {n}\nDATA binary\n"
    ).encode()
    return head + xyz.tobytes(), xyz.astype(np.float64)


def test_api_85_exactness_at_one_million_points(tmp_path):
    # A child process: later tests read a child's peak RSS, which would
    # inherit the high-water mark of a parent that held 1M points.
    env = dict(os.environ, PYTHONPATH=os.pathsep.join(p for p in sys.path if p))
    proc = subprocess.run(
        [sys.executable, os.path.abspath(__file__), str(tmp_path)],
        capture_output=True,
        text=True,
        env=env,
        timeout=300,
        check=False,
    )
    assert proc.returncode == 0, (proc.stdout + proc.stderr)[-3000:]


def exactness_at_one_million_points(tmp_path):
    n = 1_000_000
    settings = make_settings(tmp_path)
    data, xyz = big_pcd(n)
    (fixture_dir(settings) / "big.pcd").write_bytes(data)
    a = Api(settings)
    a.open("big.pcd")
    boxes = [
        ([5.0, 5.0, 5.0], [8.0, 8.0, 8.0]),
        ([20.0, 20.0, 20.0], [10.0, 6.0, 12.0]),
        ([10.0, 25.0, 15.0], [9.0, 9.0, 9.0]),
    ]
    alive = np.ones(n, dtype=bool)
    expected = []
    for c, d in boxes:
        inside = np.all(np.abs(xyz - np.array(c)) <= np.array(d) / 2, axis=1)
        ids = np.flatnonzero(inside & alive)
        alive[ids] = False
        expected.append(set(ids.tolist()))
        st = delete(a, {"type": "box", "center": c, "dimensions": d})
        assert st["history"]["entries"][-1]["count"] == len(ids)
    entries = st["history"]["entries"]
    for e, want in zip(entries, expected, strict=True):
        r = a.client.get(
            "/api/session/render",
            params={"mode": "step", "step": e["sid"], "budget": 2_000_000},
        )
        k = int(r.headers["X-Count"])
        got = np.frombuffer(r.content, "<u4", k, k * 12)
        assert int(r.headers["X-Eligible"]) == len(want) == e["count"]
        assert set(got.tolist()) == want
    post(a, "rollback", cloud_revision=a.cloud(), cursor=1)
    post(a, "rollback", cloud_revision=a.cloud(), cursor=3)
    st = a.state()
    assert st["counts"]["active"] == int(alive.sum())
    r, _, ids, _ = a.render("deleted", budget=2_000_000)
    assert set(ids.tolist()) == set().union(*expected)


def test_api_86_export_after_rollback_has_only_active_steps(api):
    three(api)
    post(api, "rollback", cloud_revision=api.cloud(), cursor=2)
    job = api.wait(
        api.client.post("/api/session/export", json={"scope": "active"})
    )
    assert job["status"] == "complete", job
    body = api.client.get(f"/api/exports/{job['result']['export_id']}").content
    marker = b"DATA binary\n"
    raw = body[body.index(marker) + len(marker) :]
    got = np.frombuffer(raw, "<f4").reshape(-1, 4)
    removed = CORNER | SCENE_GHOST  # the middle step is rolled back
    keep = [i for i in range(129) if i not in removed]
    want = np.array([scene_rows()[i] for i in keep], dtype=np.float32)
    np.testing.assert_array_equal(got, want)


if __name__ == "__main__":
    import pathlib
    import time

    start = time.time()
    exactness_at_one_million_points(pathlib.Path(sys.argv[1]))
    print(f"exact at 1M points in {time.time() - start:.1f}s")
