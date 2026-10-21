"""LAY-21, LAY-30..38: layers in the session archive (version 2)."""

import hashlib
import json
import zipfile

import numpy as np
import pytest
from test_archive import load, rewrite
from test_layers_property import check, run_sequence

from fixtures.memory import trim
from fixtures.sessions import (
    box_all_ghost,
    fixture_dir,
    make_settings,
    select_box,
    wait,
    write_scene,
)
from gr_pcd.pcd.errors import PcdError
from gr_pcd.session.manager import SessionManager


@pytest.fixture
def env(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    mgr = SessionManager(settings)
    mgr.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    yield mgr
    mgr.jobs.shutdown()


def save(mgr):
    job = wait(mgr.submit_save())
    assert job.status == "complete", job.error
    return mgr.downloads[job.result["archive_id"]].path


def with_layers(mgr):
    s = mgr.require()
    select_box(mgr, box_all_ghost())
    s.create_layer(s.clock.cloud, name="Ghosts", visible=False)
    return s


def manifest_of(path):
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read("manifest.json"))


def set_manifest(src, dst, edit, layers_bin=None):
    def mutate(name, data):
        if name == "manifest.json":
            m = json.loads(data)
            edit(m)
            return json.dumps(m).encode()
        if name == "layers.bin" and layers_bin is not None:
            return layers_bin(data)
        return data

    rewrite(src, dst, mutate)


def rejects(tmp_path, path, code="bad_archive"):
    with pytest.raises(PcdError) as ei:
        load(tmp_path, path)
    assert ei.value.code == code, ei.value.message


@pytest.fixture(autouse=True)
def _trim():
    yield
    trim()


def test_lay_21_property_through_save_and_reopen(tmp_path):
    for seed in range(60):
        base = tmp_path / f"s{seed}"
        mgr, _s, o, _ = run_sequence(base, seed)
        try:
            path = save(mgr)
            fresh = SessionManager(make_settings(base / "other"))
            try:
                s2 = fresh.open_archive(path)
                check(s2, o)
            finally:
                fresh.jobs.shutdown()
        finally:
            mgr.jobs.shutdown()


def test_lay_30_round_trip(env, tmp_path):
    s = with_layers(env)
    path = save(env)
    m = manifest_of(path)
    assert m["version"] == 2 and "layers" in m
    assert m["layers"]["items"] == [
        {"id": 1, "name": "Ghosts", "colour": 0, "visible": False}
    ]
    fresh = SessionManager(make_settings(tmp_path / "other"))
    try:
        s2 = fresh.open_archive(path)
        assert np.array_equal(s2.layer, s.layer)
        assert s2.layers == s.layers
        assert s2.state()["layers"][0]["visible"] is False
    finally:
        fresh.jobs.shutdown()


def test_lay_31_a_layer_less_archive_is_version_1_without_the_file(env):
    path = save(env)
    assert manifest_of(path)["version"] == 1
    with zipfile.ZipFile(path) as z:
        assert "layers.bin" not in z.namelist()
        assert "layers" not in json.loads(z.read("manifest.json"))


def test_lay_32_a_v1_file_with_layers_is_refused(env, tmp_path):
    path = with_layers(env) and save(env)
    out = tmp_path / "v1.pcdsession"
    set_manifest(path, out, lambda m: m.update(version=1))
    rejects(tmp_path, out)
    # a v1 file with the entry but no manifest key
    out2 = tmp_path / "v1b.pcdsession"
    set_manifest(path, out2, lambda m: (m.update(version=1), m.pop("layers")))
    rejects(tmp_path, out2)


def test_lay_33_a_v2_file_without_layers_is_refused(env, tmp_path):
    plain = save(env)
    out = tmp_path / "v2.pcdsession"
    set_manifest(plain, out, lambda m: m.update(version=2))
    rejects(tmp_path, out, "unsupported_session_version")  # as SES-25 pins
    # one half of the pair is a corrupt file
    # the key without the file
    path = with_layers(env) and save(env)
    out2 = tmp_path / "nofile.pcdsession"
    rewrite(path, out2, lambda n, d: None if n == "layers.bin" else d)
    rejects(tmp_path, out2)
    out4 = tmp_path / "nokey.pcdsession"
    set_manifest(path, out4, lambda m: m.pop("layers"))
    rejects(tmp_path, out4)
    # a version nobody wrote stays unsupported
    out3 = tmp_path / "v3.pcdsession"
    set_manifest(path, out3, lambda m: m.update(version=3))
    rejects(tmp_path, out3, "unsupported_session_version")


def test_lay_34_hostile_items(env, tmp_path):
    path = with_layers(env) and save(env)
    cases = {
        "dup": lambda m: m["layers"]["items"].append(
            dict(m["layers"]["items"][0])
        ),
        "id0": lambda m: m["layers"]["items"][0].update(id=0),
        "id256": lambda m: m["layers"]["items"][0].update(id=256),
        "idbool": lambda m: m["layers"]["items"][0].update(id=True),
        "colour16": lambda m: m["layers"]["items"][0].update(colour=16),
        "colourstr": lambda m: m["layers"]["items"][0].update(colour="1"),
        "visible": lambda m: m["layers"]["items"][0].update(visible=1),
        "name": lambda m: m["layers"]["items"][0].update(name=" x "),
        "longname": lambda m: m["layers"]["items"][0].update(name="x" * 41),
        "ctl": lambda m: m["layers"]["items"][0].update(name="a\x00b"),
        "empty": lambda m: m["layers"].update(items=[]),
        "notlist": lambda m: m["layers"].update(items={}),
        "file": lambda m: m["layers"].update(file="x.bin"),
        "many": lambda m: m["layers"].update(
            items=[
                {"id": i, "name": f"L{i}", "colour": 0, "visible": True}
                for i in range(1, 34)
            ]
        ),
    }
    for key, edit in cases.items():
        out = tmp_path / f"{key}.pcdsession"
        set_manifest(path, out, edit)
        rejects(tmp_path, out)


def test_lay_35_sha_is_verified(env, tmp_path):
    path = with_layers(env) and save(env)
    out = tmp_path / "sha.pcdsession"
    set_manifest(
        path,
        out,
        lambda m: m["layers"].update(sha256=hashlib.sha256(b"").hexdigest()),
    )
    rejects(tmp_path, out)


def flip_last(data):
    return data[:-1] + bytes([(data[-1] ^ 1)])


def resha(m, data):
    m["layers"]["sha256"] = hashlib.sha256(data).hexdigest()


def test_lay_36_size_is_exact(env, tmp_path):
    path = with_layers(env) and save(env)
    for key, fn in {
        "short": lambda d: d[:-1],
        "long": lambda d: d + b"\x00",
    }.items():
        out = tmp_path / f"{key}.pcdsession"
        set_manifest(
            path,
            out,
            lambda m, fn=fn: None,
            layers_bin=fn,
        )
        rejects(tmp_path, out)


def test_lay_37_an_orphan_id_is_refused(env, tmp_path):
    path = with_layers(env) and save(env)
    with zipfile.ZipFile(path) as z:
        raw = bytearray(z.read("layers.bin"))
    raw[0] = 77  # not declared, hash fixed up so only the orphan check fires
    out = tmp_path / "orphan.pcdsession"
    set_manifest(
        path,
        out,
        lambda m: resha(m, bytes(raw)),
        layers_bin=lambda d: bytes(raw),
    )
    rejects(tmp_path, out)


def test_lay_38_a_layer_step_survives_and_ids_are_reused(env, tmp_path):
    s = with_layers(env)
    s.delete_layer(s.clock.cloud, 1)
    assert manifest_of(save(env))["version"] == 1  # no layer left
    select_box(env, box_all_ghost())
    s.create_layer(s.clock.cloud, name="Again")
    m = manifest_of(save(env))
    assert [i["id"] for i in m["layers"]["items"]] == [1]
    assert "next_id" not in m["layers"]


def test_lay_89_flags_and_stored_order_round_trip(env, tmp_path):
    s = with_layers(env)
    s.patch_layer(1, visible=True)
    s.patch_layer(1, protected=True)
    # a second layer stored first: the list order is the stored order
    from dataclasses import replace

    s.layers = [replace(s.layers[0], id=2, name="Wall", locked=True)] + [
        s.layers[0]
    ]
    s.layer = s.layer.copy()
    s.layer[s.layer == 1] = 1  # ids stay valid: layer 2 simply has no points
    path = save(env)
    items = manifest_of(path)["layers"]["items"]
    assert [i["name"] for i in items] == ["Wall", "Ghosts"]
    assert items[0].get("protected") is True and items[0]["locked"] is True
    assert "locked" not in items[1] and items[1]["protected"] is True
    fresh = SessionManager(make_settings(tmp_path / "other"))
    try:
        s2 = fresh.open_archive(path)
        assert s2.layers == s.layers
    finally:
        fresh.jobs.shutdown()


def test_lay_30b_unflagged_manifest_has_no_flag_keys(env):
    with_layers(env)
    items = manifest_of(save(env))["layers"]["items"]
    assert items == [{"id": 1, "name": "Ghosts", "colour": 0, "visible": False}]


@pytest.mark.parametrize(
    "edit",
    [
        {"protected": 1},
        {"locked": "yes"},
        {"protected": None},
        {"locked": 0},
    ],
)
def test_lay_90_non_boolean_flags_are_refused(env, tmp_path, edit):
    path = with_layers(env) and save(env)
    out = tmp_path / "bad.pcdsession"
    set_manifest(path, out, lambda m: m["layers"]["items"][0].update(edit))
    rejects(tmp_path, out)


def test_lay_91_a_manifest_without_the_keys_loads_with_both_false(
    env, tmp_path
):
    with_layers(env)
    path = save(env)
    assert "protected" not in manifest_of(path)["layers"]["items"][0]
    fresh = SessionManager(make_settings(tmp_path / "other"))
    try:
        s2 = fresh.open_archive(path)
        assert s2.layers[0].protected is False
        assert s2.layers[0].locked is False
    finally:
        fresh.jobs.shutdown()
