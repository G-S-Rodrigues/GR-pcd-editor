"""FIL-14..: mounted folder, replace rules, uploads and downloads over HTTP."""

import time

from fixtures.pcdgen import SCENE_FIELDS, build_pcd, scene_rows
from fixtures.sessions import (
    delete_ghost,
    make_client,
    make_settings,
    wait,
    write_scene,
)
from gr_pcd.app import create_app


def _app(tmp_path, **kw):
    settings = make_settings(tmp_path, **kw)
    app = create_app(settings)
    return settings, app, make_client(app)


def test_fil_14_mounted_listing_and_open(tmp_path) -> None:
    settings, _unused, c = _app(tmp_path)
    (settings.data_root / "sub").mkdir()
    scene = write_scene(settings)
    scene.rename(settings.data_root / "sub" / "scene.pcd")
    r = c.get("/api/mounted", params={"path": "../"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "path_escape"
    r = c.get("/api/mounted", params={"path": "sub"})
    assert r.status_code == 200
    assert [e["name"] for e in r.json()["entries"]] == ["scene.pcd"]
    root = c.get("/api/mounted").json()
    assert [e["name"] for e in root["entries"]] == ["sub"]
    r = c.post("/api/session/open", json={"path": "sub/scene.pcd"})
    assert r.status_code == 200
    assert r.json()["filename"] == "scene.pcd"


def test_fil_05b_permission_error_is_403(tmp_path, monkeypatch) -> None:
    _settings, _unused, c = _app(tmp_path)

    def boom(*a, **k):
        raise PermissionError("denied")

    monkeypatch.setattr("gr_pcd.api.routes.list_mounted", boom)
    r = c.get("/api/mounted")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "mount_unreadable"


def test_fil_15_unsaved_work_needs_replace(tmp_path) -> None:
    settings, app, c = _app(tmp_path)
    write_scene(settings)
    write_scene(settings, "other.pcd")
    first = c.post("/api/session/open", json={"path": "scene.pcd"}).json()
    delete_ghost(app.state.manager)
    r = c.post("/api/session/open", json={"path": "other.pcd"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "unsaved_work"
    now = c.get("/api/session").json()
    assert (
        now["session_id"] == first["session_id"]
        and now["filename"] == "scene.pcd"
    )
    r = c.post("/api/session/open", json={"path": "other.pcd", "replace": True})
    assert r.status_code == 200
    assert r.json()["filename"] == "other.pcd"


def test_fil_16_clean_session_replaced_and_failure_keeps_old(
    tmp_path,
) -> None:
    settings, app, c = _app(tmp_path)
    write_scene(settings)
    write_scene(settings, "other.pcd")
    (settings.data_root / "bad.pcd").write_bytes(b"not a pcd")
    first = c.post("/api/session/open", json={"path": "scene.pcd"}).json()
    r = c.post("/api/session/open", json={"path": "other.pcd"})
    assert r.status_code == 200
    again = c.get("/api/session").json()
    delete_ghost(app.state.manager)
    r = c.post("/api/session/open", json={"path": "bad.pcd", "replace": True})
    assert r.status_code == 422
    assert c.get("/api/session").json()["session_id"] == again["session_id"]
    assert again["session_id"] != first["session_id"]


UP = "/api/session/upload"
UID = "0123456789abcdef0123456789abcdef"
OCT = {"Content-Type": "application/octet-stream"}


def _scene_bytes() -> bytes:
    return build_pcd(SCENE_FIELDS, scene_rows(), "binary")


def _upload(c, body, upload_id=UID, filename="my scan.pcd", **extra):
    params = {"upload_id": upload_id, "filename": filename, **extra}
    return c.post(UP, params=params, content=body, headers=OCT)


def _leftovers(settings):
    d = settings.work_root / "uploads"
    return sorted(p.name for p in d.iterdir()) if d.exists() else []


def test_fil_17_upload_pcd_opens_and_cleans_up(tmp_path) -> None:
    settings, _unused, c = _app(tmp_path)
    before = sorted(p.name for p in settings.data_root.iterdir())
    r = _upload(c, _scene_bytes(), filename='dir/my "scan".pcd')
    assert r.status_code == 200, r.text
    assert r.json()["filename"] == "my _scan_.pcd"
    assert _leftovers(settings) == []
    assert sorted(p.name for p in settings.data_root.iterdir()) == before
    prog = c.get(f"/api/uploads/{UID}").json()
    assert prog["status"] == "done"
    assert prog["received"] == prog["total"] == len(_scene_bytes())


def test_fil_18_upload_pcdsession_restores_edits(tmp_path) -> None:
    settings, app, c = _app(tmp_path)
    write_scene(settings)
    c.post("/api/session/open", json={"path": "scene.pcd"})
    mgr = app.state.manager
    delete_ghost(mgr)
    job = wait(mgr.submit_save())
    assert job.status == "complete", job.error
    blob = mgr.downloads[job.result["archive_id"]].path.read_bytes()
    r = _upload(c, blob, filename="a.pcdsession", replace="true")
    assert r.status_code == 200, r.text
    assert r.json()["counts"]["deleted"] == 27
    assert _leftovers(settings) == []


def test_fil_19_corrupt_upload_keeps_old_session(tmp_path) -> None:
    settings, _unused, c = _app(tmp_path)
    write_scene(settings)
    first = c.post("/api/session/open", json={"path": "scene.pcd"}).json()
    r = _upload(c, b"not a pcd at all")
    assert r.status_code == 422
    assert c.get("/api/session").json()["session_id"] == first["session_id"]
    assert _leftovers(settings) == []
    assert c.get(f"/api/uploads/{UID}").json()["status"] == "failed"


def test_fil_20_declared_length_over_limit_rejected_early(tmp_path) -> None:
    settings, _unused, c = _app(tmp_path, max_source_bytes=100)
    r = _upload(c, b"x" * 1000)
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "upload_too_large"
    assert _leftovers(settings) == []


def test_fil_21_streamed_body_over_limit_leaves_nothing(tmp_path) -> None:
    settings, _unused, c = _app(tmp_path, max_source_bytes=100)
    r = _upload(c, iter([b"x" * 60, b"y" * 60]))
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "upload_too_large"
    assert _leftovers(settings) == []


def test_fil_22_not_enough_storage_is_507(tmp_path) -> None:
    settings, _unused, c = _app(tmp_path, upload_reserve_bytes=2**62)
    r = _upload(c, _scene_bytes())
    assert r.status_code == 507
    assert r.json()["error"]["code"] == "storage_full"
    assert _leftovers(settings) == []


def test_fil_23_unsaved_work_blocks_upload_unless_replace(tmp_path) -> None:
    settings, app, c = _app(tmp_path)
    write_scene(settings)
    c.post("/api/session/open", json={"path": "scene.pcd"})
    delete_ghost(app.state.manager)
    r = _upload(c, _scene_bytes())
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "unsaved_work"
    assert not (settings.work_root / "uploads").exists()
    r = _upload(c, _scene_bytes(), upload_id="f" * 32, replace="true")
    assert r.status_code == 200, r.text


def test_fil_24_upload_ids_validated(tmp_path) -> None:
    _settings, app, c = _app(tmp_path)
    r = _upload(c, _scene_bytes(), upload_id="../etc")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_upload_id"
    app.state.manager.uploads.register(UID, None)
    r = _upload(c, _scene_bytes())
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "duplicate_upload"
    assert c.delete("/api/uploads/" + "e" * 32).status_code == 404
    r = c.delete(f"/api/uploads/{UID}")
    assert r.status_code == 200
    assert app.state.manager.uploads.get(UID).cancel_requested is True


def _export_url(c, fmt="binary"):
    r = c.post("/api/session/export", json={"format": fmt, "scope": "active"})
    assert r.status_code == 202, r.text
    jid = r.json()["id"]
    for _ in range(2000):
        job = c.get(f"/api/jobs/{jid}").json()
        if job["status"] not in ("queued", "running"):
            break
        time.sleep(0.01)
    assert job["status"] == "complete", job
    return f"/api/exports/{job['result']['export_id']}"


def test_fil_30_export_filename_is_attachment_without_quotes(
    tmp_path,
) -> None:
    settings, _unused, c = _app(tmp_path)
    src = write_scene(settings, 'my "scan".pcd')
    before = (src.read_bytes(), src.stat().st_mtime_ns)
    c.post("/api/session/open", json={"path": 'my "scan".pcd'})
    r = c.get(_export_url(c))
    assert r.status_code == 200
    cd = r.headers["content-disposition"]
    assert cd.startswith("attachment")
    assert "_cleaned.pcd" in cd
    assert "scan" in cd and "%22" not in cd and '"' not in cd
    assert (src.read_bytes(), src.stat().st_mtime_ns) == before  # AC-24


def test_fil_31_unicode_name_uses_rfc5987(tmp_path) -> None:
    settings, _unused, c = _app(tmp_path)
    write_scene(settings, "sala é.pcd")
    c.post("/api/session/open", json={"path": "sala é.pcd"})
    r = c.get(_export_url(c))
    assert "filename*=utf-8''" in r.headers["content-disposition"]


def test_fil_32_session_download_name_and_headers(tmp_path) -> None:
    settings, _unused, c = _app(tmp_path)
    src = write_scene(settings)
    before = (src.read_bytes(), src.stat().st_mtime_ns)
    c.post("/api/session/open", json={"path": "scene.pcd"})
    r = c.post("/api/session/save", json={})
    jid = r.json()["id"]
    for _ in range(2000):
        job = c.get(f"/api/jobs/{jid}").json()
        if job["status"] not in ("queued", "running"):
            break
        time.sleep(0.01)
    assert job["status"] == "complete", job
    d = c.get(f"/api/session-archives/{job['result']['archive_id']}")
    assert d.status_code == 200
    assert "_session_v1.pcdsession" in d.headers["content-disposition"]
    assert d.headers["cache-control"] == "no-store"
    assert d.headers["x-content-type-options"] == "nosniff"
    assert (src.read_bytes(), src.stat().st_mtime_ns) == before  # AC-24
