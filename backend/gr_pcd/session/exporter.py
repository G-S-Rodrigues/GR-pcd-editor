"""Export the edited cloud as a new PCD file."""

import hashlib
import re
import uuid
from pathlib import Path

from gr_pcd.editing.errors import EditError
from gr_pcd.files.names import safe_filename
from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.writer import verify_written, write_pcd_file
from gr_pcd.session.budget import ensure_free_space


def cleaned_filename(display_name: str) -> str:
    return safe_filename(f"{Path(display_name).stem}_cleaned.pcd")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(8 << 20):
            h.update(chunk)
    return h.hexdigest()


def export_session(
    session,
    dest: Path,
    fmt: str,
    scope: str,
    token,
    overwrite=False,
    layers=None,
) -> dict:
    dest = Path(dest)
    for src in (session.source_path, session.original_path):
        if dest.resolve() == Path(src).resolve():
            raise PcdError(
                "would_overwrite_source", "refusing to overwrite the source"
            )
    mask = session.export_mask(scope, layers)
    # upper bound: the whole record array (binary); compressed is smaller
    ensure_free_space(dest.parent, session.cloud.records.nbytes)
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


def layer_filenames(display_name: str, plan: list) -> list[str]:
    """`<stem>_<layer>_cleaned.pcd` for every (id, name) of the plan. A name
    that sanitises like an earlier one (or a user layer called "main") gets
    `_<id>` appended."""
    stem = Path(display_name).stem
    seen: set[str] = set()
    out = []
    for layer_id, name in plan:
        part = re.sub(r"[\\/]", "_", name)
        fname = safe_filename(f"{stem}_{part}_cleaned.pcd")
        if fname.lower() in seen:
            fname = safe_filename(f"{stem}_{part}_{layer_id}_cleaned.pcd")
        seen.add(fname.lower())
        out.append(fname)
    return out


def export_per_layer(
    session,
    dest_dir: Path,
    fmt: str,
    scope: str,
    token,
    layers=None,
) -> dict:
    """One PCD per layer from one snapshot. Layers with no point in the scope
    are skipped and listed. Any failure or cancel removes every file of this
    job."""
    dest_dir = Path(dest_dir)
    plan, mask_of = session.export_layer_plan(scope, layers)
    names = layer_filenames(session.filename, plan)
    # the layers partition the scope, so one full export bounds the total
    ensure_free_space(dest_dir, session.cloud.records.nbytes)
    files: list[dict] = []
    skipped: list[dict] = []
    try:
        for (layer_id, layer_name), fname in zip(plan, names, strict=True):
            mask = mask_of(layer_id)
            if not mask.any():
                skipped.append({"layer_id": layer_id, "layer_name": layer_name})
                continue
            export_id = uuid.uuid4().hex
            dest = dest_dir / f"{export_id}.pcd"
            files.append({"export_id": export_id, "path": dest})
            count = write_pcd_file(
                dest,
                session.cloud,
                mask,
                fmt,
                source_path=session.source_path,
                token=token,
            )
            try:
                verify_written(dest, count, session.cloud.schema)
            except PcdError:
                dest.unlink(missing_ok=True)
                raise
            files[-1].update(
                {
                    "filename": fname,
                    "layer_id": layer_id,
                    "layer_name": layer_name,
                    "count": count,
                    "invalid_retained": int((mask & ~session.valid).sum()),
                    "bytes": dest.stat().st_size,
                    "sha256": sha256_file(dest),
                }
            )
        if not files:
            raise EditError(
                "nothing_to_export", "no layer has a point to export"
            )
    except BaseException:
        for f in files:
            f["path"].unlink(missing_ok=True)
        raise
    return {
        "files": files,
        "skipped": skipped,
        "count": sum(f["count"] for f in files),
        "format": fmt,
        "scope": scope,
    }
