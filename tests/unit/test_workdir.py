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
