"""Session archive: a zip with the embedded source, selection and history.

Layout (exactly these names): manifest.json, source.pcd, selection.bin
(uint32 LE ids), history/<n>.bin (uint32 LE ids). Loading validates every
entry name, declared size and the source hash before any state is built,
and extracts only source.pcd, into the caller's destination.
"""

import hashlib
import json
import os
import re
import tempfile
import zipfile
import zlib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from gr_pcd.editing.errors import EditError
from gr_pcd.editing.history import TOOLS, HistoryEntry, clean_name
from gr_pcd.editing.protection import (
    ProtectionState,
    validate_protection,
)
from gr_pcd.files.names import safe_filename
from gr_pcd.geometry.errors import GeometryError
from gr_pcd.geometry.filters import DisplayFilter, validate_filter
from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.model import PcdCloud
from gr_pcd.pcd.reader import read_pcd
from gr_pcd.session.budget import ensure_free_space
from gr_pcd.session.codec import (
    filter_from_dict,
    filter_to_dict,
    protection_from_dict,
    protection_to_dict,
)

FORMAT = "gr-pcd-session"
VERSION = 1
MAX_ENTRIES = 100_000
MAX_MANIFEST = 16 * 1024 * 1024
MAX_CLIENT_STATE = 1024 * 1024
_OLD_TOOL = re.compile(r"\((box|polygon|prism|cluster|filter|selection)\)\s*$")
MAX_SID = 2**31
_NAME = re.compile(
    r"(manifest\.json|source\.pcd|selection\.bin|history/(0|[1-9][0-9]*)\.bin)"
)


class ArchiveError(PcdError):
    """The session archive is malformed, hostile or does not match."""


def _bad(message: str, code: str = "bad_archive") -> ArchiveError:
    return ArchiveError(code, message)


def archive_filename(display_name: str) -> str:
    return safe_filename(f"{Path(display_name).stem}_session_v1.pcdsession")


@dataclass
class LoadedArchive:
    cloud: PcdCloud
    filename: str
    active: np.ndarray
    entries: list[HistoryEntry]
    cursor: int
    selection: np.ndarray
    ops: list[dict]
    display_filter: DisplayFilter
    protection: ProtectionState
    unit: str
    client_state: dict
    next_sid: int = 0


# ---- writing -----------------------------------------------------------
def _ids_bytes(ids: np.ndarray) -> bytes:
    return np.asarray(ids, dtype="<u4").tobytes()


def save_archive(session, path: Path, token) -> dict:
    path = Path(path)
    with session.lock:
        active, selection = session.active, session.selection
        entries = list(session.history.entries)
        cursor = session.history.cursor
        next_sid = session.history.next_sid
        ops = list(session.selection_ops)
        filt, protection = session.display_filter, session.protection
        unit, client_state = session.unit, session.client_state
        edit_counter = session.edit_counter
    cloud = session.cloud
    sel_ids = np.flatnonzero(selection & active & session.valid)
    manifest = {
        "format": FORMAT,
        "version": VERSION,
        "source": {
            "filename": session.filename,
            "sha256": cloud.sha256,
            "size_bytes": cloud.file_bytes,
            "encoding": cloud.encoding,
            "schema": [
                {
                    "name": s.name,
                    "type": s.type,
                    "size": s.size,
                    "count": s.count,
                }
                for s in cloud.schema
            ],
            "points": cloud.n,
            "width": cloud.width,
            "height": cloud.height,
            "viewpoint": list(cloud.viewpoint),
            "version": cloud.version,
        },
        "history": {
            "entries": [
                {
                    "kind": e.kind,
                    "description": e.description,
                    "count": len(e.ids),
                    "file": f"history/{i}.bin",
                    "sid": e.sid,
                    "tool": e.tool,
                    "name": e.name,
                }
                for i, e in enumerate(entries)
            ],
            "cursor": cursor,
            "next_sid": next_sid,
        },
        "selection": {
            "ids_file": "selection.bin",
            "count": len(sel_ids),
            "ops": ops,
        },
        "display_filter": filter_to_dict(filt),
        "protection": protection_to_dict(protection),
        "unit": unit,
        "client_state": client_state,
        "created_utc": datetime.now(UTC).isoformat(),
    }
    fd, tmp_name = tempfile.mkstemp(
        dir=path.parent, prefix=".archive-", suffix=".part"
    )
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as fh:
            with zipfile.ZipFile(fh, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("manifest.json", json.dumps(manifest))
                token.check()
                info = zipfile.ZipInfo("source.pcd")
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = 0o600 << 16
                with (
                    session.source_path.open("rb") as src,
                    zf.open(info, "w", force_zip64=True) as dst,
                ):
                    while chunk := src.read(8 << 20):
                        token.check()
                        dst.write(chunk)
                zf.writestr("selection.bin", _ids_bytes(sel_ids))
                for i, e in enumerate(entries):
                    token.check()
                    zf.writestr(f"history/{i}.bin", _ids_bytes(e.ids))
            fh.flush()
            os.fsync(fh.fileno())
        token.check()
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(8 << 20):
            h.update(chunk)
    return {
        "filename": archive_filename(session.filename),
        "bytes": path.stat().st_size,
        "sha256": h.hexdigest(),
        "edit_counter": edit_counter,
    }


# ---- reading -----------------------------------------------------------
def _stream(zf: zipfile.ZipFile, info: zipfile.ZipInfo, cap: int, sink) -> None:
    total = 0
    with zf.open(info) as src:
        while True:
            chunk = src.read(min(1 << 20, cap - total + 1))
            if not chunk:
                return
            total += len(chunk)
            if total > cap:
                raise _bad(f"{info.filename} exceeds its declared size")
            sink(chunk)


def _read_all(zf, info, cap) -> bytes:
    parts: list[bytes] = []
    _stream(zf, info, cap, parts.append)
    return b"".join(parts)


def _validate_entries(zf: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    infos = zf.infolist()
    if len(infos) > MAX_ENTRIES:
        raise _bad("too many entries")
    by_name: dict[str, zipfile.ZipInfo] = {}
    for info in infos:
        name = info.filename
        if not _NAME.fullmatch(name):
            raise _bad(f"unexpected entry name: {name!r}")
        if name in by_name:
            raise _bad(f"duplicate entry: {name}")
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            raise _bad(f"symlink entry: {name}")
        if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise _bad(f"unsupported compression for {name}")
        by_name[name] = info
    for required in ("manifest.json", "source.pcd", "selection.bin"):
        if required not in by_name:
            raise _bad(f"missing entry: {required}")
    return by_name


def _read_ids(zf, info, n: int) -> np.ndarray:
    if info.file_size > 4 * n or info.file_size % 4:
        raise _bad(f"{info.filename}: bad length")
    raw = _read_all(zf, info, info.file_size)
    ids = np.frombuffer(raw, dtype="<u4").astype(np.uint32)
    if len(ids) and int(ids.max()) >= n:
        raise _bad(f"{info.filename}: id out of range")
    if len(ids) > 1 and not (ids[1:] > ids[:-1]).all():
        raise _bad(f"{info.filename}: ids not sorted and unique")
    return ids


def load_archive(
    path: Path, dest_source: Path, budget: int, max_source_bytes: int
) -> LoadedArchive:
    try:
        return _load(Path(path), Path(dest_source), budget, max_source_bytes)
    except BaseException:
        Path(dest_source).unlink(missing_ok=True)
        raise


@dataclass
class _Steps:
    fields: list[tuple[int, str, str | None]]
    next_sid: int


def _step_fields(hist: dict, entries: list, metas: list) -> _Steps:
    """sid/tool/name per entry. An archive written before the timeline has
    none of them: rebuild the strip from the history it already holds."""
    has = [("sid" in e) for e in entries]
    if not any(has):
        out = []
        for i, (_, kind, description) in enumerate(metas):
            if kind == "remove_invalid":
                tool = "invalid"
            else:
                m = _OLD_TOOL.search(description)
                tool = m.group(1) if m else "selection"
                tool = "polygon" if tool == "prism" else tool
            out.append((i, tool, None))
        nxt = hist.get("next_sid", 0)
        nxt = nxt if type(nxt) is int and nxt >= 0 else 0
        return _Steps(out, max(nxt, len(out)))
    if not all(has):
        raise _bad("history entries mix old and new step fields")
    out, seen = [], set()
    for e in entries:
        sid, tool, name = e["sid"], e.get("tool"), e.get("name")
        if type(sid) is not int or not 0 <= sid < MAX_SID or sid in seen:
            raise _bad("invalid or duplicate step id")
        seen.add(sid)
        if tool not in TOOLS:
            raise _bad("invalid step tool")
        if name is not None:
            if not isinstance(name, str):
                raise _bad("invalid step name")
            try:
                if clean_name(name) != name:
                    raise _bad("invalid step name")
            except EditError:
                raise _bad("invalid step name")
        out.append((sid, tool, name))
    nxt = hist.get("next_sid", 0)
    if type(nxt) is not int:
        raise _bad("invalid next_sid")
    return _Steps(out, max(nxt, max(seen, default=-1) + 1))


def _load(path, dest_source, budget, max_source_bytes) -> LoadedArchive:
    try:
        zf = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise _bad(f"not a readable zip archive: {exc}")
    with zf:
        try:
            return _load_open(zf, dest_source, budget, max_source_bytes)
        except (
            zipfile.BadZipFile,
            zlib.error,
            EOFError,
            RuntimeError,
            NotImplementedError,
        ) as exc:
            raise _bad(f"corrupt archive: {exc}")


def _load_open(zf, dest_source, budget, max_source_bytes) -> LoadedArchive:
    by_name = _validate_entries(zf)
    minfo = by_name["manifest.json"]
    if minfo.file_size > MAX_MANIFEST:
        raise _bad("manifest is too large")
    try:
        manifest = json.loads(_read_all(zf, minfo, minfo.file_size))
        if manifest.get("format") != FORMAT:
            raise _bad("not a gr-pcd session archive")
        if manifest.get("version") != VERSION:
            raise _bad(
                f"unsupported session version {manifest.get('version')}",
                "unsupported_session_version",
            )
        src = manifest["source"]
        expect_sha = src["sha256"]
        hist = manifest["history"]
        if not isinstance(hist["entries"], list):
            raise _bad("history entries must be a list")
        hist_entries = hist["entries"]
        cursor = int(hist["cursor"])
        sel = manifest["selection"]
        client_state = manifest.get("client_state", {})
        unit = str(manifest.get("unit", "m"))
        filt = filter_from_dict(manifest["display_filter"])
        protection = protection_from_dict(manifest["protection"])
        validate_filter(filt)
        validate_protection(protection)
        ops = list(sel.get("ops", []))
        points = int(src["points"])
        filename = str(src["filename"])
        if not isinstance(client_state, dict):
            raise _bad("client_state must be an object")
        if len(json.dumps(client_state)) > MAX_CLIENT_STATE:
            raise _bad("client_state is too large")
        metas = [
            (str(e["file"]), str(e["kind"]), str(e["description"]))
            for e in hist_entries
        ]
        files = [m[0] for m in metas]
        steps = _step_fields(hist, hist_entries, metas)
    except ArchiveError:
        raise
    except GeometryError as exc:
        raise _bad(f"invalid manifest: {exc.message}")
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise _bad(f"invalid manifest: {exc}")
    if not (0 <= cursor <= len(hist_entries)) or not (0 <= points < 2**32):
        raise _bad("invalid manifest values")
    expected_files = [f"history/{i}.bin" for i in range(len(hist_entries))]
    if files != expected_files or {
        n for n in by_name if n.startswith("history/")
    } != set(expected_files):
        raise _bad("history entries do not match the manifest")

    sinfo = by_name["source.pcd"]
    if sinfo.file_size > max_source_bytes:
        raise _bad("source.pcd is larger than the allowed maximum")
    ensure_free_space(dest_source.parent, sinfo.file_size)
    digest = hashlib.sha256()
    with dest_source.open("wb") as out:

        def sink(chunk: bytes) -> None:
            digest.update(chunk)
            out.write(chunk)

        _stream(zf, sinfo, sinfo.file_size, sink)
    if digest.hexdigest() != expect_sha:
        raise _bad(
            "source.pcd does not match its recorded hash",
            "source_hash_mismatch",
        )
    cloud = read_pcd(dest_source, budget=budget)
    schema = [
        {"name": s.name, "type": s.type, "size": s.size, "count": s.count}
        for s in cloud.schema
    ]
    try:
        same = (
            cloud.n == points
            and schema == src["schema"]
            and cloud.width == src["width"]
            and cloud.height == src["height"]
            and list(cloud.viewpoint) == list(src["viewpoint"])
        )
    except (KeyError, TypeError):
        same = False
    if not same:
        raise _bad("source.pcd does not match the manifest", "schema_mismatch")

    selection_ids = _read_ids(zf, by_name["selection.bin"], cloud.n)
    entries: list[HistoryEntry] = []
    scratch = np.ones(cloud.n, dtype=bool)
    at_cursor = scratch.copy()
    for i, (fname, kind, description) in enumerate(metas):
        sid, tool, name = steps.fields[i]
        if i == cursor:
            at_cursor = scratch.copy()
        ids = _read_ids(zf, by_name[fname], cloud.n)
        if not scratch[ids].all():
            raise _bad(f"history entry {i} deletes a point twice")
        scratch[ids] = False
        entries.append(HistoryEntry(kind, description, ids, sid, tool, name))
    if cursor == len(hist_entries):
        at_cursor = scratch
    selection = np.zeros(cloud.n, dtype=bool)
    selection[selection_ids] = True
    active = at_cursor.copy()
    active.flags.writeable = False
    selection.flags.writeable = False
    return LoadedArchive(
        cloud=cloud,
        filename=filename,
        active=active,
        entries=entries,
        cursor=cursor,
        selection=selection,
        ops=ops,
        display_filter=filt,
        protection=protection,
        unit=unit,
        client_state=client_state,
        next_sid=steps.next_sid,
    )
