"""Session archive: a zip with the embedded source, selection and history.

Layout (exactly these names): manifest.json, source.pcd, selection.bin
(uint32 LE ids), history/<n>.bin (uint32 LE ids), and for a layer step
(version 3) history/<n>.layer.bin (uint8 from values, then uint8 to values,
one per id). Loading validates every
entry name, declared size and the source hash before any state is built,
and extracts only source.pcd, into the caller's destination.
"""

import hashlib
import json
import math
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
from gr_pcd.editing.history import (
    MAX_SID,
    MAX_STEPS,
    TOOLS,
    HistoryEntry,
    LayerRowChange,
    clean_name,
)
from gr_pcd.editing.layers import MAX_LAYERS, Layer, clean_layer_name
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
    MAX_SHAPE_VERTICES,
    filter_from_dict,
    filter_to_dict,
    protection_from_dict,
    protection_to_dict,
)

FORMAT = "gr-pcd-session"
VERSION = 1
LAYER_VERSION = 2  # written only when the session has layers
LAYER_STEP_VERSION = 3  # written only when the history holds a layer step
ACCEPTED_VERSIONS = (VERSION, LAYER_VERSION, LAYER_STEP_VERSION)
MAX_ENTRIES = 100_000
MAX_MANIFEST = 16 * 1024 * 1024
MAX_CLIENT_STATE = 1024 * 1024
_OLD_TOOL = re.compile(r"\((box|polygon|prism|cluster|filter|selection)\)\s*$")
_NAME = re.compile(
    r"(manifest\.json|source\.pcd|selection\.bin|layers\.bin|history/(0|[1-9][0-9]*)\.(layer\.)?bin)"
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
    layer: np.ndarray | None = None
    layers: list | None = None


# ---- writing -----------------------------------------------------------
def _ids_bytes(ids: np.ndarray) -> bytes:
    return np.asarray(ids, dtype="<u4").tobytes()


def _layer_entry_keys(i: int, e: HistoryEntry) -> dict:
    return {
        "layer_file": f"history/{i}.layer.bin",
        "rows": [
            {
                "index": r.index,
                "created": r.created,
                "item": _layer_item(r.layer),
            }
            for r in e.rows
        ],
    }


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
        layer, layers = session.layer, list(session.layers)
    cloud = session.cloud
    has_layers = bool(layers) and layer is not None
    has_layer_steps = any(e.kind == "layer" for e in entries)
    layer_bytes = (
        np.asarray(layer, dtype=np.uint8).tobytes() if has_layers else b""
    )
    sel_ids = np.flatnonzero(selection & active & session.valid)
    manifest = {
        "format": FORMAT,
        "version": (
            LAYER_STEP_VERSION
            if has_layer_steps
            else LAYER_VERSION
            if has_layers
            else VERSION
        ),
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
                    # additive and optional: older builds ignore the key
                    **({} if e.shape is None else {"shape": e.shape}),
                    **(_layer_entry_keys(i, e) if e.kind == "layer" else {}),
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
    if has_layers:
        manifest["layers"] = {
            "file": "layers.bin",
            "sha256": hashlib.sha256(layer_bytes).hexdigest(),
            "items": [_layer_item(x) for x in layers],
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
                if has_layers:
                    zf.writestr("layers.bin", layer_bytes)
                for i, e in enumerate(entries):
                    token.check()
                    zf.writestr(f"history/{i}.bin", _ids_bytes(e.ids))
                    if e.kind == "layer":
                        zf.writestr(
                            f"history/{i}.layer.bin",
                            np.asarray(e.frm, dtype=np.uint8).tobytes()
                            + np.asarray(e.to, dtype=np.uint8).tobytes(),
                        )
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


def _fin(v) -> bool:
    return type(v) in (int, float) and math.isfinite(v)


def _vec(v, n: int) -> bool:
    return isinstance(v, list) and len(v) == n and all(_fin(x) for x in v)


def _valid_shape(sh, nested: bool = False) -> None:
    """A stored step shape: plain JSON, finite numbers, bounded size. Raises bad_archive."""
    if not isinstance(sh, dict):
        raise _bad("invalid step shape")
    kind = sh.get("type")
    mode_ok = sh.get("mode") in ("inside", "outside")
    if kind == "box":
        ok = (
            mode_ok
            and _vec(sh.get("center"), 3)
            and _vec(sh.get("dimensions"), 3)
            and _vec(sh.get("rpy_deg"), 3)
        )
    elif kind == "prism":
        poly = sh.get("polygon")
        ok = (
            mode_ok
            and isinstance(poly, list)
            and 3 <= len(poly) <= MAX_SHAPE_VERTICES
            and all(_vec(v, 2) for v in poly)
            and _fin(sh.get("z_min"))
            and _fin(sh.get("z_max"))
        )
    elif kind in ("cluster", "sparse", "plane", "thin") and not nested:
        if kind == "plane":
            n = sh.get("normal")
            own = (
                _vec(n, 3)
                and abs(sum(c * c for c in n) - 1.0) <= 2e-6
                and _fin(sh.get("d"))
                and _fin(sh.get("thickness"))
                and sh["thickness"] > 0
            )
        elif kind == "thin":
            own = (
                sh.get("method") in ("duplicates", "voxel")
                and _fin(sh.get("distance"))
                and sh["distance"] >= 0
                and _fin(sh.get("edge"))
                and sh["edge"] > 0
            )
        elif kind == "cluster":
            mp = sh.get("max_points")
            own = (
                type(sh.get("seed_id")) is int
                and _fin(sh.get("radius"))
                and (mp is None or type(mp) is int)
            )
        else:
            own = (sh.get("radius") is None or _fin(sh.get("radius"))) and (
                type(sh.get("min_neighbours")) is int
                and sh["min_neighbours"] >= 1
            )
        ok = own and type(sh.get("exclude_protected")) is bool
        if ok and sh.get("region") is not None:
            r = sh["region"]
            if not isinstance(r, dict) or r.get("type") not in ("box", "prism"):
                ok = False
            else:
                _valid_shape(r, True)
    else:
        ok = False
    if not ok:
        raise _bad("invalid step shape")


@dataclass
class _Steps:
    fields: list[tuple[int, str, str | None, dict | None]]
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
            out.append((i, tool, None, None))
        nxt = hist.get("next_sid", 0)
        nxt = nxt if type(nxt) is int and 0 <= nxt < MAX_SID else 0
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
        shape = e.get("shape")
        if shape is not None:
            _valid_shape(shape)
        out.append((sid, tool, name, shape))
    nxt = hist.get("next_sid", 0)
    if type(nxt) is not int or not 0 <= nxt < MAX_SID:
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
        if manifest.get("version") not in ACCEPTED_VERSIONS:
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
        if len(hist_entries) > MAX_STEPS:
            raise _bad(f"history is limited to {MAX_STEPS} steps")
        cursor = int(hist["cursor"])
        sel = manifest["selection"]
        client_state = manifest.get("client_state", {})
        unit = str(manifest.get("unit", "m"))
        filt = filter_from_dict(manifest["display_filter"])
        protection = protection_from_dict(manifest["protection"])
        validate_filter(filt)
        validate_protection(protection)
        version = manifest["version"]
        lay_meta = _layer_manifest(manifest, version, by_name)
        layer_rows = _layer_steps_meta(hist_entries, version)
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
    expected_layer_files = {f"history/{i}.layer.bin" for i in layer_rows}
    if (
        files != expected_files
        or {n for n in by_name if n.startswith("history/")}
        != set(expected_files) | expected_layer_files
    ):
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
    layer_arr, layer_list = _read_layers(zf, by_name, lay_meta, cloud.n)
    entries: list[HistoryEntry] = []
    scratch = np.ones(cloud.n, dtype=bool)
    at_cursor = scratch.copy()
    for i, (fname, kind, description) in enumerate(metas):
        sid, tool, name, shape = steps.fields[i]
        if i == cursor:
            at_cursor = scratch.copy()
        ids = _read_ids(zf, by_name[fname], cloud.n)
        if i in layer_rows:
            frm, to = _read_diff(
                zf, by_name[f"history/{i}.layer.bin"], len(ids)
            )
            entries.append(
                HistoryEntry(
                    kind,
                    description,
                    ids,
                    sid,
                    tool,
                    name,
                    shape,
                    frm,
                    to,
                    layer_rows[i],
                )
            )
            continue
        if not scratch[ids].all():
            raise _bad(f"history entry {i} deletes a point twice")
        scratch[ids] = False
        entries.append(
            HistoryEntry(kind, description, ids, sid, tool, name, shape)
        )
    _check_layer_replay(entries, cursor, layer_arr, layer_list, cloud.n)
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
        layer=layer_arr,
        layers=layer_list,
    )


def _layer_item(x: Layer) -> dict:
    item = {
        "id": x.id,
        "name": x.name,
        "colour": x.colour,
        "visible": x.visible,
    }
    # optional keys, written only when true: a version 2 file stays valid
    if x.protected:
        item["protected"] = True
    if x.locked:
        item["locked"] = True
    return item


def _layer_manifest(manifest: dict, version: int, by_name: dict):
    """The validated `layers` block, or None for a layer-less (v1) archive."""
    has_key = "layers" in manifest
    has_file = "layers.bin" in by_name
    if version == VERSION:
        if has_key or has_file:
            raise _bad("a version 1 archive cannot carry layers")
        return None
    if not has_key and not has_file:
        if version == LAYER_STEP_VERSION:
            # every layer was removed by a later step; the steps stay undoable
            return None
        # no layers at all: not a file this build writes (SES-25 pins this)
        raise _bad(
            f"unsupported session version {version}",
            "unsupported_session_version",
        )
    if not (has_key and has_file):
        raise _bad(f"a version {version} archive needs its layers")
    block = manifest["layers"]
    if not isinstance(block, dict) or block.get("file") != "layers.bin":
        raise _bad("invalid layers block")
    sha, items = block.get("sha256"), block.get("items")
    if not isinstance(sha, str) or not isinstance(items, list):
        raise _bad("invalid layers block")
    if not 1 <= len(items) <= MAX_LAYERS:
        raise _bad("invalid layer count")
    out, seen = [], set()
    for it in items:
        lay = _parse_item(it)
        if lay.id in seen:
            raise _bad("invalid or duplicate layer id")
        seen.add(lay.id)
        out.append(lay)
    return sha, out


def _parse_item(it) -> Layer:
    """One validated layer item (the layers block and a step's rows)."""
    if not isinstance(it, dict):
        raise _bad("invalid layer")
    lid, name, colour, vis = (
        it.get("id"),
        it.get("name"),
        it.get("colour"),
        it.get("visible"),
    )
    if type(lid) is not int or not 1 <= lid <= 255:
        raise _bad("invalid or duplicate layer id")
    if type(colour) is not int or not 0 <= colour <= 15:
        raise _bad("invalid layer colour")
    if type(vis) is not bool:
        raise _bad("invalid layer visibility")
    try:
        if not isinstance(name, str) or clean_layer_name(name) != name:
            raise _bad("invalid layer name")
    except EditError:
        raise _bad("invalid layer name")
    prot, lock = it.get("protected", False), it.get("locked", False)
    if type(prot) is not bool or type(lock) is not bool:
        raise _bad("invalid layer flag")
    return Layer(lid, name, colour, vis, prot, lock)


def _layer_steps_meta(hist_entries: list, version: int) -> dict:
    """Layer steps of the manifest: {index: rows}. Kind layer holds exactly
    when tool is layer, and only in a version 3 file."""
    out: dict = {}
    for i, e in enumerate(hist_entries):
        is_layer = e.get("kind") == "layer"
        if is_layer != (e.get("tool") == "layer"):
            raise _bad("a layer step has kind and tool layer")
        if not is_layer:
            continue
        if version != LAYER_STEP_VERSION:
            raise _bad("a layer step needs a version 3 archive")
        if "sid" not in e:
            raise _bad("a layer step needs its step id")
        if e.get("layer_file") != f"history/{i}.layer.bin":
            raise _bad("invalid layer step file")
        raw = e.get("rows")
        if not isinstance(raw, list) or len(raw) > 2 * MAX_LAYERS:
            raise _bad("invalid layer step rows")
        rows = []
        for r in raw:
            if not isinstance(r, dict):
                raise _bad("invalid layer step row")
            index, created = r.get("index"), r.get("created")
            if type(index) is not int or not 0 <= index <= MAX_LAYERS:
                raise _bad("invalid layer step row index")
            if type(created) is not bool:
                raise _bad("invalid layer step row")
            rows.append(
                LayerRowChange(index, _parse_item(r.get("item")), created)
            )
        out[i] = tuple(rows)
    if version == LAYER_STEP_VERSION and not out:
        # no file this build writes (the SES-25 / LAY-33 precedent)
        raise _bad(
            f"unsupported session version {version}",
            "unsupported_session_version",
        )
    return out


def _read_diff(zf, info, count: int):
    if info.file_size != 2 * count:
        raise _bad(f"{info.filename}: bad length")
    raw = np.frombuffer(_read_all(zf, info, info.file_size), dtype=np.uint8)
    frm, to = raw[:count].copy(), raw[count:].copy()
    if (frm == to).any():
        raise _bad(f"{info.filename}: a point does not change layer")
    return frm, to


def _check_layer_replay(entries, cursor, layer_arr, layer_list, n: int) -> None:
    """Walk back over the applied layer steps from the stored state, then
    forward over every step: each must find what it recorded."""
    steps = [e for e in entries if e.kind == "layer"]
    if not steps:
        return
    n_applied = sum(1 for e in entries[:cursor] if e.kind == "layer")
    cur = np.zeros(n, dtype=np.uint8) if layer_arr is None else layer_arr.copy()
    rows = {x.id for x in (layer_list or [])}

    def check_ids(values, what: str) -> None:
        bad = set(np.unique(values).tolist()) - rows - {0}
        if bad:
            raise _bad(f"{what} names a layer that does not exist")

    def flip(e, back: bool) -> None:
        want, put = (e.to, e.frm) if back else (e.frm, e.to)
        if not np.array_equal(cur[e.ids], want):
            raise _bad(f"layer step {e.sid} does not match the stored layers")
        cur[e.ids] = put
        for r in reversed(e.rows) if back else e.rows:
            present = r.layer.id in rows
            if (r.created == back) != present:
                raise _bad(f"layer step {e.sid} does not match the layer rows")
            if (r.created and not back) or (not r.created and back):
                rows.add(r.layer.id)
            else:
                rows.discard(r.layer.id)
            if len(rows) > MAX_LAYERS:
                raise _bad("too many layers")
        check_ids(put, f"layer step {e.sid}")

    for e in reversed(steps[:n_applied]):
        flip(e, True)
    if n:
        check_ids(np.unique(cur), "the layers before the first step")
    for e in steps:
        flip(e, False)


def _read_layers(zf, by_name, meta, n: int):
    if meta is None:
        return None, None
    sha, items = meta
    info = by_name["layers.bin"]
    if info.file_size != n:
        raise _bad("layers.bin: bad length")
    raw = _read_all(zf, info, n)
    if hashlib.sha256(raw).hexdigest() != sha:
        raise _bad("layers.bin does not match its recorded hash")
    arr = np.frombuffer(raw, dtype=np.uint8).copy()
    known = np.zeros(256, dtype=bool)
    known[0] = True
    for lay in items:
        known[lay.id] = True
    if n and not known[arr].all():
        raise _bad("layers.bin holds an undeclared layer id")
    arr.flags.writeable = False
    return arr, items
