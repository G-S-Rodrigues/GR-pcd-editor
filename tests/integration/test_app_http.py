import re
from pathlib import Path

from fastapi.testclient import TestClient

from gr_pcd.app import create_app
from gr_pcd.settings import Settings


def _settings(tmp_path: Path) -> Settings:
    data = tmp_path / "data"
    work = tmp_path / "work"
    static = tmp_path / "static"
    for d in (data, work, static):
        d.mkdir()
    (static / "index.html").write_text("<html></html>")
    return Settings(data_root=data, work_root=work, static_dir=static)


def test_be_10_health_ok_when_ready(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_be_11_health_503_names_problems(tmp_path: Path) -> None:
    s = _settings(tmp_path)
    s.work_root.rmdir()
    client = TestClient(create_app(s))
    r = client.get("/health")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "unavailable"
    assert body["problems"]


def test_be_12_index_and_referenced_assets_served() -> None:
    s = Settings.from_env()
    client = TestClient(create_app(s))
    r = client.get("/")
    assert r.status_code == 200
    assert 'data-app="gr-pcd-editor"' in r.text
    refs = re.findall(r'(?:src|href)="([^"]+)"', r.text)
    assert any(ref.endswith(".js") for ref in refs)
    for ref in refs:
        assert client.get(ref).status_code == 200, ref


def test_be_13_no_remote_asset_urls() -> None:
    s = Settings.from_env()
    html = (s.static_dir / "index.html").read_text()
    assert 'src="http' not in html and 'href="http' not in html
    for js in (s.static_dir / "assets").glob("*.js"):
        text = js.read_text()
        assert 'import("http' not in text
        assert 'from"http' not in text
