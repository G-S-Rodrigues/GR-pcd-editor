"""API-60..62, SES-44: X-Session-Id is optional and checked when present."""

import numpy as np
import pytest
from test_api_session import GHOST_BOX, Api

from fixtures.pcdgen import SCENE_FIELDS, build_pcd, scene_rows
from fixtures.sessions import fixture_dir, open_via_upload, write_scene


@pytest.fixture
def api(tmp_path):
    from fixtures.sessions import make_settings

    settings = make_settings(tmp_path)
    write_scene(settings)
    (fixture_dir(settings) / "other.pcd").write_bytes(
        build_pcd(SCENE_FIELDS, scene_rows(), "binary")
    )
    return Api(settings)


def _replace(api, name):
    r = open_via_upload(
        api.client, fixture_dir(api.settings) / name, replace=True
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_api_60_old_session_id_is_rejected_after_a_replace(api):
    old = api.open()["session_id"]
    new = _replace(api, "other.pcd")["session_id"]
    assert old != new
    h = {"X-Session-Id": old}
    rev = {"cloud_revision": 1}
    calls = [
        ("post", "/api/session/undo", {"json": rev}),
        ("post", "/api/session/redo", {"json": rev}),
        ("post", "/api/session/selection/clear", {"json": rev}),
        ("post", "/api/session/candidate", {"json": rev}),
        ("post", "/api/session/apply", {"json": {**rev, "candidate_id": "x"}}),
        (
            "post",
            "/api/session/selection",
            {
                "json": {
                    **rev,
                    "op": "replace",
                    "scope": "active",
                    "tool": GHOST_BOX,
                }
            },
        ),
        ("get", "/api/session/render", {}),
        ("get", "/api/jobs/abc", {}),
        ("post", "/api/jobs/abc/cancel", {}),
        ("delete", "/api/session", {}),
    ]
    for method, url, kw in calls:
        r = getattr(api.client, method)(url, headers=h, **kw)
        assert r.status_code == 409, (url, r.status_code, r.text)
        err = r.json()["error"]
        assert err["code"] == "session_changed", url
        assert err["session_id"] == new
    # the current id passes the check (and reaches the normal handler)
    r = api.client.post(
        "/api/session/selection/clear",
        headers={"X-Session-Id": new},
        json=rev,
    )
    assert r.status_code == 200
    # the render of the current session answers its id
    r = api.client.get("/api/session/render", headers={"X-Session-Id": new})
    assert r.headers["X-Session-Id"] == new
    # the state probe and open are never checked
    assert api.client.get("/api/session", headers=h).status_code == 200


def test_api_60b_header_with_no_session_is_409(api):
    r = api.client.post(
        "/api/session/undo",
        headers={"X-Session-Id": "abc"},
        json={"cloud_revision": 1},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "session_changed"


def test_api_61_no_header_still_works(api):
    api.open()
    r = api.client.post(
        "/api/session/selection/clear", json={"cloud_revision": api.cloud()}
    )
    assert r.status_code == 200


def test_api_62_selection_id_changes_on_mutation_not_on_read(api):
    st = api.open()
    sid0 = st["selection"]["id"]
    assert api.state()["selection"]["id"] == sid0
    assert api.state()["selection"]["id"] == sid0
    job = api.select_wait(GHOST_BOX)
    assert job["status"] == "complete", job
    sid1 = api.state()["selection"]["id"]
    assert sid1 != sid0
    r = api.client.post(
        "/api/session/selection/clear", json={"cloud_revision": api.cloud()}
    )
    sid2 = r.json()["selection"]["id"]
    assert sid2 not in (sid0, sid1)
    job = api.select_wait(GHOST_BOX)
    cid = job["result"]["candidate"]["candidate_id"]
    sid3 = api.state()["selection"]["id"]
    assert api.apply(cid).status_code == 200
    assert api.state()["selection"]["id"] != sid3


def test_ses_44_engine_selection_id_is_monotonic(api):
    api.open()
    s = api.client.app.state.manager.require()
    a = s.selection_id
    s.clear_selection(s.clock.cloud)
    assert s.selection_id > a
    assert np.asarray(s.selection).sum() == 0


def test_api_66_upload_ignores_a_stale_session_id(api, tmp_path):

    old = api.open()["session_id"]
    body = (fixture_dir(api.settings) / "other.pcd").read_bytes()
    r = api.client.post(
        "/api/session/upload",
        params={
            "upload_id": "0123456789abcdef0123456789abcdef",
            "filename": "o.pcd",
            "replace": True,
        },
        content=body,
        headers={
            "X-Session-Id": "stale-" + old,
            "Content-Type": "application/octet-stream",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["session_id"] != old
