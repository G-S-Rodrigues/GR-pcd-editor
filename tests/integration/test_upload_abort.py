"""FIL-25: a peer that closes mid-body leaves no file (real uvicorn)."""

import socket
import threading
import time

import uvicorn

from fixtures.sessions import make_settings
from gr_pcd.app import create_app


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_fil_25_disconnect_mid_upload_cleans_up(tmp_path) -> None:
    port = _free_port()
    settings = make_settings(tmp_path, public_port=port)
    app = create_app(settings)
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        end = time.time() + 10
        while not server.started:
            assert time.time() < end, "server did not start"
            time.sleep(0.02)
        uid = "ab" * 16
        sock = socket.create_connection(("127.0.0.1", port))
        sock.sendall(
            (
                f"POST /api/session/upload?upload_id={uid}&filename=x.pcd "
                f"HTTP/1.1\r\nHost: localhost:{port}\r\n"
                "Content-Type: application/octet-stream\r\n"
                f"Content-Length: {5 * 1024 * 1024}\r\n\r\n"
            ).encode()
            + b"x" * (1024 * 1024)
        )
        uploads = app.state.manager.uploads
        end = time.time() + 5
        while uploads.get(uid) is None or uploads.get(uid).received == 0:
            assert time.time() < end, "upload never started"
            time.sleep(0.02)
        sock.close()
        end = time.time() + 5
        while uploads.get(uid).status in ("receiving", "importing"):
            assert time.time() < end, uploads.get(uid)
            time.sleep(0.02)
        assert uploads.get(uid).status in ("cancelled", "failed")
        d = settings.work_root / "uploads"
        assert not d.exists() or list(d.iterdir()) == []
        assert app.state.manager.session is None
    finally:
        server.should_exit = True
        thread.join(timeout=10)
