"""SES-77..86: layer steps in the session archive (version 3, part 19).

Sessions are built by hand (state set directly, steps pushed on the history)
so these tests do not depend on how the engine creates layer steps.
"""

import json
import zipfile

import numpy as np
import pytest
from test_archive import load, rewrite
from test_engine_steps import CORNER, CORNER_BOX, del_box

from fixtures.memory import trim
from fixtures.sessions import fixture_dir, make_settings, wait, write_scene
from gr_pcd.editing.history import LayerRowChange
from gr_pcd.editing.layers import Layer
from gr_pcd.pcd.errors import PcdError
from gr_pcd.session.manager import SessionManager

FLOOR = Layer(1, "Floor", 0)
WALL = Layer(2, "Wall", 1)
A = np.arange(20, 40, dtype=np.uint32)  # floor
B = np.arange(40, 45, dtype=np.uint32)  # more floor
C = np.arange(50, 55, dtype=np.uint32)  # wall


@pytest.fixture
def mgr(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    m = SessionManager(settings)
    m.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    yield m
    m.jobs.shutdown()


@pytest.fixture(autouse=True)
def _trim():
    yield
    trim()


def save(mgr):
    job = wait(mgr.submit_save())
    assert job.status == "complete", job.error
    return mgr.downloads[job.result["archive_id"]].path


def manifest_of(path):
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read("manifest.json"))


def push(s, ids, frm, to, rows=(), desc="layer edit"):
    n = len(ids)
    s.history.push(
        "layer",
        desc,
        ids,
        tool="layer",
        frm=np.full(n, frm, dtype=np.uint8),
        to=np.full(n, to, dtype=np.uint8),
        rows=tuple(rows),
    )


def arr_at(s, cursor):
    """The layer array and rows after the first `cursor` layer steps of v3()."""
    a = np.zeros(s.cloud.n, dtype=np.uint8)
    rows = []
    if cursor >= 1:
        a[A] = 1
        rows = [FLOOR]
    if cursor >= 2:
        a[B] = 1
    if cursor >= 3:
        a[C] = 2
        rows = [FLOOR, WALL]
    if cursor >= 4:
        a[C] = 1
        rows = [FLOOR]
    return a, rows


def v3(mgr, s, cursor=4, deletion=True):
    """[delete CORNER], create Floor, assign B, create Wall, merge Wall -> Floor."""
    if deletion:
        del_box(mgr, CORNER_BOX)
    push(s, A, 0, 1, [LayerRowChange(0, FLOOR, True)], "New layer Floor")
    push(s, B, 0, 1, (), "to Floor")
    push(s, C, 0, 2, [LayerRowChange(1, WALL, True)], "New layer Wall")
    push(s, C, 2, 1, [LayerRowChange(1, WALL, False)], "Merged Wall")
    base = 1 if deletion else 0
    s.history.cursor = base + cursor
    a, rows = arr_at(s, cursor)
    s.layer, s.layers = (a, rows) if rows else (None, [])
    return s


def build(mgr, cursor=4, deletion=True):
    return v3(mgr, mgr.require(), cursor, deletion)


def sig(e):
    return (
        e.kind,
        e.description,
        e.ids.tolist(),
        e.sid,
        e.tool,
        e.name,
        None if e.frm is None else e.frm.tolist(),
        None if e.to is None else e.to.tolist(),
        [(r.index, r.layer, r.created) for r in e.rows],
    )


def reopen(tmp_path, path, name="other"):
    fresh = SessionManager(make_settings(tmp_path / name))
    return fresh, fresh.open_archive(path)


def rejects(tmp_path, path, code="bad_archive"):
    with pytest.raises(PcdError) as ei:
        load(tmp_path, path)
    assert ei.value.code == code, ei.value.message
    return ei.value


def edit_manifest(src, dst, edit, files=None):
    def mutate(name, data):
        if name == "manifest.json":
            m = json.loads(data)
            edit(m)
            return json.dumps(m).encode()
        if files and name in files:
            return files[name](data)
        return data

    rewrite(src, dst, mutate)


def layer_entries(m):
    return [e for e in m["history"]["entries"] if e["kind"] == "layer"]


def test_ses_77_round_trip_is_version_3_with_layer_files(mgr, tmp_path):
    s = build(mgr)
    path = save(mgr)
    m = manifest_of(path)
    assert m["version"] == 3 and m["layers"]["items"][0]["name"] == "Floor"
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        for i in range(1, 5):
            assert f"history/{i}.layer.bin" in names
            assert (
                len(z.read(f"history/{i}.layer.bin"))
                == 2 * m["history"]["entries"][i]["count"]
            )
        assert "history/0.layer.bin" not in names
    assert layer_entries(m)[0]["rows"] == [
        {"index": 0, "created": True, "item": layer_item(FLOOR)}
    ]
    fresh, s2 = reopen(tmp_path, path)
    try:
        assert [sig(e) for e in s2.history.entries] == [
            sig(e) for e in s.history.entries
        ]
        assert s2.history.cursor == s.history.cursor
        assert np.array_equal(s2.layer, s.layer)
        assert s2.layers == s.layers
    finally:
        fresh.jobs.shutdown()


def layer_item(x):
    return {
        "id": x.id,
        "name": x.name,
        "colour": x.colour,
        "visible": x.visible,
    }


def test_ses_78_versions_without_a_layer_step_do_not_change(mgr, tmp_path):
    del_box(mgr, CORNER_BOX)
    assert manifest_of(save(mgr))["version"] == 1
    s = mgr.require()
    a, _ = arr_at(s, 2)
    s.layer, s.layers = a, [FLOOR]  # layers, but no layer step in the history
    m = manifest_of(save(mgr))
    assert m["version"] == 2 and "layers" in m
    assert all(e["kind"] != "layer" for e in m["history"]["entries"])


@pytest.mark.parametrize("cursor", [4, 3, 2, 1, 0])
def test_ses_79_rolled_back_over_layer_steps_reopens_identically(
    mgr, tmp_path, cursor
):
    s = build(mgr, cursor)
    s.rename_step(s.history.entries[2].sid, "second")
    path = save(mgr)
    fresh, s2 = reopen(tmp_path, path)
    try:
        assert s2.history.cursor == s.history.cursor
        assert [sig(e) for e in s2.history.entries] == [
            sig(e) for e in s.history.entries
        ]
        assert s2.history.entries[2].name == "second"
        assert (s2.layer is None) == (s.layer is None)
        if s.layer is not None:
            assert np.array_equal(s2.layer, s.layer)
        assert s2.layers == s.layers
        assert set(np.flatnonzero(~s2.active).tolist()) == CORNER
    finally:
        fresh.jobs.shutdown()


def test_ses_80_every_layer_removed_by_steps_has_no_layers_block(mgr, tmp_path):
    s = mgr.require()
    push(s, A, 0, 1, [LayerRowChange(0, FLOOR, True)], "New layer Floor")
    push(s, A, 1, 0, [LayerRowChange(0, FLOOR, False)], "Removed layer Floor")
    s.layer, s.layers = None, []
    path = save(mgr)
    m = manifest_of(path)
    assert m["version"] == 3 and "layers" not in m
    with zipfile.ZipFile(path) as z:
        assert "layers.bin" not in z.namelist()
    fresh, s2 = reopen(tmp_path, path)
    try:
        assert s2.layer is None and s2.layers == []
        assert [sig(e) for e in s2.history.entries] == [
            sig(e) for e in s.history.entries
        ]
    finally:
        fresh.jobs.shutdown()


def hostile_cases(path, tmp_path):
    cases = {}

    def case(key, edit=lambda m: None, files=None):
        out = tmp_path / f"{key}.pcdsession"
        edit_manifest(path, out, edit, files)
        cases[key] = out

    def layers_first_zero(d):  # point 20 is the first of the floor step
        return d[:20] + b"\x00" + d[21:]

    def resha(m, d):
        import hashlib

        m["layers"]["sha256"] = hashlib.sha256(d).hexdigest()

    with zipfile.ZipFile(path) as z:
        lb = z.read("layers.bin")
    bad = layers_first_zero(lb)
    case(
        "to_mismatch",
        lambda m: resha(m, bad),
        files={"layers.bin": lambda d: bad},
    )
    case(
        "frm_mismatch",
        files={
            "history/2.layer.bin": lambda d: bytes([3]) + d[1:],
        },
    )
    case(
        "created_twice",
        lambda m: layer_entries(m)[1].update(
            rows=[{"index": 0, "created": True, "item": layer_item(FLOOR)}]
        ),
    )
    case(
        "removed_still_present",
        lambda m: layer_entries(m)[3]["rows"][0]["item"].update(id=1),
    )
    case(
        "rowid0",
        lambda m: layer_entries(m)[0]["rows"][0]["item"].update(id=0),
    )
    case(
        "rowid256",
        lambda m: layer_entries(m)[0]["rows"][0]["item"].update(id=256),
    )
    case(
        "bad_item",
        lambda m: layer_entries(m)[0]["rows"][0]["item"].update(colour=99),
    )
    case(
        "bad_index",
        lambda m: layer_entries(m)[0]["rows"][0].update(index=-1),
    )
    case(
        "bad_created",
        lambda m: layer_entries(m)[0]["rows"][0].update(created=1),
    )
    case("short_layer_bin", files={"history/2.layer.bin": lambda d: d[:-1]})
    case("long_layer_bin", files={"history/2.layer.bin": lambda d: d + b"\0"})
    case(
        "missing_layer_file",
        files={"history/2.layer.bin": lambda d: None},
    )
    case(
        "no_change_step",
        files={
            "history/2.layer.bin": lambda d: d[: len(d) // 2] + d[: len(d) // 2]
        },
    )
    case(
        "rows_not_list",
        lambda m: layer_entries(m)[0].update(rows={}),
    )
    case(
        "layer_file_name",
        lambda m: layer_entries(m)[0].update(layer_file="history/9.layer.bin"),
    )
    return cases


def test_ses_81_hostile_layer_step_data_is_bad_archive(mgr, tmp_path):
    build(mgr)
    path = save(mgr)
    for key, out in hostile_cases(path, tmp_path).items():
        try:
            rejects(tmp_path, out)
        except AssertionError as exc:
            raise AssertionError(f"{key}: {exc}")
    # a layer entry missing its file in the zip is caught by the file check
    extra = tmp_path / "extra.pcdsession"
    with zipfile.ZipFile(path) as zi, zipfile.ZipFile(extra, "w") as zo:
        for info in zi.infolist():
            zo.writestr(info.filename, zi.read(info))
        zo.writestr("history/9.layer.bin", b"")
    rejects(tmp_path, extra)


def test_ses_82_kind_and_tool_must_pair_and_v3_only(mgr, tmp_path):
    build(mgr)
    path = save(mgr)
    out = tmp_path / "boxtool.pcdsession"
    edit_manifest(path, out, lambda m: layer_entries(m)[0].update(tool="box"))
    rejects(tmp_path, out)
    out = tmp_path / "deletelayer.pcdsession"
    edit_manifest(
        path,
        out,
        lambda m: m["history"]["entries"][0].update(tool="layer"),
    )
    rejects(tmp_path, out)
    out = tmp_path / "kindswap.pcdsession"
    edit_manifest(
        path, out, lambda m: layer_entries(m)[0].update(kind="delete")
    )
    rejects(tmp_path, out)
    for v in (1, 2):
        out = tmp_path / f"v{v}.pcdsession"
        edit_manifest(path, out, lambda m, v=v: m.update(version=v))
        rejects(tmp_path, out)


def test_ses_83_v3_without_a_layer_row_is_unsupported(mgr, tmp_path):
    del_box(mgr, CORNER_BOX)
    path = save(mgr)
    out = tmp_path / "v3plain.pcdsession"
    edit_manifest(path, out, lambda m: m.update(version=3))
    rejects(tmp_path, out, "unsupported_session_version")


def test_ses_84_a_layer_step_may_share_ids_with_a_deletion(mgr, tmp_path):
    s = del_box(mgr, CORNER_BOX)
    ids = np.array(sorted(CORNER), dtype=np.uint32)
    push(s, ids, 0, 1, [LayerRowChange(0, FLOOR, True)], "New layer Floor")
    a = np.zeros(s.cloud.n, dtype=np.uint8)
    a[ids] = 1
    s.layer, s.layers = a, [FLOOR]
    path = save(mgr)
    fresh, s2 = reopen(tmp_path, path)
    try:
        assert set(np.flatnonzero(~s2.active).tolist()) == CORNER
        assert np.array_equal(s2.layer, a)
    finally:
        fresh.jobs.shutdown()


def test_ses_85_layer_file_names(mgr, tmp_path):
    build(mgr)
    path = save(mgr)
    for name in ("history/x.layer.bin", "history/1.from.bin"):
        out = tmp_path / "n.pcdsession"
        with zipfile.ZipFile(path) as zi, zipfile.ZipFile(out, "w") as zo:
            for info in zi.infolist():
                zo.writestr(info.filename, zi.read(info))
            zo.writestr(name, b"")
        rejects(tmp_path, out)
    # accepted only with a layer row at that index: the deletion is entry 0
    out = tmp_path / "zero.pcdsession"
    with zipfile.ZipFile(path) as zi, zipfile.ZipFile(out, "w") as zo:
        for info in zi.infolist():
            zo.writestr(info.filename, zi.read(info))
        zo.writestr("history/0.layer.bin", b"")
    rejects(tmp_path, out)
    assert load(tmp_path, path)[0].entries[1].kind == "layer"


def test_ses_86_old_reader_keys_and_counters_are_present(mgr, tmp_path):
    build(mgr)
    m = manifest_of(save(mgr))
    for i, e in enumerate(m["history"]["entries"]):
        assert {"kind", "description", "count", "file", "sid", "tool"} <= set(e)
        assert e["file"] == f"history/{i}.bin"
    assert "cursor" in m["history"] and m["history"]["next_sid"] == 5
    assert m["version"] == 3
