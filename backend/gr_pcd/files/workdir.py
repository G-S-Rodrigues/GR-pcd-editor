"""Work-volume directories that survive a volume left by another uid.

The launcher runs the container as the host uid, but a named volume keeps the
owner and mode of the sub folders an earlier run (another uid or build) made.
`/work` itself is 1777, so when a sub folder is not usable we use a sibling
`<sub>.u<uid>` instead of failing the upload.

`/work` is shared, so another uid can plant entries in it. A base folder is
therefore only used when `lstat` says it is a real directory (never a symlink,
dangling or not) owned by this uid; anything else is skipped and the per-uid
sibling is tried. The mode is set through a descriptor opened with O_NOFOLLOW,
and only on a folder this call just created.
"""

import os
import re
import stat
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


def _lstat(path: Path) -> os.stat_result | None:
    try:
        return os.lstat(path)
    except OSError:
        return None


def _usable(path: Path) -> bool:
    """A real directory (not a symlink) owned by this uid that we can use."""
    st = _lstat(path)
    return (
        st is not None
        and stat.S_ISDIR(st.st_mode)
        and st.st_uid == os.getuid()
        and os.access(path, os.W_OK | os.X_OK)
    )


def _make(path: Path) -> None:
    """mkdir, then open it without following links and chmod the descriptor."""
    os.mkdir(path)
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fchmod(fd, OPEN_MODE)  # stay usable for a later uid
    except OSError:
        pass
    finally:
        os.close(fd)


def _base_ok(path: Path) -> bool:
    """Create `path` if missing and report whether it is a usable base."""
    if _lstat(path) is None:
        try:
            _make(path)
        except OSError:
            pass  # FileExistsError (a planted entry) or a permission error: judged below
    return _usable(path)


def ensure_dir(work_root: Path, sub: str, *rest: str) -> Path:
    """`<work>/<sub>/<rest...>`, created; falls back to `<sub>.u<uid>`."""
    work_root = Path(work_root)
    if not os.access(work_root, os.W_OK | os.X_OK):
        raise WorkVolumeError(work_root)
    base = work_root / sub
    if not _base_ok(base):
        base = work_root / f"{sub}.u{os.getuid()}"
        if not _base_ok(base):
            raise WorkVolumeError(base)
    out = base.joinpath(*rest)
    out.mkdir(parents=True, exist_ok=True)
    return out


def _real_dir(path: Path) -> bool:
    st = _lstat(path)
    return st is not None and stat.S_ISDIR(st.st_mode)


def sub_dirs(work_root: Path, sub: str) -> list[Path]:
    """Existing `<sub>` and its per-uid fallbacks, never a symlink."""
    work_root = Path(work_root)
    found = [work_root / sub] if _real_dir(work_root / sub) else []
    if work_root.is_dir():
        fallback = re.compile(re.escape(sub) + r"\.u[0-9]+")
        found += sorted(
            p
            for p in work_root.iterdir()
            if fallback.fullmatch(p.name) and _real_dir(p)
        )
    return found
