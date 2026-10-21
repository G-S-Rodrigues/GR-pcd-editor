"""LAY-60..66: export by layer (union, once each, invalid, hidden, order, encodings)."""

import pytest
from test_api_layers import ALL_BOX, FLOOR_BOX, L, export_job, make_layer
from test_api_session import GHOST_BOX, Api

from fixtures.memory import trim
from fixtures.pcdgen import SCENE_FLOOR, SCENE_GHOST, SCENE_INVALID
from fixtures.sessions import make_settings, write_scene


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


def rows(api, layers, fmt="ascii", scope="active"):
    r = api.client.post(
        "/api/session/export",
        json={"format": fmt, "scope": scope, "layers": layers},
    )
    job = api.wait(r)
    assert job["status"] == "complete", job
    body = api.client.get(f"/api/exports/{job['result']['export_id']}").content
    return body, job["result"]["count"]


def ascii_rows(body):
    text = body.partition(b"DATA ascii\n")[2].decode()
    return [ln for ln in text.split("\n") if ln.strip()]


def three_layers(api):
    make_layer(api, FLOOR_BOX, name="Floor")
    make_layer(api, GHOST_BOX, name="Ghosts")
    return api


def test_lay_60_a_union_holds_each_chosen_layer(api):
    three_layers(api)
    _, c1 = rows(api, [1])
    _, c2 = rows(api, [2])
    _, both = rows(api, [1, 2])
    assert c1 == len(SCENE_FLOOR) and c2 == len(SCENE_GHOST)
    assert both == c1 + c2


def test_lay_61_every_point_once_even_when_an_id_is_repeated(api):
    three_layers(api)
    body, n = rows(api, [1, 1, 2, 2])
    assert n == len(SCENE_FLOOR) + len(SCENE_GHOST)
    assert len(ascii_rows(body)) == n


def test_lay_62_invalid_points_travel_with_main(api):
    three_layers(api)
    _, main = rows(api, [0])
    total = len(SCENE_FLOOR | SCENE_GHOST | SCENE_INVALID)
    assert main == len(SCENE_INVALID)
    _, whole = rows(api, [0, 1, 2])
    assert whole == total
    _, none_of_main = rows(api, [1, 2])
    assert none_of_main == total - len(SCENE_INVALID)


def test_lay_63_hidden_layers_are_still_exported(api):
    three_layers(api)
    api.client.put(f"{L}/visibility", json={"ids": None, "visible": False})
    _, n = rows(api, [1, 2])
    assert n == len(SCENE_FLOOR | SCENE_GHOST)
    assert api.state()["counts"]["hidden"] == n


def test_lay_64_source_order_is_kept(api):
    three_layers(api)
    whole, _ = rows(api, None)
    part, _ = rows(api, [0, 2])
    full = ascii_rows(whole)
    sub = ascii_rows(part)
    it = iter(full)
    assert all(any(r == f for f in it) for r in sub)  # a subsequence


def test_lay_65_binary_and_ascii_agree(api):
    three_layers(api)
    a, na = rows(api, [1], "ascii")
    b, nb = rows(api, [1], "binary")
    assert na == nb == len(SCENE_FLOOR)
    head, _, data = b.partition(b"DATA binary\n")
    size = next(
        ln for ln in head.decode().split("\n") if ln.startswith("SIZE ")
    )
    row = sum(int(v) for v in size.split()[1:])
    assert len(data) == nb * row
    assert len(ascii_rows(a)) == nb


def test_lay_66_scope_and_layers_combine(api):
    three_layers(api)
    api.select_wait(ALL_BOX)
    _, selected_floor = rows(api, [1], scope="selected")
    assert selected_floor == len(SCENE_FLOOR)
    r = api.client.post(
        "/api/session/export",
        json={"format": "ascii", "scope": "selected", "layers": []},
    )
    assert api.wait(r)["error"]["code"] == "no_layers_chosen"
    assert export_job(api, [1], "active")["result"]["count"] == len(SCENE_FLOOR)


# ---- Part 19: one file per layer (LAY-120..127, API-107..108) -------------
import time

import numpy as np

from gr_pcd.files.cleanup import sweep_runtime
from gr_pcd.pcd.reader import read_pcd

EXPORT = "/api/session/export"


def per_layer_job(api, fmt="binary", scope="active", layers=None, **extra):
    body = {"format": fmt, "scope": scope, "per_layer": True, **extra}
    if layers is not None:
        body["layers"] = layers
    return api.wait(api.client.post(EXPORT, json=body))


def download(api, export_id):
    r = api.client.get(f"/api/exports/{export_id}")
    assert r.status_code == 200, r.text
    return r


def sess(api):
    return api.client.app.state.manager.require()


def test_lay_120_one_file_per_layer_equal_to_its_members(api):
    three_layers(api)
    job = per_layer_job(api)
    assert job["status"] == "complete", job
    res = job["result"]
    s = sess(api)
    layer = np.asarray(s.layer)
    assert [f["layer_name"] for f in res["files"]] == [
        "main",
        "Floor",
        "Ghosts",
    ]
    total = 0
    for f in res["files"]:
        want = s.cloud.records[s.active & (layer == f["layer_id"])]
        got = read_pcd(download(api, f["export_id"]).content).records
        assert got.tobytes() == want.tobytes(), f["layer_name"]  # NaN-safe
        assert f["count"] == len(want)
        total += f["count"]
    assert total == res["count"] == int(s.active.sum())
    main = next(f for f in res["files"] if f["layer_id"] == 0)
    assert main["invalid_retained"] == len(SCENE_INVALID)
    assert all(
        f["invalid_retained"] == 0 for f in res["files"] if f["layer_id"]
    )


def test_lay_121_chosen_layers_only(api):
    three_layers(api)
    res = per_layer_job(api, layers=[1])["result"]
    assert [f["filename"] for f in res["files"]] == ["scene_Floor_cleaned.pcd"]
    assert res["count"] == len(SCENE_FLOOR)


def test_lay_122_names_are_sanitised_and_unique(api):
    make_layer(api, FLOOR_BOX, name="a/b")
    make_layer(api, GHOST_BOX, name="a_b")
    res = per_layer_job(api)["result"]
    names = [f["filename"] for f in res["files"]]
    assert names[0] == "scene_main_cleaned.pcd"
    assert len({n.lower() for n in names}) == 3
    assert names[1] == "scene_a_b_cleaned.pcd"
    assert names[2] == "scene_a_b_2_cleaned.pcd"
    # a user layer called "main" does not collide with Main
    api.client.patch(f"{L}/1", json={"name": "main"})
    names = [f["filename"] for f in per_layer_job(api)["result"]["files"]]
    assert names[:2] == ["scene_main_cleaned.pcd", "scene_main_1_cleaned.pcd"]


def test_lay_123_empty_layers_are_skipped_and_listed(api):
    three_layers(api)
    api.select_wait(ALL_BOX)
    res = per_layer_job(api, scope="selected")["result"]
    assert {f["layer_name"] for f in res["files"]} == {"Floor", "Ghosts"}
    assert [x["layer_name"] for x in res["skipped"]] == ["main"]
    # nothing selected anywhere
    api.client.post(
        "/api/session/selection/clear", json={"cloud_revision": api.cloud()}
    )
    job = per_layer_job(api, scope="selected")
    assert job["status"] == "failed"
    assert job["error"]["code"] == "nothing_to_export"


def test_lay_124_one_snapshot_for_every_file(api, monkeypatch):
    from gr_pcd.session import exporter

    three_layers(api)
    s = sess(api)
    real = exporter.write_pcd_file
    calls = []

    def edit_between(*a, **k):
        out = real(*a, **k)
        calls.append(1)
        if len(calls) == 1:  # a layer edit made after the first file
            s.assign_layer(s.clock.cloud, 2)
        return out

    monkeypatch.setattr(exporter, "write_pcd_file", edit_between)
    api.select_wait(FLOOR_BOX)  # the edit then moves the floor into Ghosts
    res = per_layer_job(api)["result"]
    counts = {f["layer_name"]: f["count"] for f in res["files"]}
    assert counts["Floor"] == len(SCENE_FLOOR)
    assert counts["Ghosts"] == len(SCENE_GHOST)
    assert len(calls) == 3


def test_lay_125_a_failure_on_file_two_removes_file_one(api, monkeypatch):
    from gr_pcd.pcd.errors import PcdError
    from gr_pcd.session import exporter

    three_layers(api)
    real = exporter.write_pcd_file
    made = []

    def flaky(path, *a, **k):
        if made:
            raise PcdError("write_failed", "disk full")
        made.append(path)
        return real(path, *a, **k)

    monkeypatch.setattr(exporter, "write_pcd_file", flaky)
    before = dict(api.client.app.state.manager.downloads)
    job = per_layer_job(api)
    assert job["status"] == "failed"
    assert made and not made[0].exists()
    assert api.client.app.state.manager.downloads == before


def test_lay_126_a_layer_less_session_refuses_per_layer(api):
    job = per_layer_job(api)
    assert job["status"] == "failed" and job["error"]["code"] == "no_layers"
    plain = api.wait(
        api.client.post(EXPORT, json={"format": "ascii", "scope": "active"})
    )
    assert plain["status"] == "complete" and "files" not in plain["result"]


@pytest.mark.parametrize("fmt", ["ascii", "binary"])
def test_lay_127_both_encodings(api, fmt):
    three_layers(api)
    res = per_layer_job(api, fmt=fmt)["result"]
    assert res["format"] == fmt
    for f in res["files"]:
        head = download(api, f["export_id"]).content[:400]
        assert f"DATA {fmt}".encode() in head


def test_api_107_job_result_shape_and_downloads(api):
    three_layers(api)
    res = per_layer_job(api)["result"]
    assert set(res) == {"files", "skipped", "count", "format", "scope"}
    for f in res["files"]:
        assert set(f) == {
            "export_id",
            "filename",
            "layer_id",
            "layer_name",
            "count",
            "invalid_retained",
            "bytes",
            "sha256",
        }
        r = download(api, f["export_id"])
        assert f["filename"] in r.headers["content-disposition"]
        assert len(r.content) == f["bytes"]


def test_api_108_the_sweep_treats_each_file_like_an_export(api):
    three_layers(api)
    res = per_layer_job(api)["result"]
    mgr = api.client.app.state.manager
    paths = [mgr.downloads[f["export_id"]].path for f in res["files"]]
    assert all(p.exists() for p in paths)
    sweep_runtime(mgr, time.time() + mgr.settings.download_ttl_seconds + 60)
    assert not any(p.exists() for p in paths)
    assert not any(f["export_id"] in mgr.downloads for f in res["files"])
