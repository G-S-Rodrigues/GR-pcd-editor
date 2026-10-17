from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from gr_pcd.health import readiness_problems
from gr_pcd.settings import Settings


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI()

    @app.get("/health")
    def health() -> JSONResponse:
        problems = readiness_problems(settings)
        if problems:
            return JSONResponse(
                {"status": "unavailable", "problems": problems},
                status_code=503,
            )
        return JSONResponse({"status": "ok"})

    app.mount(
        "/",
        StaticFiles(directory=settings.static_dir, html=True, check_dir=False),
    )
    return app


app = create_app(Settings.from_env())
