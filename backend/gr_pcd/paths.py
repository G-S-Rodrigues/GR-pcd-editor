from pathlib import Path, PurePosixPath


class PathEscapeError(ValueError):
    """The requested path resolves outside the mounted folder."""


def resolve_data_path(root: Path, relative: str) -> Path:
    """Resolve `relative` under `root`, rejecting any escape."""
    if "\0" in relative or "\\" in relative:
        raise PathEscapeError("invalid characters in path")
    if PurePosixPath(relative).is_absolute() or Path(relative).is_absolute():
        raise PathEscapeError(f"absolute path not allowed: {relative}")
    resolved_root = root.resolve()
    candidate = (resolved_root / relative).resolve(strict=False)
    if not candidate.is_relative_to(resolved_root):
        raise PathEscapeError(f"path escapes the mounted folder: {relative}")
    return candidate
