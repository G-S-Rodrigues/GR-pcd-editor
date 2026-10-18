"""STS-01..13: the shape of every history step (part 13-1). Independent of the engine's own helpers: expected
values are written out by hand."""

import json
import math
import zipfile

import numpy as np
import pytest
from test_archive_steps import reopen, rewrite_manifest, save
from test_engine_steps import (
    CORNER_BOX,
    GHOST_BOX,
    MIDDLE_BOX,
    apply_spec,
    del_box,
)

from fixtures.sessions import fixture_dir, make_settings, write_scene
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.geometry.filters import AxisRange, DisplayFilter
from gr_pcd.geometry.prism import PrismSpec
from gr_pcd.pcd.errors import PcdError
from gr_pcd.session import archive as arc
from gr_pcd.session.codec import ClusterTool, FilterTool, shape_of, tool_summary
from gr_pcd.session.engine import SelectSpec
from gr_pcd.session.manager import SessionManager

TILTED = BoxSpec(
    center=(3.0, 3.0, 2.0),
    dimensions=(2.0, 2.0, 2.0),
    rpy_deg=(10.0, 20.0, 30.0),
    mode="inside",
)
SQUARE = PrismSpec(
    polygon=((5.0, 5.0), (6.0, 5.0), (6.0, 6.0), (5.0, 6.0)),
    z_min=-1.0,
    z_max=1.0,
    mode="inside",
)


@pytest.fixture
def mgr(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    m = SessionManager(settings)
    m.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    yield m
    m.jobs.shutdown()


def test_sts_01_box_shape_keeps_everything():
    assert shape_of(TILTED) == {
        "type": "box",
        "center": [3.0, 3.0, 2.0],
        "dimensions": [2.0, 2.0, 2.0],
        "rpy_deg": [10.0, 20.0, 30.0],
        "mode": "inside",
    }
    assert shape_of(BoxSpec((0, 0, 0), (1, 1, 1), mode="outside"))[
        "rpy_deg"
    ] == [0.0, 0.0, 0.0]


def test_sts_02_prism_shape():
    assert shape_of(SQUARE) == {
        "type": "prism",
        "polygon": [[5.0, 5.0], [6.0, 5.0], [6.0, 6.0], [5.0, 6.0]],
        "z_min": -1.0,
        "z_max": 1.0,
        "mode": "inside",
    }


def test_sts_03_cluster_shape_with_nested_region():
    c = ClusterTool(
        100, 0.5, region=TILTED, exclude_protected=False, max_points=77
    )
    got = shape_of(c)
    assert got == {
        "type": "cluster",
        "seed_id": 100,
        "radius": 0.5,
        "max_points": 77,
        "exclude_protected": False,
        "region": shape_of(TILTED),
    }
    assert shape_of(ClusterTool(1, 2.0))["region"] is None
    assert (
        shape_of(ClusterTool(1, 2.0, region=SQUARE))["region"]["type"]
        == "prism"
    )


def test_sts_04_filter_shape_is_a_box_of_the_filter_bounds():
    filt = DisplayFilter(
        z=AxisRange(True, -1.0, 0.5), x=AxisRange(True, 2.0, 4.0)
    )
    bounds = {"min": [0.0, 0.0, 0.0], "max": [9.0, 9.0, 3.0]}
    assert shape_of(FilterTool(), filt, bounds) == {
        "type": "box",
        "center": [3.0, 4.5, -0.25],
        "dimensions": [2.0, 9.0, 1.5],
        "rpy_deg": [0.0, 0.0, 0.0],
        "mode": "inside",
    }
    assert shape_of(None) is None


def test_sts_05_tool_summary_is_unchanged():
    assert tool_summary(TILTED) == {"type": "box", "mode": "inside"}
    assert tool_summary(SQUARE) == {"type": "prism", "mode": "inside"}
    assert tool_summary(FilterTool()) == {"type": "filter"}
    assert tool_summary(ClusterTool(7, 0.25, region=SQUARE)) == {
        "type": "cluster",
        "seed_id": 7,
        "radius": 0.25,
    }
    assert tool_summary(None) is None


def test_sts_06_apply_stores_the_shape_and_state_exposes_it(mgr):
    s = del_box(mgr, TILTED)
    e = s.history.entries[0]
    assert e.shape == shape_of(TILTED)
    row = s.state()["history"]["entries"][0]
    assert row["shape"] == shape_of(TILTED)
    pts = s.xyz[~s.active]
    assert row["bounds"] == {
        "min": pts.min(axis=0).tolist(),
        "max": pts.max(axis=0).tolist(),
    }
    s.set_display_filter(DisplayFilter(z=AxisRange(True, -1.0, 0.5)))
    apply_spec(mgr, SelectSpec("replace", "displayed", FilterTool()))
    f = s.state()["history"]["entries"][1]["shape"]
    assert f["type"] == "box" and f["dimensions"][2] == 1.5


def test_sts_07_each_step_keeps_its_own_shape_through_every_edit(mgr):
    s = del_box(mgr, CORNER_BOX)
    del_box(mgr, GHOST_BOX)
    apply_spec(mgr, SelectSpec("replace", "active", SQUARE))
    want = {e.sid: e.shape for e in s.history.entries}
    assert len({json.dumps(v, sort_keys=True) for v in want.values()}) == 3
    s.undo(s.clock.cloud)
    s.redo(s.clock.cloud)
    s.rename_step(1, "ghost")
    s.rollback(s.clock.cloud, 1)
    s.rollback(s.clock.cloud, 3)
    s.delete_step(s.clock.cloud, 0)
    got = {e.sid: e.shape for e in s.history.entries}
    assert got == {k: v for k, v in want.items() if k != 0}


def test_sts_08_archive_round_trip_keeps_shapes_exactly(mgr, tmp_path):
    s = del_box(mgr, TILTED)
    apply_spec(mgr, SelectSpec("replace", "active", SQUARE))
    apply_spec(
        mgr,
        SelectSpec(
            "replace",
            "active",
            ClusterTool(0, 1.5, region=CORNER_BOX, exclude_protected=False),
        ),
    )
    before = [e.shape for e in s.history.entries]
    assert before[0]["rpy_deg"] == [10.0, 20.0, 30.0]
    fresh, r = reopen(tmp_path, save(mgr))
    try:
        assert [e.shape for e in r.history.entries] == before
        assert [e["shape"] for e in r.state()["history"]["entries"]] == before
    finally:
        fresh.jobs.shutdown()


def test_sts_09_an_archive_without_shapes_loads_with_null(mgr, tmp_path):
    s = del_box(mgr, CORNER_BOX)
    del_box(mgr, GHOST_BOX)
    src = save(mgr)
    dst = tmp_path / "before.pcdsession"

    def drop(m):
        for e in m["history"]["entries"]:
            e.pop("shape", None)

    rewrite_manifest(src, dst, drop)
    fresh, r = reopen(tmp_path, dst)
    try:
        assert [e.shape for e in r.history.entries] == [None, None]
        assert [(e.sid, e.name, len(e.ids)) for e in r.history.entries] == [
            (e.sid, e.name, len(e.ids)) for e in s.history.entries
        ]
        assert all(e["shape"] is None for e in r.state()["history"]["entries"])
    finally:
        fresh.jobs.shutdown()


def _with_shape(tmp_path, src, shape, name="bad.pcdsession"):
    dst = tmp_path / name

    def put(m):
        m["history"]["entries"][0]["shape"] = shape

    rewrite_manifest(src, dst, put)
    return dst


def _box(**kw):
    d = {
        "type": "box",
        "center": [0.0, 0.0, 0.0],
        "dimensions": [1.0, 1.0, 1.0],
        "rpy_deg": [0.0, 0.0, 0.0],
        "mode": "inside",
    }
    d.update(kw)
    return d


def test_sts_10_bad_shapes_are_refused(mgr, tmp_path):
    del_box(mgr, CORNER_BOX)
    src = save(mgr)
    big = {
        "type": "prism",
        "polygon": [[float(i), 0.0] for i in range(4097)],
        "z_min": 0.0,
        "z_max": 1.0,
        "mode": "inside",
    }
    deep = {
        "type": "cluster",
        "seed_id": 0,
        "radius": 1.0,
        "max_points": None,
        "exclude_protected": True,
        "region": {
            "type": "cluster",
            "seed_id": 0,
            "radius": 1.0,
            "region": None,
        },
    }
    bads = [
        _box(center=[math.nan, 0.0, 0.0]),
        _box(dimensions=[1.0, "x", 1.0]),
        _box(center=[0.0, 0.0]),
        _box(mode="sideways"),
        _box(type="torus"),
        big,
        deep,
        "box",
        [1, 2],
    ]
    for i, shape in enumerate(bads):
        path = _with_shape(tmp_path, src, shape, f"bad{i}.pcdsession")
        with pytest.raises(PcdError) as ei:
            arc.load_archive(path, tmp_path / f"d{i}.pcd", 1 << 30, 1 << 30)
        assert ei.value.code == "bad_archive", (i, ei.value.code)


def test_sts_11_entries_with_and_without_shape_mix(mgr, tmp_path):
    s = del_box(mgr, CORNER_BOX)
    del_box(mgr, GHOST_BOX)
    src = save(mgr)
    dst = tmp_path / "mixed.pcdsession"

    def drop_first(m):
        m["history"]["entries"][0].pop("shape", None)

    rewrite_manifest(src, dst, drop_first)
    fresh, r = reopen(tmp_path, dst)
    try:
        assert [e.shape for e in r.history.entries] == [
            None,
            s.history.entries[1].shape,
        ]
    finally:
        fresh.jobs.shutdown()


def test_sts_12_version_and_top_level_keys_unchanged(mgr):
    del_box(mgr, CORNER_BOX)
    with zipfile.ZipFile(save(mgr)) as zf:
        m = json.loads(zf.read("manifest.json"))
    assert m["version"] == 1 == arc.VERSION
    assert set(m) == {
        "format",
        "version",
        "created_utc",
        "unit",
        "client_state",
        "source",
        "history",
        "selection",
        "display_filter",
        "protection",
    }
    assert set(m["history"]["entries"][0]) == {
        "kind",
        "description",
        "count",
        "file",
        "sid",
        "tool",
        "name",
        "shape",
    }


def test_sts_13_step_bounds_equal_brute_force(mgr):
    s = del_box(mgr, CORNER_BOX)
    del_box(mgr, GHOST_BOX)
    del_box(mgr, MIDDLE_BOX)
    rows = s.state()["history"]["entries"]
    for e, row in zip(s.history.entries, rows, strict=True):
        pts = np.array([s.xyz[i] for i in e.ids.tolist()])
        assert row["bounds"] == {
            "min": [float(v) for v in pts.min(axis=0)],
            "max": [float(v) for v in pts.max(axis=0)],
        }


def test_sts_13b_a_remove_invalid_step_has_no_nan_bounds(mgr):
    s = mgr.require()
    s.remove_invalid(s.clock.cloud)
    row = s.state()["history"]["entries"][0]
    assert row["tool"] == "invalid" and row["shape"] is None
    json.dumps(row, allow_nan=False)  # NaN or inf would not be valid JSON
    assert row["bounds"] is None or all(
        math.isfinite(v) for v in row["bounds"]["min"] + row["bounds"]["max"]
    )
