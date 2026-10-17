"""Export the edited cloud as a new PCD file."""

import hashlib
from pathlib import Path

from gr_pcd.files.names import safe_filename
from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.writer import verify_written, write_pcd_file


def cleaned_filename(display_name: str) -> str:
    return safe_filename(f"{Path(display_name).stem}_cleaned.pcd")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(8 << 20):
            h.update(chunk)
    return h.hexdigest()


def export_session(
    session, dest: Path, fmt: str, scope: str, token, overwrite=False
) -> dict:
    dest = Path(dest)
    for src in (session.source_path, session.original_path):
        if dest.resolve() == Path(src).resolve():
            raise PcdError(
                "would_overwrite_source", "refusing to overwrite the source"
            )
    mask = session.export_mask(scope)
    count = write_pcd_file(
        dest,
        session.cloud,
        mask,
        fmt,
        overwrite=overwrite,
        source_path=session.source_path,
        token=token,
    )
    try:
        verify_written(dest, count, session.cloud.schema)
    except PcdError:
        dest.unlink(missing_ok=True)
        raise
    return {
        "filename": cleaned_filename(session.filename),
        "count": count,
        "invalid_retained": int((mask & ~session.valid).sum()),
        "bytes": dest.stat().st_size,
        "sha256": sha256_file(dest),
        "format": fmt,
        "scope": scope,
    }
