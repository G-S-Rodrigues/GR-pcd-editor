"""PCD-62, SES-45..47, FIL-40: small robustness fixes (7c-2 step 3)."""

import errno
import shutil
import threading
import time

import pytest
from test_archive import saved_archive

from fixtures.pcdgen import SCENE_FIELDS, build_pcd, scene_rows
from fixtures.sessions import fixture_dir, make_settings, wait, write_scene
from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.header import parse_header
from gr_pcd.session import archive as arc
from gr_pcd.session import manager as manager_mod
from gr_pcd.session.exporter import export_session
from gr_pcd.session.jobs import JobManager
from gr_pcd.session.manager import SessionManager


def _header(**over):
    values = {
        "VERSION": ".7",
        "FIELDS": "x y z blob",
        "SIZE": "4 4 4 1",
        "TYPE": "F F F U",
        "COUNT": "1 1 1 1",
        "WIDTH": "1",
        "HEIGHT": "1",
        "VIEWPOINT": "0 0 0 1 0 0 0",
        "POINTS": "1",
        "DATA": "ascii",
    }
    values.update(over)
    return ("\n".join(f"{k} {v}" for k, v in values.items()) + "\n").encode()


@pytest.mark.parametrize(
    "over",
    [
        {"COUNT": "1 1 1 99999999999999999999"},
        {"COUNT": "1 1 1 1_0"},
        {"WIDTH": "1_0", "POINTS": "10"},
        {"COUNT": "1 1 1 4000000000000"},
    ],
)
def test_pcd_62_hostile_header_numbers_are_bad_header(over):
    with pytest.raises(PcdError) as ei:
        parse_header(_header(**over))
    assert ei.value.code == "bad_header"


@pytest.fixture
def env(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    mgr = SessionManager(settings)
    mgr.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    yield mgr
    mgr.jobs.shutdown()


class _Full:
    total = used = 1 << 40
    free = 10


def test_ses_45_no_space_is_refused_before_writing(env, tmp_path, monkeypatch):
    path, _ = saved_archive(env, tmp_path)
    dest = tmp_path / "dest-source.pcd"
    export_dir = tmp_path / "exp"
    export_dir.mkdir()
    monkeypatch.setattr(shutil, "disk_usage", lambda _p: _Full())
    with pytest.raises(OSError) as ei:
        arc.load_archive(path, dest, 1 << 30, 1 << 30)
    assert ei.value.errno == errno.ENOSPC
    assert not dest.exists()
    session = env.require()
    from gr_pcd.editing.cancel import CancelToken

    with pytest.raises(OSError) as ei:
        export_session(
            session, export_dir / "o.pcd", "binary", "active", CancelToken()
        )
    assert ei.value.errno == errno.ENOSPC
    assert list(export_dir.iterdir()) == []
    # as a job: a clear storage_full, not internal_error
    job = wait(env.submit_export("binary", "active"))
    assert job.status == "failed" and job.error["code"] == "storage_full"


def test_ses_46_opens_are_serialised_and_leave_one_session_dir(
    tmp_path, monkeypatch
):
    settings = make_settings(tmp_path)
    write_scene(settings)
    mgr = SessionManager(settings)
    real = manager_mod.read_pcd
    state = {"now": 0, "max": 0}
    guard = threading.Lock()

    def slow_read(*a, **k):
        with guard:
            state["now"] += 1
            state["max"] = max(state["max"], state["now"])
        time.sleep(0.15)
        try:
            return real(*a, **k)
        finally:
            with guard:
                state["now"] -= 1

    monkeypatch.setattr(manager_mod, "read_pcd", slow_read)
    barrier = threading.Barrier(2)

    def go():
        barrier.wait()
        mgr.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")

    threads = [threading.Thread(target=go) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert state["max"] == 1
    assert len(list((settings.work_root / "sessions").iterdir())) == 1
    mgr.jobs.shutdown()


def test_ses_47_cancel_of_a_running_job_is_never_complete():
    jm = JobManager(sweep=False)
    started, release = threading.Event(), threading.Event()

    def body(_ctx):
        started.set()
        release.wait(5)
        return {"done": True}  # ignores the token on purpose

    job = jm.submit("select", body)
    assert started.wait(5)
    jm.cancel(job.id)
    release.set()
    wait(job)
    assert job.status == "cancelled"
    assert job.result is None
    jm.shutdown()


def test_fil_40_upload_id_with_a_trailing_newline_is_rejected(tmp_path):
    from fixtures.sessions import make_client
    from gr_pcd.app import create_app

    settings = make_settings(tmp_path)
    c = make_client(create_app(settings))
    r = c.post(
        "/api/session/upload",
        params={
            "upload_id": "0123456789abcdef0123456789abcdef\n",
            "filename": "a.pcd",
        },
        content=build_pcd(SCENE_FIELDS, scene_rows(), "binary"),
        headers={"Content-Type": "application/octet-stream"},
    )
    assert r.status_code == 422, r.text


def test_fil_40b_archive_entry_name_with_a_trailing_newline_is_rejected():
    assert arc._NAME.fullmatch("manifest.json\n") is None
    assert arc._NAME.fullmatch("manifest.json") is not None


def test_api_63_hostile_header_over_http_is_a_json_422(tmp_path):
    from fixtures.sessions import make_client
    from gr_pcd.app import create_app

    settings = make_settings(tmp_path)
    c = make_client(create_app(settings))
    body = _header(COUNT="1 1 1 99999999999999999999") + b"1 2 3 4\n"
    r = c.post(
        "/api/session/upload",
        params={
            "upload_id": "0123456789abcdef0123456789abcdef",
            "filename": "h.pcd",
        },
        content=body,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "bad_header"
