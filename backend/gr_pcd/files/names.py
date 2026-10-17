"""One place that turns client-supplied names into safe file names."""

import re
from pathlib import PurePosixPath

MAX_NAME = 200
_BAD = re.compile(r'[\x00-\x1f\x7f"\\/:*?<>|]+')


def safe_filename(name: str) -> str:
    """Basename only, no control or shell/header-hostile characters."""
    base = re.split(r"[\\/]", name)[-1]
    base = _BAD.sub("_", base).strip(" .")
    if not base.strip("_"):
        return "upload"
    if len(base) > MAX_NAME:
        suffix = PurePosixPath(base).suffix
        suffix = suffix if len(suffix) <= 16 else ""
        base = base[: MAX_NAME - len(suffix)] + suffix
    return base
