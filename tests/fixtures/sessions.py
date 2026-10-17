"""Helpers shared by session and API tests (no production parsing)."""

import time

from fixtures.pcdgen import SCENE_FIELDS, build_pcd, scene_rows
from gr_pcd.settings import Settings


def make_settings(tmp_path, **kw) -> Settings:
    data, work, static = (tmp_path / d for d in ("data", "work", "static"))
    for d in (data, work, static):
        d.mkdir(parents=True, exist_ok=True)
    (static / "index.html").write_text("<html></html>")
    return Settings(work_root=work, static_dir=static, **kw)


def fixture_dir(settings):
    """Scratch folder for generated test files (not known to the app)."""
    return settings.work_root.parent / "data"


UP = "/api/session/upload"
UID = "0123456789abcdef0123456789abcdef"
OCT = {"Content-Type": "application/octet-stream"}


def upload(c, body, upload_id=UID, filename="my scan.pcd", **extra):
    params = {"upload_id": upload_id, "filename": filename, **extra}
    return c.post(UP, params=params, content=body, headers=OCT)


def open_via_upload(client, path, filename=None, replace=False, upload_id=None):
    """Open a file on disk through the upload route (the only way in)."""
    import uuid
    from pathlib import Path

    path = Path(path)
    return upload(
        client,
        path.read_bytes(),
        upload_id=upload_id or uuid.uuid4().hex,
        filename=filename or path.name,
        replace=replace,
    )


def make_client(app):
    """TestClient whose Host matches the public origin guard."""
    from fastapi.testclient import TestClient

    return TestClient(app, base_url="http://localhost:8080")


def write_scene(settings, name="scene.pcd", encoding="binary"):
    path = fixture_dir(settings) / name
    path.write_bytes(build_pcd(SCENE_FIELDS, scene_rows(), encoding))
    return path


def wait(job, timeout=10.0):
    end = time.time() + timeout
    while job.status in ("queued", "running"):
        if time.time() > end:
            raise TimeoutError(job.status)
        time.sleep(0.005)
    return job


def box_all_ghost():
    from gr_pcd.geometry.box import BoxSpec

    return BoxSpec(center=(3.0, 3.0, 2.0), dimensions=(2.0, 2.0, 2.0))


def select_box(mgr, box, op="replace", scope="active"):
    from gr_pcd.session.engine import SelectSpec

    return wait(mgr.submit_select(SelectSpec(op, scope, box)))


def delete_ghost(mgr):
    job = select_box(mgr, box_all_ghost())
    assert job.status == "complete", job.error
    cand = job.result["candidate"]
    s = mgr.require()
    s.apply(cand["candidate_id"], s.clock.cloud, None)
    return s
