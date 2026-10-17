"""Remove temporary uploads, downloads and orphaned session dirs."""

import shutil
import time
from pathlib import Path

STALE_SECONDS = 600
SUBDIRS = ("uploads", "exports", "session-archives", "sessions")


def _remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path, ignore_errors=True)
    else:
        path.unlink(missing_ok=True)


def _age(path: Path, now: float) -> float:
    try:
        return now - path.stat().st_mtime
    except OSError:
        return 0.0


def sweep_startup(settings) -> None:
    """A restart has no live session: empty every temporary area."""
    for sub in SUBDIRS:
        d = settings.work_root / sub
        if not d.is_dir():
            continue
        for child in d.iterdir():
            _remove(child)


def sweep_runtime(manager, now: float | None = None) -> None:
    """Cheap sweep; never touches the live session's own directory."""
    now = time.time() if now is None else now
    work = manager.settings.work_root
    uploads = work / "uploads"
    if uploads.is_dir():
        active = manager.uploads.active_ids()
        for child in uploads.iterdir():
            if (
                child.name.split(".")[0] not in active
                and _age(child, now) > STALE_SECONDS
            ):
                _remove(child)
    ttl = manager.settings.download_ttl_seconds
    for key, d in list(manager.downloads.items()):
        if not d.path.exists() or _age(d.path, now) > ttl:
            manager.downloads.pop(key, None)
            d.path.unlink(missing_ok=True)
    sessions = work / "sessions"
    if sessions.is_dir():
        session = manager.session
        live = None if session is None else session.source_path.parent
        for child in sessions.iterdir():
            # a young dir may be a session still being opened
            if child != live and _age(child, now) > STALE_SECONDS:
                _remove(child)
