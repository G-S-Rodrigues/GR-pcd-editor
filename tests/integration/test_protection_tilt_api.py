"""API-70..71 and SES-50..51: the tilt on the wire and in the archive."""

import json
import zipfile

import pytest
from test_api_session import Api

from fixtures.sessions import fixture_dir, make_settings, wait, write_scene
from gr_pcd.session.manager import SessionManager

TILTED = {
    "global": {"enabled": True, "min": -0.5, "max": 0.5},
    "operation": {
        "mode": "inherit",
        "local": None,
        "acknowledge_override": False,
    },
    "tilt": {"rx_deg": 5.0, "ry_deg": -10.0, "pivot": [1.5, 2.5]},
}
LEVEL_KEYS = {"global", "operation"}


@pytest.fixture
def api(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    return Api(settings)


def test_api_70_tilt_round_trip_and_level_omitted(api):
    api.open()
    c = api.client
    level = {"global": {"enabled": True, "min": 0.0, "max": 1.0}}
    r = c.put("/api/session/protection", json=level)  # old body, no tilt
    assert r.status_code == 200, r.text
    assert set(api.state()["protection"]) == LEVEL_KEYS
    r = c.put("/api/session/protection", json=TILTED)
    assert r.status_code == 200, r.text
    assert api.state()["protection"]["tilt"] == TILTED["tilt"]
    # explicit zero angles are level: no tilt in the state
    zero = dict(TILTED, tilt={"rx_deg": 0, "ry_deg": 0, "pivot": [3, 4]})
    assert c.put("/api/session/protection", json=zero).status_code == 200
    assert "tilt" not in api.state()["protection"]


def test_api_71_tilt_validation_422(api):
    api.open()
    c = api.client
    assert c.put("/api/session/protection", json=TILTED).status_code == 200
    for bad in (
        {"rx_deg": 61, "ry_deg": 0, "pivot": [0, 0]},
        {"rx_deg": 0, "ry_deg": -60.5, "pivot": [0, 0]},
        {"rx_deg": 0, "ry_deg": 0, "pivot": [0]},
        {"rx_deg": 0, "ry_deg": 0, "pivot": [0, 0], "extra": 1},
        {"rx_deg": "a", "ry_deg": 0, "pivot": [0, 0]},
    ):
        r = c.put("/api/session/protection", json=dict(TILTED, tilt=bad))
        assert r.status_code == 422, bad
    r = c.put(
        "/api/session/protection",
        content=json.dumps(
            dict(TILTED, tilt={"rx_deg": "NaN", "ry_deg": 0, "pivot": [0, 0]})
        ),
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 422
    # every rejected body left the accepted tilt in place
    assert api.state()["protection"]["tilt"] == TILTED["tilt"]


def _save(mgr):
    job = wait(mgr.submit_save())
    assert job.status == "complete", job.error
    return mgr.downloads[job.result["archive_id"]].path


def _manifest(path):
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read("manifest.json"))


def test_ses_50_archive_round_trip(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    mgr = SessionManager(settings)
    s = mgr.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    from gr_pcd.editing.protection import Interval, ProtectionState, Tilt

    s.set_protection(
        ProtectionState(
            Interval(True, -0.5, 0.5), tilt=Tilt(5.0, -10.0, (1.5, 2.5))
        )
    )
    path = _save(mgr)
    assert _manifest(path)["protection"]["tilt"] == TILTED["tilt"]
    fresh = SessionManager(make_settings(tmp_path / "other"))
    s2 = fresh.open_archive(path)
    assert s2.protection.tilt == Tilt(5.0, -10.0, (1.5, 2.5))
    assert s2.state()["protection"]["tilt"] == TILTED["tilt"]
    mgr.jobs.shutdown()
    fresh.jobs.shutdown()


def test_ses_51_old_archive_loads_level_and_level_json_unchanged(tmp_path):
    from gr_pcd.editing.protection import Interval, ProtectionState, Tilt

    settings = make_settings(tmp_path)
    write_scene(settings)
    mgr = SessionManager(settings)
    s = mgr.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    s.set_protection(ProtectionState(Interval(True, 0.0, 0.5)))
    path = _save(mgr)
    # a level session writes exactly the pre-tilt protection JSON
    assert _manifest(path)["protection"] == {
        "global": {"enabled": True, "min": 0.0, "max": 0.5},
        "operation": {
            "mode": "inherit",
            "local": None,
            "acknowledge_override": False,
        },
    }
    fresh = SessionManager(make_settings(tmp_path / "other"))
    s2 = fresh.open_archive(path)
    assert s2.protection.tilt == Tilt()
    assert "tilt" not in s2.state()["protection"]
    mgr.jobs.shutdown()
    fresh.jobs.shutdown()
