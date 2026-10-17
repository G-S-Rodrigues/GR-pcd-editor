"""Loopback-only Host/Origin guard for /api (DNS rebinding, cross-site)."""

import json

from gr_pcd.settings import Settings

HOST_MESSAGE = (
    "the app answers only on localhost, 127.0.0.1 or [::1] on its "
    "configured port"
)
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


class LocalOriginGuard:
    def __init__(self, app, settings: Settings) -> None:
        self.app = app
        port = settings.public_port
        self.hosts = {
            f"{h}:{port}" for h in ("localhost", "127.0.0.1", "[::1]")
        }

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        guarded = scope["type"] in ("http", "websocket") and (
            path == "/api" or path.startswith("/api/")
        )
        if not guarded:
            await self.app(scope, receive, send)
            return
        headers = {
            k.decode("latin-1").lower(): v.decode("latin-1")
            for k, v in scope["headers"]
        }
        problem = self._problem(scope.get("method", "GET"), headers)
        if problem is None:
            await self.app(scope, receive, send)
            return
        code, message = problem
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        body = json.dumps(
            {"error": {"code": code, "message": message}}
        ).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    def _problem(self, method: str, headers: dict):
        if headers.get("host", "").lower() not in self.hosts:
            return ("forbidden_host", HOST_MESSAGE)
        origin = headers.get("origin")
        if origin is not None:
            if origin.lower() not in {f"http://{h}" for h in self.hosts}:
                return ("forbidden_origin", "cross-origin requests are refused")
            return None
        if method in UNSAFE and headers.get("sec-fetch-site") in (
            "cross-site",
            "same-site",
        ):
            return ("forbidden_origin", "cross-site requests are refused")
        return None
