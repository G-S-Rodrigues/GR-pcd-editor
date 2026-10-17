import os
import time

from fixtures.sessions import (
    delete_ghost,
    fixture_dir,
    make_settings,
    wait,
    write_scene,
)
from gr_pcd.app import create_app
from gr_pcd.files.cleanup import sweep_runtime, sweep_startup
from gr_pcd.session.manager import SessionManager

OLD = time.time() - 7200


def _age(path, when=OLD) -> None:
    os.utime(path, (when, when))


def _dirs(settings):
    w = settings.work_root
    return [
        w / d for d in ("uploads", "exports", "session-archives", "sessions")
    ]


def test_fil_33_startup_empties_and_tolerates_missing(tmp_path) -> None:
    settings = make_settings(tmp_path)
    settings.work_root.rmdir()
    sweep_startup(settings)
    assert not settings.work_root.exists()
    settings.work_root.mkdir()
    for d in _dirs(settings):
        (d / "x").mkdir(parents=True)
        (d / "x" / "f").write_text("1")
        (d / "g.part").write_text("1")
    sweep_startup(settings)
    for d in _dirs(settings):
        assert list(d.iterdir()) == []


def test_fil_34_runtime_keeps_active_part_drops_stale(tmp_path) -> None:
    settings = make_settings(tmp_path)
    mgr = SessionManager(settings)
    up = mgr.uploads_dir()
    active_id, stale_id, fresh_id = "a" * 32, "b" * 32, "c" * 32
    mgr.uploads.register(active_id, None)
    for uid in (active_id, stale_id, fresh_id):
        (up / f"{uid}.pcd.part").write_bytes(b"x")
    _age(up / f"{active_id}.pcd.part")
    _age(up / f"{stale_id}.pcd.part")
    sweep_runtime(mgr)
    assert sorted(p.name for p in up.iterdir()) == [
        f"{active_id}.pcd.part",
        f"{fresh_id}.pcd.part",
    ]


def test_fil_35_ttl_removes_old_downloads_only(tmp_path) -> None:
    settings = make_settings(tmp_path)
    write_scene(settings)
    mgr = SessionManager(settings)
    mgr.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    ids = []
    for _ in range(2):
        job = wait(mgr.submit_export("binary", "active"))
        assert job.status == "complete", job.error
        ids.append(job.result["export_id"])
    old, fresh = ids
    _age(mgr.downloads[old].path)
    sweep_runtime(mgr)
    assert old not in mgr.downloads and fresh in mgr.downloads
    assert not (settings.work_root / "exports" / f"{old}.pcd").exists()
    assert (settings.work_root / "exports" / f"{fresh}.pcd").exists()


def test_fil_36_live_session_dir_is_never_swept(tmp_path) -> None:
    settings = make_settings(tmp_path)
    write_scene(settings)
    mgr = SessionManager(settings)
    s = mgr.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    live = s.source_path.parent
    orphan = live.parent / "orphan"
    orphan.mkdir()
    _age(orphan)
    _age(live)
    _age(s.source_path)
    sweep_runtime(mgr)
    assert s.source_path.exists()
    assert not orphan.exists()
    sweep_startup(settings)  # a restart has no live session
    assert not live.exists()


def test_fil_37_saved_archive_in_ttl_is_still_usable(tmp_path) -> None:
    settings = make_settings(tmp_path)
    write_scene(settings)
    mgr = SessionManager(settings)
    mgr.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    s = delete_ghost(mgr)
    assert s.unsaved
    job = wait(mgr.submit_save())
    assert job.status == "complete", job.error
    sweep_runtime(mgr)
    aid = job.result["archive_id"]
    assert mgr.download(aid, "session-archives").path.exists()
    assert mgr.mark_saved(aid).unsaved is False


def test_fil_38_create_app_sweeps_orphans(tmp_path) -> None:
    settings = make_settings(tmp_path)
    orphan = settings.work_root / "sessions" / "dead"
    orphan.mkdir(parents=True)
    (orphan / "source.pcd").write_bytes(b"x")
    (settings.work_root / "exports").mkdir()
    (settings.work_root / "exports" / "old.pcd").write_bytes(b"x")
    create_app(settings)
    assert not orphan.exists()
    assert list((settings.work_root / "exports").iterdir()) == []
