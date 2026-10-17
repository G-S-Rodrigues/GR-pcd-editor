from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from gr_pcd.api.errors import install_error_handlers
from gr_pcd.api.origin import LocalOriginGuard
from gr_pcd.api.routes import build_router
from gr_pcd.files.cleanup import sweep_startup
from gr_pcd.health import readiness_problems
from gr_pcd.session.manager import SessionManager
from gr_pcd.settings import Settings


def create_app(settings: Settings) -> FastAPI:
    sweep_startup(settings)
    manager = SessionManager(settings)
    app = FastAPI()
    app.state.manager = manager
    install_error_handlers(app)
    app.add_middleware(LocalOriginGuard, settings=settings)

    @app.get("/health")
    def health() -> JSONResponse:
        problems = readiness_problems(settings)
        if problems:
            return JSONResponse(
                {"status": "unavailable", "problems": problems},
                status_code=503,
            )
        return JSONResponse({"status": "ok"})

    app.include_router(build_router(manager, settings))
    # the static mount must stay last: it matches every remaining path
    app.mount(
        "/",
        StaticFiles(directory=settings.static_dir, html=True, check_dir=False),
    )
    return app


app = create_app(Settings.from_env())
