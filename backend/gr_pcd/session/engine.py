"""EditingSession: one open cloud, its edits, selection and history."""

import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from gr_pcd.editing.cancel import Cancelled, CancelToken
from gr_pcd.editing.candidate import CandidateResult, candidate_deletion
from gr_pcd.editing.cluster import build_eligible, connected_component
from gr_pcd.editing.errors import EditError
from gr_pcd.editing.history import History, RevisionClock, with_ids
from gr_pcd.editing.invalid import remove_invalid
from gr_pcd.editing.protection import (
    OperationProtection,
    ProtectionState,
    effective_intervals,
    protected_mask,
    validate_protection,
)
from gr_pcd.editing.selection import (
    combine_selection,
    filter_operand,
    read_selection,
    scope_mask,
)
from gr_pcd.geometry.box import BoxSpec, box_contains
from gr_pcd.geometry.filters import (
    DisplayFilter,
    filter_contains,
    validate_filter,
)
from gr_pcd.geometry.prism import PrismSpec, prism_contains
from gr_pcd.pcd.model import PcdCloud, valid_mask, xyz64
from gr_pcd.session.budget import HISTORY_FRACTION
from gr_pcd.session.codec import (
    ClusterTool,
    FilterTool,
    filter_to_dict,
    protection_to_dict,
    tilt_to_dict,
    tool_summary,
)
from gr_pcd.session.errors import NotFoundError, StaleRevision
from gr_pcd.session.jobs import Stale

RENDER_MODES = ("edited", "original", "deleted", "step")
FLAG_SELECTED, FLAG_PROTECTED, FLAG_DELETED = 1, 2, 4


@dataclass(frozen=True)
class SelectSpec:
    op: str
    scope: str
    tool: object | None = None  # BoxSpec | PrismSpec | FilterTool | ClusterTool
    evaluate_candidate: bool = True


@dataclass(frozen=True)
class Candidate:
    id: str
    cloud_revision: int
    params_revision: int
    result: CandidateResult
    mode: str
    intervals: list
    cluster: dict | None
    tool_text: str
    tilt: dict | None = None


@dataclass(frozen=True)
class RenderArrays:
    coords: np.ndarray  # float32 (n, 3), relative to origin
    ids: np.ndarray  # uint32
    flags: np.ndarray  # uint8
    origin: tuple[float, float, float]
    eligible: int
    attr: np.ndarray | None = None  # 4-byte values of the requested field
    attr_kind: str | None = None  # f32 | u32 | i32
    attr_field: str | None = None


def _ro(a: np.ndarray) -> np.ndarray:
    a.flags.writeable = False
    return a


def _bounds(xyz: np.ndarray, mask: np.ndarray) -> dict | None:
    if not mask.any():
        return None
    pts = xyz[mask]
    return {"min": pts.min(axis=0).tolist(), "max": pts.max(axis=0).tolist()}


class EditingSession:
    def __init__(
        self,
        cloud: PcdCloud,
        source_path: Path,
        display_name: str,
        budget: int,
        original_path: Path | None = None,
        session_id: str | None = None,
    ) -> None:
        self.id = session_id or uuid.uuid4().hex
        self.cloud = cloud
        self.source_path = Path(source_path)
        self.original_path = Path(original_path or source_path)
        self.filename = display_name
        self.budget = budget
        self.xyz = _ro(xyz64(cloud))
        self.valid = _ro(valid_mask(self.xyz))
        self.active = _ro(np.ones(cloud.n, dtype=bool))
        self.selection_id = 0
        self.selection = _ro(np.zeros(cloud.n, dtype=bool))
        self.selection_ops: list[dict] = []
        self.display_filter = DisplayFilter()
        self.protection = ProtectionState()
        self.history = History(int(budget * HISTORY_FRACTION))
        self.clock = RevisionClock()
        self.client_state: dict = {}
        self.unit = "m"
        self.unsaved = False
        self.edit_counter = 0
        self.candidate: Candidate | None = None
        self._last_cluster: dict | None = None
        # the stored selection was made in scope `displayed` and the display
        # filter changed since: it still holds points the filter now hides
        self._selection_scope: str | None = None
        self.scope_stale = False
        self._last_tool_text = "selection"
        self.lock = threading.RLock()
        self._display_cache: tuple[DisplayFilter, np.ndarray] | None = None
        self._tree_cache: tuple[int, cKDTree, np.ndarray] | None = None
        self._active_bounds_cache: tuple[int, dict | None] | None = None
        self.bounds = _bounds(self.xyz, self.valid)

    @property
    def selection(self) -> np.ndarray:
        return self._selection

    @selection.setter
    def selection(self, value: np.ndarray) -> None:
        # identity of the stored selection: bumps on every assignment
        self._selection = value
        self.selection_id += 1

    def restore(self, loaded) -> None:
        """Apply a validated archive to a fresh session (revisions reset)."""
        self.active = loaded.active
        self.selection = loaded.selection
        self.selection_ops = loaded.ops
        self.display_filter = loaded.display_filter
        self.protection = loaded.protection
        self.history.entries = list(loaded.entries)
        self.history.cursor = loaded.cursor
        self.history.next_sid = max(
            loaded.next_sid,
            max((e.sid for e in loaded.entries), default=-1) + 1,
        )
        self.client_state = loaded.client_state
        self.unit = loaded.unit
        self.unsaved = False

    # ---- helpers -------------------------------------------------------
    def _display(self, token: CancelToken | None = None) -> np.ndarray:
        with self.lock:
            cached = self._display_cache
            filt = self.display_filter
        if cached is not None and cached[0] == filt:
            return cached[1]
        mask = _ro(filter_contains(self.xyz, self.valid, filt, token))
        with self.lock:
            self._display_cache = (filt, mask)
        return mask

    def _protected(self, protection: ProtectionState) -> np.ndarray:
        return protected_mask(
            self.xyz,
            self.valid,
            effective_intervals(protection),
            protection.tilt,
        )

    def require_cloud(self, cloud_revision: int) -> None:
        if cloud_revision != self.clock.cloud:
            raise StaleRevision("cloud revision is obsolete", self.revision())

    def revision(self) -> dict:
        cloud, params = self.clock.ticket()
        return {"cloud": cloud, "params": params}

    def _reset_operation_protection(self) -> None:
        self.protection = ProtectionState(
            self.protection.global_, OperationProtection(), self.protection.tilt
        )

    def _changed(self) -> None:
        self.edit_counter += 1
        self.unsaved = True
        self.candidate = None
        self.scope_stale = False
        self._reset_operation_protection()
        self.clock.bump_cloud()

    # ---- state ---------------------------------------------------------
    def state(self) -> dict:
        with self.lock:
            active, selection = self.active, self.selection
            sel_id = self.selection_id
            ticket = self.clock.ticket()
            protection = self.protection
            filt = self.display_filter
            ops = list(self.selection_ops)
            entries = list(self.history.entries)
            cursor = self.history.cursor
            cache = self._active_bounds_cache
        display = self._display()
        base = active & self.valid
        if cache is not None and cache[0] == ticket[0]:
            active_bounds = cache[1]
        else:
            active_bounds = _bounds(self.xyz, base)
            with self.lock:
                self._active_bounds_cache = (ticket[0], active_bounds)
        n = self.cloud.n
        n_active = int(active.sum())
        return {
            "session_id": self.id,
            "filename": self.filename,
            "encoding": self.cloud.encoding,
            "schema": [
                {
                    "name": s.name,
                    "type": s.type,
                    "size": s.size,
                    "count": s.count,
                }
                for s in self.cloud.schema
            ],
            "width": self.cloud.width,
            "height": self.cloud.height,
            "viewpoint": list(self.cloud.viewpoint),
            "counts": {
                "original": n,
                "active": n_active,
                "deleted": n - n_active,
                "invalid_total": int((~self.valid).sum()),
                "invalid_active": int((active & ~self.valid).sum()),
                "displayed": int((base & display).sum()),
                "selected": int((selection & base).sum()),
                "protected": int((self._protected(protection) & base).sum()),
            },
            "bounds": self.bounds,
            "active_bounds": active_bounds,
            "revision": {"cloud": ticket[0], "params": ticket[1]},
            "display_filter": filter_to_dict(filt),
            "protection": protection_to_dict(protection),
            "selection": {
                "id": sel_id,
                "count": int((selection & base).sum()),
                "ops": ops,
            },
            "history": {
                "entries": [
                    {
                        "index": i,
                        "sid": e.sid,
                        "kind": e.kind,
                        "tool": e.tool,
                        "name": e.name,
                        "description": e.description,
                        "count": len(e.ids),
                    }
                    for i, e in enumerate(entries)
                ],
                "cursor": cursor,
                "can_undo": cursor > 0,
                "can_redo": cursor < len(entries),
            },
            "unit": self.unit,
            "unsaved": self.unsaved,
            "client_state": self.client_state,
        }

    # ---- parameters ----------------------------------------------------
    def set_display_filter(self, filt: DisplayFilter) -> None:
        validate_filter(filt)
        with self.lock:
            if (
                filt != self.display_filter
                and self._selection_scope == "displayed"
                and self.selection.any()
            ):
                self.scope_stale = True
            self.display_filter = filt
            self.candidate = None
            self.clock.bump_params()

    def set_protection(self, protection: ProtectionState) -> None:
        validate_protection(protection)
        with self.lock:
            self.protection = protection
            self.candidate = None
            self.clock.bump_params()

    def set_client_state(self, state: dict) -> None:
        with self.lock:
            self.client_state = state

    # ---- selection and candidate (job bodies) -------------------------
    def _operand(self, spec: SelectSpec, snap: dict, token, on_progress):
        tool = spec.tool
        active, valid = snap["active"], self.valid
        if tool is None:
            if spec.op != "invert":
                raise EditError("tool_required", "this operation needs a tool")
            return np.zeros(self.cloud.n, dtype=bool)
        if isinstance(tool, BoxSpec):
            return box_contains(self.xyz, valid, tool, token) & active
        if isinstance(tool, PrismSpec):
            return prism_contains(self.xyz, valid, tool, token) & active
        if isinstance(tool, FilterTool):
            return filter_operand(active, valid, snap["display"])
        if isinstance(tool, ClusterTool):
            region = None
            if tool.region is not None:
                fn = (
                    box_contains
                    if isinstance(tool.region, BoxSpec)
                    else prism_contains
                )
                region = fn(self.xyz, valid, tool.region, token)
            protected = (
                protected_mask(
                    self.xyz,
                    valid,
                    effective_intervals(snap["protection"]),
                    snap["protection"].tilt,
                )
                if tool.exclude_protected
                else None
            )
            eligible = build_eligible(
                snap["scope"], region, protected, tool.exclude_protected
            )
            res = connected_component(
                self.xyz,
                eligible,
                tool.seed_id,
                tool.radius,
                token=token,
                on_progress=on_progress,
                max_points=tool.max_points,
                on_limit=tool.on_limit,
                budget=self.budget,
            )
            out = np.zeros(self.cloud.n, dtype=bool)
            out[res.ids] = True
            snap["cluster"] = {
                "seed_id": tool.seed_id,
                "radius": tool.radius,
                "size": len(res.ids),
                "complete": res.complete,
                "limit": res.limit,
                "bounds": {
                    "min": list(res.bounds[0]),
                    "max": list(res.bounds[1]),
                },
            }
            return out
        raise EditError("invalid_tool", "unknown tool")

    def run_select(
        self, spec: SelectSpec, ticket, token: CancelToken, progress=None
    ) -> dict:
        with self.lock:
            if not self.clock.is_current(ticket):
                raise Stale()
            snap = {
                "active": self.active,
                "selection": self.selection,
                "protection": self.protection,
                "filter": self.display_filter,
            }
        snap["display"] = self._display(token)
        snap["scope"] = scope_mask(
            spec.scope, snap["active"], self.valid, snap["display"]
        )
        on_progress = (
            (
                lambda visited, eligible: progress(
                    min(0.95, visited / max(eligible, 1)),
                    f"growing cluster: {visited:,} of {eligible:,} eligible",
                )
            )
            if progress
            else None
        )
        operand = self._operand(spec, snap, token, on_progress)
        current = read_selection(snap["selection"], snap["active"], self.valid)
        new_sel = _ro(
            combine_selection(current, operand, spec.op, snap["scope"])
        )
        token.check()
        with self.lock:
            if token.cancelled:
                raise Cancelled()
            if not self.clock.is_current(ticket):
                raise Stale()
            self.selection = new_sel
            self.selection_ops.append(
                {
                    "op": spec.op,
                    "scope": spec.scope,
                    "tool": tool_summary(spec.tool),
                    "filter": filter_to_dict(snap["filter"]),
                    "protection": protection_to_dict(snap["protection"]),
                    "cloud_revision": ticket[0],
                    "count": int(new_sel.sum()),
                }
            )
            self._last_cluster = snap.get("cluster")
            self._selection_scope = spec.scope
            self.scope_stale = False
            self._last_tool_text = _tool_text(spec.tool)
            self.candidate = None
            self.clock.bump_params()
            new_ticket = self.clock.ticket()
        out = {"selected": int(new_sel.sum()), "operand": int(operand.sum())}
        if spec.evaluate_candidate:
            out["candidate"] = self.run_candidate(new_ticket, token)
        return out

    def run_candidate(self, ticket, token: CancelToken, progress=None) -> dict:
        with self.lock:
            if not self.clock.is_current(ticket):
                raise Stale()
            active, selection = self.active, self.selection
            protection = self.protection
            cluster = self._last_cluster
            tool_text = self._last_tool_text
            if self.scope_stale:
                raise EditError(
                    "selection_outdated",
                    "the display filter changed after this selection was "
                    "made in scope displayed; select again",
                )
        display = self._display(token)
        intervals = effective_intervals(protection)
        protected = protected_mask(
            self.xyz, self.valid, intervals, protection.tilt
        )
        token.check()
        res = candidate_deletion(
            self.xyz, active, self.valid, selection, protected, display
        )
        token.check()
        cand = Candidate(
            id=uuid.uuid4().hex,
            cloud_revision=ticket[0],
            params_revision=ticket[1],
            result=res,
            mode=protection.operation.mode,
            intervals=[list(i) for i in intervals],
            tilt=None
            if protection.tilt.level
            else tilt_to_dict(protection.tilt),
            cluster=cluster,
            tool_text=tool_text,
        )
        with self.lock:
            if token.cancelled:
                raise Cancelled()
            if not self.clock.is_current(ticket):
                raise Stale()
            self.candidate = cand
        return candidate_summary(cand)

    def candidate_ids(self, candidate_id: str, offset: int, limit: int) -> dict:
        with self.lock:
            cand = self.candidate
        if cand is None or cand.id != candidate_id:
            raise NotFoundError("candidate not found or obsolete")
        ids = cand.result.ids
        return {
            "candidate_id": candidate_id,
            "total": len(ids),
            "offset": offset,
            "ids": ids[offset : offset + limit].tolist(),
        }

    def clear_selection(self, cloud_revision: int) -> None:
        with self.lock:
            self.require_cloud(cloud_revision)
            self.selection = _ro(np.zeros(self.cloud.n, dtype=bool))
            self.selection_ops = []
            self._last_cluster = None
            self._selection_scope = None
            self.scope_stale = False
            self.candidate = None
            self.clock.bump_params()

    # ---- edits ---------------------------------------------------------
    def apply(
        self, candidate_id: str, cloud_revision: int, description: str | None
    ) -> None:
        with self.lock:
            self.require_cloud(cloud_revision)
            cand = self.candidate
            if (
                cand is None
                or cand.id != candidate_id
                or (cand.cloud_revision, cand.params_revision)
                != self.clock.ticket()
            ):
                raise StaleRevision(
                    "candidate is obsolete; evaluate it again", self.revision()
                )
            ids = cand.result.ids
            if len(ids) == 0:
                raise EditError("nothing_to_delete", "the candidate is empty")
            text = description or (
                f"Deleted {len(ids)} points ({cand.tool_text})"
            )
            self.history.push("delete", text, ids, _step_tool(cand.tool_text))
            self.active = with_ids(self.active, ids, False)
            self.selection = _ro(np.zeros(self.cloud.n, dtype=bool))
            self.selection_ops = []
            self._last_cluster = None
            self._changed()

    def _flip(self, entries, back: bool) -> None:
        # one copy of the mask for the whole move (the sets are disjoint, so
        # the order does not matter), not one per step under the session lock
        if entries:
            out = self.active.copy()
            for e in entries:
                out[e.ids] = back
            out.flags.writeable = False
            self.active = out
        self._changed()

    def rollback(self, cloud_revision: int, cursor: int) -> None:
        """Move the marker: later steps' points return, or are deleted again."""
        with self.lock:
            self.require_cloud(cloud_revision)
            entries, back = self.history.rollback(cursor)
            self._flip(entries, back)

    def undo(self, cloud_revision: int) -> None:
        with self.lock:
            self.require_cloud(cloud_revision)
            if not self.history.can_undo:
                raise EditError("nothing_to_undo", "nothing to undo")
            self.rollback(cloud_revision, self.history.cursor - 1)

    def redo(self, cloud_revision: int) -> None:
        with self.lock:
            self.require_cloud(cloud_revision)
            if not self.history.can_redo:
                raise EditError("nothing_to_redo", "nothing to redo")
            self.rollback(cloud_revision, self.history.cursor + 1)

    def delete_step(self, cloud_revision: int, sid: int) -> None:
        """Remove one step only: its points come back (if it was applied),
        every other step keeps deleting exactly its own set."""
        with self.lock:
            self.require_cloud(cloud_revision)
            entry, applied = self.history.delete_step(sid)
            self._flip([entry] if applied else [], True)

    def rename_step(self, sid: int, name: str | None) -> None:
        with self.lock:
            self.history.rename_step(sid, name)
            self.edit_counter += 1
            self.unsaved = True

    def remove_invalid(self, cloud_revision: int) -> None:
        with self.lock:
            self.require_cloud(cloud_revision)
            self.active = remove_invalid(self.active, self.valid, self.history)
            self._changed()

    def mark_saved(self, edit_counter: int) -> None:
        with self.lock:
            if edit_counter == self.edit_counter:
                self.unsaved = False

    # ---- queries -------------------------------------------------------
    def nearest(self, point, radius: float) -> dict:
        with self.lock:
            rev = self.clock.cloud
            active = self.active
            cache = self._tree_cache
        if cache is None or cache[0] != rev:
            idx = np.flatnonzero(active & self.valid)
            tree = cKDTree(self.xyz[idx]) if len(idx) else None
            cache = (rev, tree, idx)
            with self.lock:
                self._tree_cache = cache
        _, tree, idx = cache
        if tree is None:
            return {"id": None}
        dist, pos = tree.query(point, distance_upper_bound=radius)
        if not np.isfinite(dist):
            return {"id": None}
        rid = int(idx[pos])
        return {
            "id": rid,
            "distance": float(dist),
            "point": self.xyz[rid].tolist(),
        }

    def render(
        self,
        budget: int,
        mode: str,
        attr: str | None = None,
        step: int | None = None,
    ) -> tuple[RenderArrays, dict]:
        if mode not in RENDER_MODES:
            raise EditError("invalid_mode", f"unknown render mode {mode}")
        if mode == "step" and step is None:
            raise EditError("invalid_step", "mode step needs a step id")
        with self.lock:
            active, selection = self.active, self.selection
            protection = self.protection
            rev = self.revision()
            step_ids = self.history.entry(step).ids if mode == "step" else None
        display = self._display()
        valid = self.valid
        if mode == "step":
            # the step's stored id set, never a recomputation
            in_step = np.zeros(self.cloud.n, dtype=bool)
            in_step[step_ids] = True
            base = in_step & valid
            selection = np.zeros(self.cloud.n, dtype=bool)
        else:
            base = {
                "edited": active & valid,
                "original": valid.copy(),
                "deleted": ~active & valid,
            }[mode]
        eligible = np.flatnonzero(base & display)
        m = len(eligible)
        sampled = (
            eligible
            if m <= budget
            else eligible[
                np.floor(np.linspace(0, m, budget, endpoint=False)).astype(
                    np.int64
                )
            ]
        )
        protected = protected_mask(
            self.xyz, valid, effective_intervals(protection), protection.tilt
        )
        sel = selection & active & valid
        if m > budget:
            # flagged points (selected / candidate / protected) are always drawn, up to budget // 2 extra
            flagged = np.setdiff1d(
                eligible[sel[eligible]], sampled, assume_unique=True
            )
            cap = budget // 2
            if len(flagged) > cap:
                flagged = flagged[
                    np.floor(
                        np.linspace(0, len(flagged), cap, endpoint=False)
                    ).astype(np.int64)
                ]
            sampled = np.union1d(sampled, flagged)
        ids = sampled.astype(np.uint32)
        if self.bounds is None:
            origin = (0.0, 0.0, 0.0)
        else:
            lo, hi = np.array(self.bounds["min"]), np.array(self.bounds["max"])
            origin = tuple(((lo + hi) / 2.0).tolist())
        coords = (self.xyz[ids] - np.array(origin)).astype(np.float32)
        flags = np.zeros(len(ids), dtype=np.uint8)
        flags[sel[ids] & ~protected[ids]] |= FLAG_SELECTED
        flags[sel[ids] & protected[ids]] |= FLAG_PROTECTED
        if mode != "step":
            flags[~active[ids]] |= FLAG_DELETED
        values, kind = self._attr_values(attr, ids) if attr else (None, None)
        return RenderArrays(
            coords, ids, flags, origin, m, values, kind, attr
        ), rev

    def _attr_values(self, name: str, ids: np.ndarray):
        idx = [i for i, s in enumerate(self.cloud.schema) if s.name == name]
        if not idx:
            raise EditError("unknown_field", f"no field named {name}")
        spec = self.cloud.schema[idx[0]]
        col = self.cloud.records[f"c{idx[0]}"]
        if spec.count > 1:
            col = col[:, 0]
        col = col[ids]
        if spec.size == 4 and spec.type == "U":
            return col.astype("<u4"), "u32"
        if spec.size == 4 and spec.type == "I":
            return col.astype("<i4"), "i32"
        return col.astype("<f4"), "f32"

    def export_mask(self, scope: str) -> np.ndarray:
        with self.lock:
            active, selection = self.active, self.selection
        if scope == "active":
            return active
        if scope == "selected":
            return selection & active & self.valid
        if scope == "displayed":
            return active & self.valid & self._display()
        raise EditError("invalid_scope", f"unknown export scope {scope}")


def _step_tool(tool_text: str) -> str:
    return "polygon" if tool_text == "prism" else tool_text


def _tool_text(tool) -> str:
    s = tool_summary(tool)
    return "selection" if s is None else s["type"]


def candidate_summary(cand: Candidate) -> dict:
    r = cand.result
    effective = {"mode": cand.mode, "intervals": cand.intervals}
    if cand.tilt is not None:
        effective["tilt"] = cand.tilt
    return {
        "candidate_id": cand.id,
        "cloud_revision": cand.cloud_revision,
        "params_revision": cand.params_revision,
        "selected_active": r.selected_active,
        "protected_retained": r.protected_retained,
        "candidates": r.candidates,
        "selected_outside_display_filter": r.selected_outside_display_filter,
        "bounds": None
        if r.bounds is None
        else {"min": list(r.bounds[0]), "max": list(r.bounds[1])},
        "effective_protection": effective,
        "cluster": cand.cluster,
    }
