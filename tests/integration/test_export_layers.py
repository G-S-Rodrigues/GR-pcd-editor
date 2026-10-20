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
