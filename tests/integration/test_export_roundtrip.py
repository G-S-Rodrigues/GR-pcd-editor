"""SES-15..21: export of the edited cloud, reparsed against hand lists."""

import numpy as np
import pytest

from fixtures.pcdgen import (
    SCENE_FIELDS,
    SCENE_FLOOR,
    SCENE_GHOST,
    SCENE_INVALID,
    build_pcd,
    scene_rows,
)
from fixtures.sessions import (
    box_all_ghost,
    delete_ghost,
    make_settings,
    select_box,
    wait,
    write_scene,
)
from gr_pcd.editing.cancel import Cancelled, CancelToken
from gr_pcd.geometry.filters import AxisRange, DisplayFilter
from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.reader import read_pcd
from gr_pcd.session.exporter import export_session
from gr_pcd.session.manager import SessionManager


@pytest.fixture
def mgr(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    m = SessionManager(settings)
    m.open_pcd(settings.data_root / "scene.pcd", "scene.pcd")
    yield m
    m.jobs.shutdown()


def export(mgr, fmt="binary", scope="active"):
    job = wait(mgr.submit_export(fmt, scope))
    assert job.status == "complete", job.error
    return job.result, mgr.downloads[job.result["export_id"]].path


def assert_rows(path, ids):
    cloud = read_pcd(path)
    expect = np.array([scene_rows()[i] for i in sorted(ids)], dtype=np.float64)
    assert cloud.n == len(expect)
    got = np.stack([cloud.records[f"c{k}"] for k in range(4)], axis=1)
    np.testing.assert_array_equal(got, expect.reshape(-1, 4))
    return cloud


ALL = set(range(129))


def test_ses_15_default_scope_ignores_filter_and_selection(mgr):
    s = mgr.require()
    s.set_display_filter(DisplayFilter(z=AxisRange(True, 0.0, 0.0)))
    select_box(mgr, box_all_ghost())
    summary, path = export(mgr)
    assert summary["count"] == 129 and summary["scope"] == "active"
    assert_rows(path, ALL)


def test_ses_16_after_delete_and_untouched(mgr):
    summary, path = export(mgr)
    cloud = assert_rows(path, ALL)
    assert (cloud.width, cloud.height) == (129, 1)
    delete_ghost(mgr)
    summary, path = export(mgr, "ascii")
    cloud = assert_rows(path, ALL - SCENE_GHOST)
    assert (cloud.width, cloud.height) == (102, 1)
    assert summary["filename"] == "scene_cleaned.pcd"
    assert cloud.viewpoint == ("0", "0", "0", "1", "0", "0", "0")
    assert [f.name for f in cloud.schema] == ["x", "y", "z", "intensity"]


def test_ses_17_invalid_retained_then_removed(mgr):
    summary, path = export(mgr)
    assert summary["invalid_retained"] == 2
    s = mgr.require()
    s.remove_invalid(s.clock.cloud)
    summary, path = export(mgr)
    assert summary["invalid_retained"] == 0 and summary["count"] == 127
    assert_rows(path, ALL - SCENE_INVALID)


def test_ses_18_scopes(mgr):
    s = mgr.require()
    select_box(mgr, box_all_ghost())
    summary, path = export(mgr, scope="selected")
    assert summary["scope"] == "selected"
    assert_rows(path, SCENE_GHOST)
    s.set_display_filter(DisplayFilter(z=AxisRange(True, 0.0, 0.0)))
    summary, path = export(mgr, scope="displayed")
    assert_rows(path, SCENE_FLOOR)


@pytest.mark.parametrize("encoding", ["ascii", "binary", "binary_compressed"])
@pytest.mark.parametrize("fmt", ["ascii", "binary"])
def test_ses_19_encodings_and_custom_fields(tmp_path, encoding, fmt):
    settings = make_settings(tmp_path)
    fields = SCENE_FIELDS + [("custom", "I", 4, 3), ("_", "U", 1, 1)]
    rows = [r + ((1, -2, 3), 7) for r in scene_rows()]
    (settings.data_root / "c.pcd").write_bytes(
        build_pcd(fields, rows, encoding)
    )
    m = SessionManager(settings)
    m.open_pcd(settings.data_root / "c.pcd", "c.pcd")
    job = wait(m.submit_export(fmt, "active"))
    assert job.status == "complete", job.error
    out = read_pcd(m.downloads[job.result["export_id"]].path)
    assert [(f.name, f.count) for f in out.schema][-2:] == [
        ("custom", 3),
        ("_", 1),
    ]
    assert out.records["c4"][0].tolist() == [1, -2, 3]
    assert out.records["c5"][5] == 7
    m.jobs.shutdown()


def test_ses_20_cancel_or_failure_leaves_nothing(mgr, tmp_path, monkeypatch):
    s = mgr.require()
    out = tmp_path / "out.pcd"
    token = CancelToken()
    token.cancel()
    with pytest.raises(Cancelled):
        export_session(s, out, "binary", "active", token)
    assert not out.exists() and not list(tmp_path.glob(".export-*"))
    from gr_pcd.pcd import writer

    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(writer, "write_pcd", boom)
    with pytest.raises(OSError):
        export_session(s, out, "binary", "active", CancelToken())
    assert not out.exists() and not list(tmp_path.glob(".export-*"))


def test_ses_21_overwrite_and_source_refused(mgr, tmp_path):
    s = mgr.require()
    out = tmp_path / "exists.pcd"
    out.write_bytes(b"keep")
    with pytest.raises(PcdError) as err:
        export_session(s, out, "binary", "active", CancelToken())
    assert (
        err.value.code == "destination_exists" and out.read_bytes() == b"keep"
    )
    for src in (s.original_path, s.source_path):
        with pytest.raises(PcdError) as err:
            export_session(s, src, "binary", "active", CancelToken(), True)
        assert err.value.code == "would_overwrite_source"
