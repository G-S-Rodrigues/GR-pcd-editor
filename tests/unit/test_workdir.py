"""WRK-01..06: a work volume left by another uid must not break opening a file."""

import os
import stat

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from fixtures.pcdgen import SCENE_FIELDS, build_pcd, scene_rows
from fixtures.sessions import make_client, make_settings, upload
from gr_pcd.api.errors import install_error_handlers
from gr_pcd.app import create_app
from gr_pcd.files.cleanup import sweep_startup
from gr_pcd.files.workdir import sub_dirs

SUBS = ("uploads", "sessions", "exports", "session-archives")


def _body() -> bytes:
    return build_pcd(SCENE_FIELDS, scene_rows(), "binary")


@pytest.fixture
def stale(tmp_path):
    """Sub dirs an earlier uid made 0755 (not writable for us)."""
    settings = make_settings(tmp_path)
    for sub in SUBS:
        (settings.work_root / sub).mkdir(mode=0o755)
        (settings.work_root / sub).chmod(0o555)
    yield settings
    for p in settings.work_root.iterdir():
        p.chmod(0o755)


def test_wrk_01_upload_works_when_uploads_dir_is_not_writable(stale) -> None:
    c = make_client(create_app(stale))
    r = upload(c, _body())
    assert r.status_code == 200, r.text
    assert c.get("/api/session").json()["filename"] == "my scan.pcd"


def test_wrk_02_fallback_dirs_are_named_for_the_uid(stale) -> None:
    c = make_client(create_app(stale))
    assert upload(c, _body()).status_code == 200
    assert (stale.work_root / f"sessions.u{os.getuid()}").is_dir()
    assert not any((stale.work_root / "sessions").iterdir())


def test_wrk_03_new_dirs_are_open_to_other_uids(tmp_path) -> None:
    settings = make_settings(tmp_path)
    c = make_client(create_app(settings))
    assert upload(c, _body()).status_code == 200
    for sub in ("uploads", "sessions"):
        mode = stat.S_IMODE((settings.work_root / sub).stat().st_mode)
        assert mode == 0o1777, (sub, oct(mode))


def test_wrk_04_startup_sweep_covers_fallback_dirs(stale) -> None:
    c = make_client(create_app(stale))
    assert upload(c, _body()).status_code == 200
    fb = stale.work_root / f"sessions.u{os.getuid()}"
    assert list(fb.iterdir())
    assert fb in sub_dirs(stale.work_root, "sessions")
    sweep_startup(stale)
    assert not list(fb.iterdir())


def test_wrk_05_unwritable_work_root_says_what_and_how(tmp_path) -> None:
    settings = make_settings(tmp_path)
    settings.work_root.chmod(0o555)
    try:
        c = make_client(create_app(settings))
        r = upload(c, _body())
    finally:
        settings.work_root.chmod(0o755)
    err = r.json()["error"]
    assert r.status_code == 500
    assert err["code"] == "work_volume_not_writable"
    assert str(settings.work_root) in err["message"]
    assert "gr-pcd-visualizer.sh" in err["message"]
    assert "Permission denied" not in err["message"]


def test_wrk_06_any_permission_error_is_specific() -> None:
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/boom")
    def boom():
        raise PermissionError(13, "Permission denied", "/work/uploads/x.part")

    r = TestClient(app).get("/boom")
    err = r.json()["error"]
    assert r.status_code == 500 and err["code"] == "permission_denied"
    assert "/work/uploads/x.part" in err["message"]
    assert f"uid {os.getuid()}" in err["message"]
    assert "--rebuild" in err["message"]


def _job_result(c, response) -> dict:
    import time

    assert response.status_code == 202, response.text
    jid = response.json()["id"]
    for _ in range(2000):
        job = c.get(f"/api/jobs/{jid}").json()
        if job["status"] not in ("queued", "running"):
            break
        time.sleep(0.01)
    assert job["status"] == "complete", job
    return job["result"]


def test_wrk_07_export_downloads_from_a_fallback_dir(stale) -> None:
    c = make_client(create_app(stale))
    assert upload(c, _body()).status_code == 200
    res = _job_result(
        c, c.post("/api/session/export", json={"format": "binary"})
    )
    fb = stale.work_root / f"exports.u{os.getuid()}"
    written = fb / f"{res['export_id']}.pcd"
    assert written.is_file() and not any(
        (stale.work_root / "exports").iterdir()
    )
    r = c.get(f"/api/exports/{res['export_id']}")
    assert r.status_code == 200, r.text
    assert r.content == written.read_bytes()


def test_wrk_08_session_archive_downloads_from_a_fallback_dir(stale) -> None:
    c = make_client(create_app(stale))
    assert upload(c, _body()).status_code == 200
    res = _job_result(c, c.post("/api/session/save", json={}))
    fb = stale.work_root / f"session-archives.u{os.getuid()}"
    written = fb / f"{res['archive_id']}.pcdsession"
    assert written.is_file()
    r = c.get(f"/api/session-archives/{res['archive_id']}")
    assert r.status_code == 200, r.text
    assert r.content == written.read_bytes()
    assert (
        c.post(
            "/api/session/mark-saved", json={"archive_id": res["archive_id"]}
        ).status_code
        == 200
    )


def test_wrk_09_dangling_symlink_at_the_base_falls_back_without_a_500(
    tmp_path,
) -> None:
    settings = make_settings(tmp_path)
    target = tmp_path / "elsewhere"
    (settings.work_root / "uploads").symlink_to(target)  # dangling
    c = make_client(create_app(settings))
    r = upload(c, _body())
    assert r.status_code == 200, r.text
    assert not target.exists()  # never created through the link
    assert (settings.work_root / f"uploads.u{os.getuid()}").is_dir()


def test_wrk_10_a_planted_symlink_to_a_dir_is_never_chmodded_or_used(
    tmp_path,
) -> None:
    settings = make_settings(tmp_path)
    victim = tmp_path / "victim"
    victim.mkdir(mode=0o700)
    (settings.work_root / "uploads").symlink_to(victim)
    c = make_client(create_app(settings))
    assert upload(c, _body()).status_code == 200
    assert stat.S_IMODE(victim.stat().st_mode) == 0o700
    assert list(victim.iterdir()) == []
    fallback = settings.work_root / f"uploads.u{os.getuid()}"
    assert fallback.is_dir()  # the fallback was used, not the link


def test_wrk_11_a_symlinked_fallback_is_a_specific_error(tmp_path) -> None:
    settings = make_settings(tmp_path)
    other = tmp_path / "other"
    other.mkdir()
    (settings.work_root / "uploads").symlink_to(other)
    (settings.work_root / f"uploads.u{os.getuid()}").symlink_to(other)
    c = make_client(create_app(settings))
    r = upload(c, _body())
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "work_volume_not_writable"
    assert list(other.iterdir()) == []


def test_wrk_12_a_base_owned_by_another_uid_is_not_used(
    tmp_path, monkeypatch
) -> None:
    from gr_pcd.files import workdir

    settings = make_settings(tmp_path)
    (settings.work_root / "uploads").mkdir(mode=0o777)
    (settings.work_root / "uploads").chmod(0o777)
    real = workdir._lstat

    def foreign(path):
        st = real(path)
        if st is not None and path.name == "uploads":
            fields = list(st)
            fields[4] = os.getuid() + 1  # st_uid
            return os.stat_result(fields)
        return st

    monkeypatch.setattr(workdir, "_lstat", foreign)
    out = workdir.ensure_dir(settings.work_root, "uploads", "x")
    assert out == settings.work_root / f"uploads.u{os.getuid()}" / "x"
    assert list((settings.work_root / "uploads").iterdir()) == []


def test_wrk_13_sweeps_and_listing_skip_symlinked_and_odd_dirs(
    tmp_path,
) -> None:
    from gr_pcd.files.cleanup import sweep_startup

    settings = make_settings(tmp_path)
    root = settings.work_root
    victim = tmp_path / "victim"
    victim.mkdir()
    (victim / "keep.txt").write_text("x")
    (root / "sessions").symlink_to(victim)
    (root / "sessions.u4242").symlink_to(victim)
    (root / "sessions.ufoo").mkdir()
    (root / "sessions.u7").mkdir()
    assert sub_dirs(root, "sessions") == [root / "sessions.u7"]
    sweep_startup(settings)
    assert (victim / "keep.txt").exists()
