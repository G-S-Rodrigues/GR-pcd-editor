"""Map domain errors to HTTP: {"error": {"code", "message", ...}}."""

import errno
import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from gr_pcd.editing.errors import EditError
from gr_pcd.files.uploads import UploadError
from gr_pcd.files.workdir import FIX_HINT, WorkVolumeError
from gr_pcd.geometry.errors import GeometryError
from gr_pcd.pcd.errors import PcdError
from gr_pcd.session.errors import (
    NoSessionError,
    NotFoundError,
    ReplaceConflict,
    SessionChanged,
    StaleRevision,
)


def _body(code: str, message: str, status: int, **extra) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": code, "message": message, **extra}},
        status_code=status,
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(NoSessionError)
    def _no_session(_: Request, exc: NoSessionError):
        return _body("no_session", exc.message, 404)

    @app.exception_handler(SessionChanged)
    def _changed(_: Request, exc: SessionChanged):
        return _body(exc.code, exc.message, 409, session_id=exc.current)

    @app.exception_handler(NotFoundError)
    def _not_found(_: Request, exc: NotFoundError):
        return _body(exc.code, exc.message, 404)

    @app.exception_handler(StaleRevision)
    def _stale(_: Request, exc: StaleRevision):
        return _body("stale_revision", exc.message, 409, current=exc.current)

    @app.exception_handler(ReplaceConflict)
    def _replace(_: Request, exc: ReplaceConflict):
        return _body(exc.code, exc.message, 409)

    @app.exception_handler(UploadError)
    def _upload(_: Request, exc: UploadError):
        return _body(exc.code, exc.message, exc.status)

    @app.exception_handler(WorkVolumeError)
    def _work_volume(_: Request, exc: WorkVolumeError):
        return _body(exc.code, exc.message, exc.status)

    @app.exception_handler(OSError)
    def _oserror(_: Request, exc: OSError):
        if isinstance(exc, PermissionError):
            where = f" {exc.filename}" if exc.filename else " a file"
            return _body(
                "permission_denied",
                f"The app (uid {os.getuid()}) is not allowed to access"
                f"{where}. {FIX_HINT}.",
                500,
            )
        if exc.errno == errno.ENOSPC:
            return _body(
                "storage_full", "the work volume has no space left", 507
            )
        return _body("io_error", f"file system error: {exc.strerror}", 500)

    @app.exception_handler(PcdError)
    def _pcd(_: Request, exc: PcdError):
        status = 413 if exc.code == "memory_budget_exceeded" else 422
        return _body(exc.code, exc.message, status)

    @app.exception_handler(EditError)
    def _edit(_: Request, exc: EditError):
        status = 404 if exc.code == "no_such_step" else 422
        return _body(exc.code, exc.message, status)

    @app.exception_handler(GeometryError)
    def _geometry(_: Request, exc: GeometryError):
        return _body(exc.code, exc.message, 422)

    @app.exception_handler(RequestValidationError)
    def _validation(_: Request, exc: RequestValidationError):
        parts = [
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}"
            for e in exc.errors()
        ]
        return _body("invalid_request", "; ".join(parts), 422)
