"""FIL-14..: mounted folder, replace rules, uploads and downloads over HTTP."""

from fixtures.sessions import (
    delete_ghost,
    make_client,
    make_settings,
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
