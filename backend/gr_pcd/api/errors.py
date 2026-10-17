"""Map domain errors to HTTP: {"error": {"code", "message", ...}}."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from gr_pcd.editing.errors import EditError
from gr_pcd.geometry.errors import GeometryError
from gr_pcd.paths import PathEscapeError
from gr_pcd.pcd.errors import PcdError
from gr_pcd.session.errors import NoSessionError, NotFoundError, StaleRevision


def _body(code: str, message: str, status: int, **extra) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": code, "message": message, **extra}},
        status_code=status,
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(NoSessionError)
    def _no_session(_: Request, exc: NoSessionError):
        return _body("no_session", exc.message, 404)

    @app.exception_handler(NotFoundError)
    def _not_found(_: Request, exc: NotFoundError):
        return _body("not_found", exc.message, 404)

    @app.exception_handler(StaleRevision)
    def _stale(_: Request, exc: StaleRevision):
        return _body("stale_revision", exc.message, 409, current=exc.current)

    @app.exception_handler(PathEscapeError)
    def _escape(_: Request, exc: PathEscapeError):
        return _body("path_escape", str(exc), 422)

    @app.exception_handler(PcdError)
    def _pcd(_: Request, exc: PcdError):
        status = 413 if exc.code == "memory_budget_exceeded" else 422
        return _body(exc.code, exc.message, status)

    @app.exception_handler(EditError)
    def _edit(_: Request, exc: EditError):
        return _body(exc.code, exc.message, 422)

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
