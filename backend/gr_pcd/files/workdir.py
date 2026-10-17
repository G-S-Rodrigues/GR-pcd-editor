"""Work-volume directories that survive a volume left by another uid.

The launcher runs the container as the host uid, but a named volume keeps the
owner and mode of the sub folders an earlier run (another uid or build) made.
`/work` itself is 1777, so when a sub folder is not usable we use a sibling
`<sub>.u<uid>` instead of failing the upload.
"""

import os
from pathlib import Path

OPEN_MODE = 0o1777
STOP_HINT = "./gr-pcd-visualizer.sh --stop"
FIX_HINT = (
    f"Fix: run {STOP_HINT}, then 'docker volume rm gr-pcd-visualizer_work' "
    "(it only holds temporary files), then ./gr-pcd-visualizer.sh --rebuild"
)


class WorkVolumeError(Exception):
    code = "work_volume_not_writable"
    status = 500

    def __init__(self, path: Path) -> None:
        self.message = (
            f"The app (uid {os.getuid()}) cannot write to {path}, so the file "
            f"cannot be opened. {FIX_HINT}."
        )
        super().__init__(self.message)


def _usable(path: Path) -> bool:
    return path.is_dir() and os.access(path, os.W_OK | os.X_OK)


def _make(path: Path) -> None:
    path.mkdir(exist_ok=True)
    try:
        path.chmod(OPEN_MODE)  # stay usable for a later uid
    except OSError:
        pass


def ensure_dir(work_root: Path, sub: str, *rest: str) -> Path:
    """`<work>/<sub>/<rest...>`, created; falls back to `<sub>.u<uid>`."""
    work_root = Path(work_root)
    if not os.access(work_root, os.W_OK | os.X_OK):
        raise WorkVolumeError(work_root)
    base = work_root / sub
    if not base.exists():
        try:
            _make(base)
        except PermissionError:
            raise WorkVolumeError(work_root) from None
    if not _usable(base):
        base = work_root / f"{sub}.u{os.getuid()}"
        try:
            _make(base)
        except OSError:
            raise WorkVolumeError(base) from None
        if not _usable(base):
            raise WorkVolumeError(base)
    out = base.joinpath(*rest)
    out.mkdir(parents=True, exist_ok=True)
    return out


def sub_dirs(work_root: Path, sub: str) -> list[Path]:
    """Existing `<sub>` and its per-uid fallbacks."""
    work_root = Path(work_root)
    found = [work_root / sub] if (work_root / sub).is_dir() else []
    if work_root.is_dir():
        found += sorted(p for p in work_root.glob(f"{sub}.u*") if p.is_dir())
    return found
