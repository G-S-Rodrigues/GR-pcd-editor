"""List the read-only mounted data folder (relative paths only)."""

import os
from pathlib import Path

from gr_pcd.paths import PathEscapeError, resolve_data_path
from gr_pcd.session.errors import NotFoundError

MAX_ENTRIES = 5000
_KINDS = {".pcd": "pcd", ".pcdsession": "session"}


def list_mounted(root: Path, rel: str) -> dict:
    directory = resolve_data_path(root, rel)
    if not directory.is_dir():
        raise NotFoundError(f"no such folder: {rel or '/'}")
    dirs: list[dict] = []
    files: list[dict] = []
    count = 0
    truncated = False
    for name in sorted(os.listdir(directory), key=lambda n: (n.lower(), n)):
        child = f"{rel}/{name}" if rel else name
        try:
            target = resolve_data_path(root, child)
            if target.is_dir():
                entry = {"name": name, "type": "dir", "kind": None, "size": 0}
                bucket = dirs
            elif target.is_file():
                kind = _KINDS.get(Path(name).suffix.lower())
                if kind is None:
                    continue
                entry = {
                    "name": name,
                    "type": "file",
                    "kind": kind,
                    "size": target.stat().st_size,
                }
                bucket = files
            else:
                continue
        except (PathEscapeError, OSError):
            continue  # escaping, broken or unreadable links are not listed
        if count >= MAX_ENTRIES:
            truncated = True
            break
        bucket.append(entry)
        count += 1
    return {"path": rel, "entries": dirs + files, "truncated": truncated}
