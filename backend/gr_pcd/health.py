import os
import tempfile

from gr_pcd.settings import Settings


def _work_writable(settings: Settings) -> bool:
    try:
        with tempfile.NamedTemporaryFile(dir=settings.work_root):
            return True
    except OSError:
        return False


def readiness_problems(settings: Settings) -> list[str]:
    problems: list[str] = []
    data = settings.data_root
    if not (data.is_dir() and os.access(data, os.R_OK | os.X_OK)):
        problems.append(f"data folder {data} is missing or not readable")
    if not _work_writable(settings):
        problems.append(f"work folder {settings.work_root} is not writable")
    if not (settings.static_dir / "index.html").is_file():
        problems.append(f"static index.html missing in {settings.static_dir}")
    return problems
