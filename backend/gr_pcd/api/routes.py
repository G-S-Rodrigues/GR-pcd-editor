"""HTTP routes: validation and mapping only; logic lives in the session."""

import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from gr_pcd.api.render import render_body, render_headers
from gr_pcd.api.schemas import (
    ApplyBody,
    DisplayFilterBody,
    ExportBody,
    MarkSavedBody,
    NearestBody,
    OpenBody,
    ProtectionBody,
    RevisionBody,
    SelectionBody,
)
from gr_pcd.files.mounted import list_mounted
from gr_pcd.paths import resolve_data_path
from gr_pcd.session.engine import SelectSpec
from gr_pcd.session.errors import NotFoundError
from gr_pcd.session.manager import SessionManager
from gr_pcd.settings import Settings

MAX_CLIENT_STATE = 1024 * 1024


def _job(job) -> JSONResponse:
    return JSONResponse(job.to_dict(), status_code=202)


def build_router(manager: SessionManager, settings: Settings) -> APIRouter:
    router = APIRouter(prefix="/api")

    def existing_file(relative: str):
        path = resolve_data_path(settings.data_root, relative)
        if not path.is_file():
            raise NotFoundError(f"no such file: {relative}")
        return path

    @router.get("/mounted")
    def mounted(path: str = ""):
        return list_mounted(settings.data_root, path)

    @router.get("/session")
    def get_session():
        return manager.require().state()

    @router.post("/session/open")
    def open_session(body: OpenBody):
        path = existing_file(body.path)
        manager.require_replaceable(body.replace)
        return manager.open_pcd(path, path.name).state()

    @router.post("/session/open-archive")
    def open_archive(body: OpenBody):
        path = existing_file(body.path)
        manager.require_replaceable(body.replace)
        return manager.open_archive(path).state()

    @router.delete("/session")
    def close_session():
        manager.close()
        return {"closed": True}

    @router.put("/session/display-filter")
    def put_filter(body: DisplayFilterBody):
        s = manager.require()
        s.set_display_filter(body.to_spec())
        return s.state()

    @router.put("/session/protection")
    def put_protection(body: ProtectionBody):
        s = manager.require()
        s.set_protection(body.to_spec())
        return s.state()

    @router.put("/session/client-state")
    async def put_client_state(request: Request):
        s = manager.require()
        raw = await request.body()
        if len(raw) > MAX_CLIENT_STATE:
            return JSONResponse(
                {
                    "error": {
                        "code": "payload_too_large",
                        "message": "client state exceeds 1 MiB",
                    }
                },
                status_code=413,
            )
        try:
            value = json.loads(raw)
        except ValueError:
            value = None
        if not isinstance(value, dict):
            return JSONResponse(
                {
                    "error": {
                        "code": "invalid_request",
                        "message": "client state must be a JSON object",
                    }
                },
                status_code=422,
            )
        s.set_client_state(value)
        return {"ok": True}

    @router.post("/session/selection")
    def post_selection(body: SelectionBody):
        s = manager.require()
        s.require_cloud(body.cloud_revision)
        tool = None if body.tool is None else body.tool.to_spec()
        spec = SelectSpec(body.op, body.scope, tool, body.evaluate_candidate)
        return _job(manager.submit_select(spec))

    @router.post("/session/selection/clear")
    def clear_selection(body: RevisionBody):
        s = manager.require()
        s.clear_selection(body.cloud_revision)
        return s.state()

    @router.post("/session/candidate")
    def post_candidate(body: RevisionBody):
        manager.require().require_cloud(body.cloud_revision)
        return _job(manager.submit_candidate())

    @router.get("/session/candidate/ids")
    def candidate_ids(
        candidate_id: str,
        offset: int = Query(0, ge=0),
        limit: int = Query(1000, ge=1, le=1_000_000),
    ):
        return manager.require().candidate_ids(candidate_id, offset, limit)

    @router.post("/session/apply")
    def apply(body: ApplyBody):
        s = manager.require()
        s.apply(body.candidate_id, body.cloud_revision, body.description)
        return s.state()

    @router.post("/session/undo")
    def undo(body: RevisionBody):
        s = manager.require()
        s.undo(body.cloud_revision)
        return s.state()

    @router.post("/session/redo")
    def redo(body: RevisionBody):
        s = manager.require()
        s.redo(body.cloud_revision)
        return s.state()

    @router.post("/session/remove-invalid")
    def remove_invalid(body: RevisionBody):
        s = manager.require()
        s.remove_invalid(body.cloud_revision)
        return s.state()

    @router.post("/session/nearest")
    def nearest(body: NearestBody):
        return manager.require().nearest(body.point, body.radius)

    @router.get("/session/render")
    def render(
        budget: int = Query(100_000, ge=1, le=2_000_000),
        mode: str = Query("edited"),
    ):
        arr, rev = manager.require().render(budget, mode)
        return Response(
            render_body(arr),
            media_type="application/octet-stream",
            headers=render_headers(arr, rev),
        )

    @router.post("/session/export")
    def export(body: ExportBody):
        return _job(manager.submit_export(body.format, body.scope))

    @router.get("/exports/{export_id}")
    def download_export(export_id: str):
        d = manager.download(export_id, "exports")
        return FileResponse(
            d.path, media_type="application/octet-stream", filename=d.filename
        )

    @router.post("/session/save")
    def save(body: dict | None = None):
        return _job(manager.submit_save())

    @router.get("/session-archives/{archive_id}")
    def download_archive(archive_id: str):
        d = manager.download(archive_id, "session-archives")
        return FileResponse(
            d.path, media_type="application/octet-stream", filename=d.filename
        )

    @router.post("/session/mark-saved")
    def mark_saved(body: MarkSavedBody):
        return manager.mark_saved(body.archive_id).state()

    @router.get("/jobs/{job_id}")
    def get_job(job_id: str):
        job = manager.jobs.get(job_id)
        if job is None:
            raise NotFoundError("no such job")
        return job.to_dict()

    @router.post("/jobs/{job_id}/cancel")
    def cancel_job(job_id: str):
        job = manager.jobs.cancel(job_id)
        if job is None:
            raise NotFoundError("no such job")
        return job.to_dict()

    return router
