"""API-90..99: the preview / commit / discard routes (part 12b-2)."""

import gc
import time

import numpy as np
import pytest
from test_api_session import CORNER_BOX, GHOST_BOX, Api

from fixtures.sessions import (
    fixture_dir,
    make_settings,
    open_via_upload,
    write_scene,
)

S_BOX = {
    "type": "box",
    "center": [2.5, 2.5, 0.5],
    "dimensions": [3.5, 3.5, 1.5],
}
B2 = {"type": "box", "center": [3.5, 3.5, 1.0], "dimensions": [3, 3, 2]}
P = "/api/session/selection"
ADD, REMOVE = 8, 16


@pytest.fixture
def api(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    a = Api(settings)
    a.open()
    job = a.select_wait(S_BOX)
    assert job["status"] == "complete", job
    yield a
    # free the app: test_pcd_61 reads this process's size through a fork
    manager = a.client.app.state.manager
    manager.jobs.shutdown()
    manager.close()
    a.client.close()
    gc.collect()


def preview_req(api, tool=B2, op="add", **extra):
    body = {
        "cloud_revision": api.cloud(),
        "op": op,
        "scope": "active",
        "tool": tool,
        **extra,
    }
    return api.client.post(f"{P}/preview", json=body)


def preview(api, tool=B2, op="add"):
    job = api.wait(preview_req(api, tool, op))
    assert job["status"] == "complete", job
    return job["result"]


def commit_req(api, pid, **extra):
    return api.client.post(
        f"{P}/commit",
        json={"cloud_revision": api.cloud(), "preview_id": pid, **extra},
    )


def render(api, pid=None, mode="edited", budget=1000):
    params = {"mode": mode, "budget": budget}
    if pid is not None:
        params["preview"] = pid
    r = api.client.get("/api/session/render", params=params)
    if r.status_code != 200:
        return r, None, None
    n = int(r.headers["X-Count"])
    ids = np.frombuffer(r.content, "<u4", n, n * 12)
    flags = np.frombuffer(r.content, "u1", n, n * 16)
    return r, ids, flags


def test_api_90_preview_job_has_counts_and_selection_is_unchanged(api):
    before = api.state()["selection"]
    res = preview(api)
    assert set(res) >= {
        "preview_id",
        "selected_after",
        "base_selected",
        "added",
        "removed",
        "operand",
    }
    assert res["base_selected"] == 25 and res["removed"] == 0
    assert res["selected_after"] == 25 + res["added"] > 25
    st = api.state()
    assert st["selection"] == before and st["selection"]["count"] == 25
    assert st["revision"]["params"] == before_params(api)


def before_params(api):
    return api.state()["revision"]["params"]


def test_api_91_preview_validation(api):
    for op in ("replace", "invert"):
        r = preview_req(api, op=op)
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "invalid_op"
    r = preview_req(api, tool=None)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "tool_required"
    r = api.client.post(
        f"{P}/preview",
        json={"cloud_revision": api.cloud(), "op": "add", "tool": B2, "x": 1},
    )
    assert r.status_code == 422
    r = api.client.post(
        f"{P}/preview",
        json={"cloud_revision": api.cloud() + 5, "op": "add", "tool": B2},
    )
    assert r.status_code == 409


def test_api_92_render_with_preview_carries_header_and_flags(api):
    res = preview(api)
    r, _ids, flags = render(api, res["preview_id"])
    assert r.headers["X-Preview-Id"] == res["preview_id"]
    assert int(((flags & ADD) != 0).sum()) == res["added"]
    assert int(((flags & 1) != 0).sum()) == res["selected_after"]
    plain, _ids, pflags = render(api, "unknown")
    assert "X-Preview-Id" not in plain.headers
    assert not (pflags & (ADD | REMOVE)).any()
    assert int(((pflags & 1) != 0).sum()) == 25
    # a preview with another mode is refused
    bad, _, _ = render(api, res["preview_id"], mode="original")
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "invalid_mode"


def test_api_93_commit_by_id_then_the_id_is_spent(api):
    res = preview(api)
    r = commit_req(api, res["preview_id"])
    assert r.status_code == 202, r.text
    job = api.wait(r)
    assert job["status"] == "complete", job
    assert job["result"]["selected"] == res["selected_after"]
    assert "candidate" in job["result"]
    st = api.state()
    assert st["selection"]["count"] == res["selected_after"]
    assert st["selection"]["ops"][-1]["op"] == "add"
    again = commit_req(api, res["preview_id"])
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "stale_revision"
    # evaluate_candidate false commits without a candidate
    res = preview(api, op="subtract")
    job = api.wait(commit_req(api, res["preview_id"], evaluate_candidate=False))
    assert job["status"] == "complete" and "candidate" not in job["result"]


def test_api_94_stale_commit_409_with_revision(api):
    res = preview(api)
    api.client.put(
        "/api/session/display-filter",
        json={"z": {"enabled": True, "min": -1, "max": 9}},
    )
    r = commit_req(api, res["preview_id"])
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "stale_revision" and "params" in err["current"]
    r = commit_req(api, "no-such-preview")
    assert r.status_code == 409


def test_api_95_apply_after_a_preview_uses_the_committed_set(api):
    # the candidate of S, then a preview, then Apply with the old id
    api.select_wait(S_BOX)
    cand = api.select_wait(S_BOX)["result"]["candidate"]
    res = preview(api, tool=GHOST_BOX)
    assert res["added"] > 0
    r = api.apply(cand["candidate_id"])
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["counts"]["deleted"] == 25
    assert st["history"]["entries"][-1]["count"] == 25


def test_api_95_after_a_commit_the_old_candidate_id_is_obsolete(api):
    api.select_wait(S_BOX)
    old = api.select_wait(S_BOX)["result"]["candidate"]["candidate_id"]
    res = preview(api)
    api.wait(commit_req(api, res["preview_id"]))
    assert api.apply(old).status_code == 409


SLOW = {"type": "box", "center": [0, 0, 0], "dimensions": [7, 7, 7]}


@pytest.fixture
def slow(monkeypatch):
    """A box of size 7 never finishes by itself: it waits for its token.

    (No real 100k-point cluster: its transient memory would raise the peak
    of this test process, which test_pcd_61 reads through fork.)"""
    from gr_pcd.session.engine import EditingSession

    real = EditingSession._operand

    def operand(self, spec, snap, token, on_progress):
        if getattr(spec.tool, "dimensions", None) == (7, 7, 7):
            end = time.time() + 20
            while time.time() < end:
                token.check()  # raises Cancelled once cancelled
                time.sleep(0.005)
        return real(self, spec, snap, token, on_progress)

    monkeypatch.setattr(EditingSession, "_operand", operand)


def wait_running(api, jid):
    end = time.time() + 10
    while api.client.get(f"/api/jobs/{jid}").json()["status"] != "running":
        assert time.time() < end
        time.sleep(0.005)


def slow_preview(api):
    r = preview_req(api, tool=SLOW, op="add")
    assert r.status_code == 202, r.text
    jid = r.json()["id"]
    wait_running(api, jid)
    return jid


def status_after(api, jid):
    end = time.time() + 20
    while api.client.get(f"/api/jobs/{jid}").json()["status"] in (
        "queued",
        "running",
    ):
        assert time.time() < end
        time.sleep(0.01)
    return api.client.get(f"/api/jobs/{jid}").json()["status"]


def test_api_96_new_preview_cancels_the_older_one(api, slow):
    jid = slow_preview(api)
    other = preview_req(
        api,
        tool={"type": "box", "center": [0, 0, 0], "dimensions": [1, 1, 1]},
    )
    api.wait(other)
    assert status_after(api, jid) == "cancelled"


def test_api_96_replace_select_cancels_a_running_preview(api, slow):
    jid = slow_preview(api)
    other = api.select(
        {"type": "box", "center": [0, 0, 0], "dimensions": [1, 1, 1]}
    )
    api.wait(other)
    assert status_after(api, jid) == "cancelled"


def test_api_96_preview_does_not_cancel_a_select_job(api, slow):
    r = api.select(SLOW, op="add", scope="active")
    jid = r.json()["id"]
    wait_running(api, jid)
    p = preview_req(
        api,
        tool={"type": "box", "center": [0, 0, 0], "dimensions": [1, 1, 1]},
    )
    assert p.status_code == 202
    time.sleep(0.3)  # a superseding job would have been cancelled by now
    assert api.client.get(f"/api/jobs/{jid}").json()["status"] == "running"
    api.client.post(f"/api/jobs/{jid}/cancel")
    assert status_after(api, jid) == "cancelled"


def test_api_97_undo_redo_rollback_clear_the_pending_preview(api):
    cand = api.select_wait(S_BOX)["result"]["candidate"]
    assert api.apply(cand["candidate_id"]).status_code == 200
    api.select_wait(CORNER_BOX)
    H = "/api/session/history/rollback"
    for gesture in ("undo", "redo", "rollback"):
        res = preview(api, tool=GHOST_BOX)
        r, _, _ = render(api, res["preview_id"])
        assert "X-Preview-Id" in r.headers
        rev = api.cloud()
        if gesture == "rollback":
            out = api.client.post(H, json={"cloud_revision": rev, "cursor": 0})
        else:
            out = api.client.post(
                f"/api/session/{gesture}", json={"cloud_revision": rev}
            )
        assert out.status_code == 200, (gesture, out.text)
        r, _, _ = render(api, res["preview_id"])
        assert "X-Preview-Id" not in r.headers, gesture
        assert commit_req(api, res["preview_id"]).status_code == 409
        api.select_wait(CORNER_BOX)
        if gesture == "undo":
            # redo needs the marker back; the replace select kept the cursor
            api.client.post(
                H, json={"cloud_revision": api.cloud(), "cursor": 0}
            )


def test_api_98_save_drops_a_pending_preview(api):
    res = preview(api)
    job = api.wait(api.client.post("/api/session/save", json={}))
    assert job["status"] == "complete", job
    blob = api.client.get(
        f"/api/session-archives/{job['result']['archive_id']}"
    ).content
    path = fixture_dir(api.settings) / "p.pcdsession"
    path.write_bytes(blob)
    st = open_via_upload(api.client, path, replace=True).json()
    assert st["selection"]["count"] == 25  # the committed selection
    r, _, _ = render(api, res["preview_id"])
    assert "X-Preview-Id" not in r.headers
    assert commit_req(api, res["preview_id"]).status_code == 409


def test_api_99_discard_is_idempotent_and_frees_the_slot(api):
    res = preview(api)
    sel = api.state()["selection"]
    for _ in range(2):
        r = api.client.post(
            f"{P}/preview/discard", json={"cloud_revision": api.cloud()}
        )
        assert r.status_code == 200, r.text
        assert r.json()["selection"] == sel
    r, _, _ = render(api, res["preview_id"])
    assert "X-Preview-Id" not in r.headers
    assert commit_req(api, res["preview_id"]).status_code == 409
