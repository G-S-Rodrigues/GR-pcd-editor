"""SPR-11: the selection route takes the sparse tool body. Lives in tests/unit: an integration test would raise
the inherited RSS high-water of PCD-61 (see the part 12-9 note in docs/agents/testing.md)."""

import time

import pytest

from fixtures.sessions import (
    fixture_dir,
    make_client,
    make_settings,
    open_via_upload,
    write_scene,
)
from gr_pcd.app import create_app


@pytest.fixture
def api(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    client = make_client(create_app(settings))
    r = open_via_upload(client, fixture_dir(settings) / "scene.pcd")
    assert r.status_code == 200, r.text
    return client


def post(api, tool, route="selection", **extra):
    rev = api.get("/api/session").json()["revision"]["cloud"]
    body = {
        "cloud_revision": rev,
        "op": "replace",
        "scope": "active",
        "tool": tool,
        **extra,
    }
    return api.post(f"/api/session/{route}", json=body)


def wait(api, r):
    assert r.status_code == 202, r.text
    end = time.time() + 20
    while True:
        job = api.get(f"/api/jobs/{r.json()['id']}").json()
        if job["status"] not in ("queued", "running"):
            return job
        assert time.time() < end
        time.sleep(0.01)


def test_spr_11_sparse_tool_selects_through_the_route(api):
    job = wait(
        api, post(api, {"type": "sparse", "radius": 1.0, "min_neighbours": 5})
    )
    assert job["status"] == "complete", job
    assert (
        api.get("/api/session").json()["counts"]["selected"] == 4
    )  # the floor corners
    job = wait(
        api, post(api, {"type": "sparse"}, "selection/preview", op="add")
    )
    assert job["status"] == "complete", (
        job
    )  # radius omitted: derived from the spacing


@pytest.mark.parametrize(
    "tool",
    [
        {"type": "sparse", "radius": "x"},
        {"type": "sparse", "min_neighbours": 1.5},
        {"type": "sparse", "bogus": 1},
        {"type": "sparse", "region": {"type": "sparse"}},
    ],
)
def test_spr_11_bad_sparse_body_is_422(api, tool):
    assert post(api, tool).status_code == 422


def test_spr_11_invalid_values_fail_the_job_with_invalid_tool(api):
    job = wait(api, post(api, {"type": "sparse", "radius": 0.0}))
    assert (
        job["status"] == "failed" and job["error"]["code"] == "invalid_tool"
    ), job
