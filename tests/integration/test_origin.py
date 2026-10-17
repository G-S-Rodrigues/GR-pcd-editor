"""FIL-26..29: loopback Host/Origin guard on /api."""

from fixtures.pcdgen import SCENE_FIELDS, build_pcd, scene_rows
from fixtures.sessions import make_client, make_settings
from gr_pcd.app import create_app

PORT = 8080


def _client(tmp_path, **kw):
    settings = make_settings(tmp_path, **kw)
    return settings, make_client(create_app(settings))


def test_fil_26_foreign_host_rejected(tmp_path) -> None:
    _settings, c = _client(tmp_path)
    for method in ("get", "post"):
        r = getattr(c, method)("/api/session", headers={"Host": "evil.example"})
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "forbidden_host"
    r = c.get("/api/session", headers={"Host": f"localhost:{PORT + 1}"})
    assert r.status_code == 403


def test_fil_27_foreign_origin_rejected_without_cors(tmp_path) -> None:
    _settings, c = _client(tmp_path)
    for method in ("get", "post"):
        r = getattr(c, method)(
            "/api/session", headers={"Origin": "http://evil.example"}
        )
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "forbidden_origin"
        assert "access-control-allow-origin" not in r.headers
    ok = c.get("/api/session")
    assert "access-control-allow-origin" not in ok.headers


def test_fil_28_loopback_origins_pass(tmp_path) -> None:
    _settings, c = _client(tmp_path)
    for host in ("localhost", "127.0.0.1", "[::1]"):
        r = c.get(
            "/api/session",
            headers={
                "Host": f"{host}:{PORT}",
                "Origin": f"http://{host}:{PORT}",
            },
        )
        assert r.status_code == 404, (host, r.text)  # no session, not 403
    r = c.get("/api/session", headers={"Origin": "http://localhost:9999"})
    assert r.status_code == 403


def test_fil_29_cross_site_fetch_metadata_and_unguarded_paths(
    tmp_path,
) -> None:
    _settings, c = _client(tmp_path)
    for site in ("cross-site", "same-site"):
        r = c.post(
            "/api/session/selection/clear", headers={"Sec-Fetch-Site": site}
        )
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "forbidden_origin"
    assert c.delete("/api/session").status_code == 200
    r = c.delete("/api/session", headers={"Sec-Fetch-Site": "same-origin"})
    assert r.status_code == 200
    evil = {"Host": "evil.example"}
    assert c.get("/health", headers=evil).status_code == 200
    assert c.get("/", headers=evil).status_code == 200
    assert c.get("/apix", headers=evil).status_code != 403


def test_fil_29b_cross_origin_upload_stores_nothing(tmp_path) -> None:
    settings, c = _client(tmp_path)
    body = build_pcd(SCENE_FIELDS, scene_rows(), "binary")
    r = c.post(
        "/api/session/upload",
        params={"upload_id": "a" * 32, "filename": "x.pcd"},
        content=body,
        headers={
            "Content-Type": "application/octet-stream",
            "Origin": "http://evil.example",
        },
    )
    assert r.status_code == 403
    assert not (settings.work_root / "uploads").exists()
