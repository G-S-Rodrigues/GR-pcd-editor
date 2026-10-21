"""EditingSession: one open cloud, its edits, selection and history."""

import threading
import uuid
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from gr_pcd.editing.cancel import Cancelled, CancelToken
from gr_pcd.editing.candidate import CandidateResult, candidate_deletion
from gr_pcd.editing.cluster import build_eligible, connected_component
from gr_pcd.editing.errors import EditError
from gr_pcd.editing.history import History, RevisionClock, with_ids
from gr_pcd.editing.invalid import remove_invalid
from gr_pcd.editing.layers import (
    COLOURS,
    Layer,
    assign,
    clean_layer_name,
    counts_by_layer,
    delete_layer,
    from_other_layers,
    hidden_points,
    lowest_free_id,
    next_colour,
    protected_points,
)
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
from gr_pcd.editing.sparse import (
    SPARSE_BYTES_PER_POINT,
    SparseSpec,
    auto_radius,
    sparse_mask,
    validate_sparse,
)
from gr_pcd.geometry.box import BoxSpec, box_contains
from gr_pcd.geometry.filters import (
    DisplayFilter,
    filter_contains,
    validate_filter,
)
from gr_pcd.geometry.normals import NORMAL_ATTR, normals_u32
from gr_pcd.geometry.prism import PrismSpec, prism_contains
from gr_pcd.pcd.model import PcdCloud, valid_mask, xyz64
from gr_pcd.session.budget import HISTORY_FRACTION, check_budget
from gr_pcd.session.codec import (
    ClusterTool,
    FilterTool,
    LayerTool,
    filter_to_dict,
    protection_to_dict,
    shape_of,
    tilt_to_dict,
    tool_summary,
)
from gr_pcd.session.errors import NoSuchLayer, NotFoundError, StaleRevision
from gr_pcd.session.jobs import Stale

RENDER_MODES = ("edited", "original", "deleted", "step")
FLAG_SELECTED, FLAG_PROTECTED, FLAG_DELETED = 1, 2, 4
# preview of a pending Add / Subtract / Intersect (bits unused by any other mode)
FLAG_PREVIEW_ADD, FLAG_PREVIEW_REMOVE = 8, 16
PREVIEW_OPS = ("add", "subtract", "intersect")


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
    tool_shape: dict | None = None
    protected_by_layers: int = 0


@dataclass(frozen=True)
class PendingSelection:
    """A computed, not yet committed `S OP shape` (one slot per session)."""

    id: str
    ticket: tuple[int, int]
    spec: SelectSpec
    new_sel: np.ndarray  # read-only bool (n,)
    filter: DisplayFilter
    protection: ProtectionState
    cluster: dict | None


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
    preview_id: str | None = None  # set only when a pending preview was drawn
    # uint8 layer id per drawn point; set only when the session has layers
    layer: np.ndarray | None = None


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
        # named sub layers: one uint8 id per point (0 = main), absent until
        # the first layer exists; layers_rev keys every layer-derived cache
        self.layer: np.ndarray | None = None
        self.layers: list[Layer] = []
        self.layers_rev = 0
        self._selectable_cache: tuple | None = None
        self._layer_stats_cache: tuple | None = None
        self.history = History(int(budget * HISTORY_FRACTION))
        self.clock = RevisionClock()
        self.client_state: dict = {}
        self.unit = "m"
        self.unsaved = False
        self.edit_counter = 0
        self.candidate: Candidate | None = None
        self.pending: PendingSelection | None = None
        self._last_cluster: dict | None = None
        # the stored selection was made in scope `displayed` and the display
        # filter changed since: it still holds points the filter now hides
        self._selection_scope: str | None = None
        self.scope_stale = False
        self._last_tool_text = "selection"
        self._last_tool_shape: dict | None = None
        self._step_bounds: dict[int, dict | None] = {}
        self.lock = threading.RLock()
        self._display_cache: tuple[DisplayFilter, np.ndarray] | None = None
        self._tree_cache: tuple[tuple, cKDTree, np.ndarray] | None = None
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
        self.layer = getattr(loaded, "layer", None)
        self.layers = list(getattr(loaded, "layers", None) or [])
        self.layers_rev = 0
        self._selectable_cache = None
        self._layer_stats_cache = None
        self._strip_hidden_from_selection()
        self.pending = None
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

    def _protected(
        self, protection: ProtectionState, layer=None, layers=()
    ) -> np.ndarray:
        """P: the height band plus every protected layer (one set)."""
        band = protected_mask(
            self.xyz,
            self.valid,
            effective_intervals(protection),
            protection.tilt,
        )
        by_layer = protected_points(layer, list(layers))
        return band if by_layer is None else band | by_layer

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
        self.pending = None
        self.scope_stale = False
        self._reset_operation_protection()
        self.clock.bump_cloud()

    def _bounds_of_step(self, entry) -> dict | None:
        """Exact min/max of the points a step deleted; computed on first use
        and kept per step id (the coordinates never change)."""
        cached = self._step_bounds.get(entry.sid, False)
        if cached is not False:
            return cached
        # a remove-invalid step holds NaN/inf points: only finite ones have bounds
        pts = self.xyz[entry.ids]
        pts = pts[np.isfinite(pts).all(axis=1)]
        if len(pts) == 0:
            out = None
        else:
            out = {
                "min": pts.min(axis=0).tolist(),
                "max": pts.max(axis=0).tolist(),
            }
        self._step_bounds[entry.sid] = out
        return out

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
            layers = list(self.layers)
            layer, layers_rev = self.layer, self.layers_rev
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
        counts = {
            "original": n,
            "active": n_active,
            "deleted": n - n_active,
            "invalid_total": int((~self.valid).sum()),
            "invalid_active": int((active & ~self.valid).sum()),
            "displayed": int((base & display).sum()),
            "selected": int((selection & base).sum()),
            "protected": int(
                (self._protected(protection, layer, layers) & base).sum()
            ),
        }
        out = {
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
            "counts": counts,
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
                        "shape": e.shape,
                        "bounds": self._bounds_of_step(e),
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
        if layers:
            # a layer-less session sends exactly the keys it always sent
            rows, n_main, n_hidden = self._layer_rows(
                base, layer, layers, (ticket[0], layers_rev)
            )
            out["layers"] = rows
            counts["main"], counts["hidden"] = n_main, n_hidden
        return out

    # ---- layers: reads --------------------------------------------------
    def _layer_rows(self, base, layer, layers, key):
        """Per-layer rows plus the main and hidden counts, cached per
        (cloud revision, layers_rev): only active valid members count."""
        cache = self._layer_stats_cache
        if cache is not None and cache[0] == key:
            return cache[1]
        counts = counts_by_layer(layer, base)
        bounds = self._layer_bounds(base, layer)
        rows = [
            {
                "id": lay.id,
                "name": lay.name,
                "colour": lay.colour,
                "visible": lay.visible,
                "count": int(counts[lay.id]),
                "bounds": bounds.get(lay.id),
            }
            for lay in layers
        ]
        n_hidden = int(sum(counts[lay.id] for lay in layers if not lay.visible))
        out = (rows, int(counts[0]), n_hidden)
        self._layer_stats_cache = (key, out)
        return out

    def _layer_bounds(self, base, layer) -> dict:
        """Exact min/max per layer id over its active valid members."""
        if layer is None:
            return {}
        idx = np.flatnonzero(base & (layer != 0))
        if len(idx) == 0:
            return {}
        ids = layer[idx]
        order = np.argsort(ids, kind="stable")
        idx, ids = idx[order], ids[order]
        pts = self.xyz[idx]
        starts = np.flatnonzero(np.r_[True, ids[1:] != ids[:-1]])
        lo = np.minimum.reduceat(pts, starts, axis=0)
        hi = np.maximum.reduceat(pts, starts, axis=0)
        return {
            int(ids[st]): {"min": lo[i].tolist(), "max": hi[i].tolist()}
            for i, st in enumerate(starts)
        }

    def _hidden(self) -> np.ndarray | None:
        """Mask of points in a hidden layer; None when nothing is hidden."""
        with self.lock:
            return hidden_points(self.layer, self.layers)

    def _selectable(self) -> np.ndarray:
        """Active points that are not in a hidden layer. The very same array
        as `active` when nothing is hidden, so layer-less sessions pay nothing.
        Cached per (active array, layers_rev)."""
        with self.lock:
            active, rev = self.active, self.layers_rev
            hidden = hidden_points(self.layer, self.layers)
            if hidden is None:
                return active
            cache = self._selectable_cache
            if cache is not None and cache[0] is active and cache[1] == rev:
                return cache[2]
            out = _ro(active & ~hidden)
            self._selectable_cache = (active, rev, out)
            return out

    def check_layer_tool(self, layer_id: int) -> Layer:
        """The layer a layer tool names, or the error a select job would give."""
        with self.lock:
            lay = self._find_layer(layer_id)
        if not lay.visible:
            raise EditError(
                "layer_hidden", f"layer {lay.name} is hidden; show it first"
            )
        return lay

    def _find_layer(self, layer_id) -> Layer:
        for lay in self.layers:
            if lay.id == layer_id:
                return lay
        raise NoSuchLayer(layer_id)

    # ---- layers: edits (not timeline steps, not in Undo) ---------------
    def _movable(self) -> np.ndarray:
        """The selected points a layer edit may move."""
        return self.selection & self._selectable() & self.valid

    def _strip_hidden_from_selection(self) -> None:
        """The stored selection never holds a point of a hidden layer."""
        hidden = hidden_points(self.layer, self.layers)
        if hidden is None or not (self.selection & hidden).any():
            return
        self.selection = _ro(self.selection & ~hidden)
        if not (self.selection & self.active & self.valid).any():
            self.selection_ops = []
            self._last_cluster = None
            self._selection_scope = None
            self.scope_stale = False

    def _layers_changed(self, cosmetic: bool = False) -> None:
        self.layers_rev += 1
        self.unsaved = True
        self.edit_counter += 1
        if cosmetic:
            return
        self.candidate = None
        self.pending = None
        self._strip_hidden_from_selection()
        self.clock.bump_params()

    def _layer_op(self, moved, layer_id, released=0) -> dict:
        return {
            "moved": int(moved.sum()) if layer_id else 0,
            "from_other_layers": from_other_layers(self.layer, moved, layer_id),
            "released": released,
        }

    def create_layer(
        self,
        cloud_revision: int,
        name: str | None = None,
        visible: bool = True,
        dry_run: bool = False,
    ) -> dict:
        """Move the selectable selected points into a new layer."""
        with self.lock:
            self.require_cloud(cloud_revision)
            moved = self._movable()
            if not moved.any():
                raise EditError(
                    "empty_selection", "select some visible points first"
                )
            lid = lowest_free_id(self.layers)
            clean = clean_layer_name(f"Layer {lid}" if name is None else name)
            op = self._layer_op(moved, lid)
            if dry_run:
                return op
            self.layer = assign(self.layer, moved, lid, self.cloud.n)
            self.layers = [
                *self.layers,
                Layer(lid, clean, next_colour(self.layers), bool(visible)),
            ]
            self._layers_changed()
            return op

    def assign_layer(
        self,
        cloud_revision: int,
        layer_id: int,
        visible: bool | None = None,
        dry_run: bool = False,
    ) -> dict:
        """Move the selectable selected points into a layer (0 = main)."""
        with self.lock:
            self.require_cloud(cloud_revision)
            if layer_id:
                self._find_layer(layer_id)
            moved = self._movable()
            if not moved.any():
                raise EditError(
                    "empty_selection", "select some visible points first"
                )
            if layer_id == 0:
                op = {
                    "moved": 0,
                    "from_other_layers": 0,
                    "released": int(moved.sum()),
                }
            else:
                op = self._layer_op(moved, layer_id)
            if dry_run:
                return op
            self.layer = assign(self.layer, moved, layer_id, self.cloud.n)
            if visible is not None and layer_id:
                self._set_visible([layer_id], bool(visible))
            self._layers_changed()
            return op

    def set_layer_members(
        self, cloud_revision: int, layer_id: int, dry_run: bool = False
    ) -> dict:
        """The selectable selected points become the members of a shown
        layer; its other active members go back to main."""
        with self.lock:
            self.require_cloud(cloud_revision)
            lay = self._find_layer(layer_id)
            if not lay.visible:
                raise EditError(
                    "layer_hidden", f"layer {lay.name} is hidden; show it first"
                )
            moved = self._movable()
            if not moved.any():
                raise EditError(
                    "empty_selection", "select some visible points first"
                )
            old = (self.layer == layer_id) & self.active & self.valid
            released = old & ~moved
            op = self._layer_op(moved, layer_id, int(released.sum()))
            if dry_run:
                return op
            out = assign(self.layer, released, 0, self.cloud.n)
            self.layer = assign(out, moved, layer_id, self.cloud.n)
            self._layers_changed()
            return op

    def delete_layer(self, cloud_revision: int, layer_id: int) -> None:
        """Remove a layer; every point it held (deleted ones too) is main."""
        with self.lock:
            self.require_cloud(cloud_revision)
            self._find_layer(layer_id)
            self.layers = [x for x in self.layers if x.id != layer_id]
            self.layer = delete_layer(self.layer, layer_id)
            if not self.layers:
                self.layer = None
            self._layers_changed()

    def _set_visible(self, ids: list[int], visible: bool) -> bool:
        changed = False
        out = []
        for lay in self.layers:
            if lay.id in ids and lay.visible != visible:
                lay = replace(lay, visible=visible)
                changed = True
            out.append(lay)
        self.layers = out
        return changed

    def patch_layer(
        self,
        layer_id: int,
        name: str | None = None,
        colour: int | None = None,
        visible: bool | None = None,
        protected: bool | None = None,
        locked: bool | None = None,
    ) -> None:
        for flag in (protected, locked):
            if flag is not None and not isinstance(flag, bool):
                raise EditError("invalid_flag", "a flag is true or false")
        with self.lock:
            lay = self._find_layer(layer_id)
            new_name = lay.name if name is None else clean_layer_name(name)
            if colour is None:
                new_colour = lay.colour
            elif (
                isinstance(colour, bool)
                or not isinstance(colour, int)
                or not 0 <= colour < COLOURS
            ):
                raise EditError(
                    "invalid_colour", f"a colour is a number 0..{COLOURS - 1}"
                )
            else:
                new_colour = colour
            new_visible = lay.visible if visible is None else bool(visible)
            new = replace(
                lay,
                name=new_name,
                colour=new_colour,
                visible=new_visible,
                protected=lay.protected if protected is None else protected,
                locked=lay.locked if locked is None else locked,
            )
            if new == lay:
                return
            self.layers = [new if x.id == lay.id else x for x in self.layers]
            self._layers_changed(
                cosmetic=new_visible == lay.visible
                and new.protected == lay.protected
            )

    def set_layers_visibility(
        self, ids: list[int] | None, visible: bool
    ) -> None:
        """Show or hide some layers, or every layer when `ids` is None."""
        with self.lock:
            chosen = [x.id for x in self.layers] if ids is None else list(ids)
            for k in chosen:
                self._find_layer(k)
            if self._set_visible(chosen, bool(visible)):
                self._layers_changed()

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
            self.pending = None
            self.clock.bump_params()

    def set_protection(self, protection: ProtectionState) -> None:
        validate_protection(protection)
        with self.lock:
            self.protection = protection
            self.candidate = None
            self.pending = None
            self.clock.bump_params()

    def set_client_state(self, state: dict) -> None:
        with self.lock:
            self.client_state = state

    # ---- selection and candidate (job bodies) -------------------------
    def _tool_eligible(self, tool, snap: dict, token) -> np.ndarray:
        """Scope, region and (when asked) protection of a cluster or sparse tool."""
        valid = self.valid
        region = None
        if tool.region is not None:
            fn = (
                box_contains
                if isinstance(tool.region, BoxSpec)
                else prism_contains
            )
            region = fn(self.xyz, valid, tool.region, token)
        protected = (
            self._protected(
                snap["protection"], snap.get("layer"), snap.get("layers", ())
            )
            if tool.exclude_protected
            else None
        )
        return build_eligible(
            snap["scope"], region, protected, tool.exclude_protected
        )

    def _operand(self, spec: SelectSpec, snap: dict, token, on_progress):
        tool = spec.tool
        active, valid = snap["active"], self.valid
        if isinstance(tool, LayerTool):
            try:
                self.check_layer_tool(tool.layer_id)
            except NoSuchLayer as exc:
                raise EditError(exc.code, exc.message) from exc
            return (self.layer == tool.layer_id) & active
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
        if isinstance(tool, SparseSpec):
            validate_sparse(tool)
            eligible = self._tool_eligible(tool, snap, token)
            counted = active & valid
            check_budget(
                SPARSE_BYTES_PER_POINT * int(counted.sum()),
                self.budget,
                "sparse point search",
                "Try a smaller cloud or region.",
            )
            radius = tool.radius
            if radius is None:
                radius = auto_radius(self.xyz[counted])
            token.check()
            return (
                sparse_mask(
                    self.xyz, counted, radius, tool.min_neighbours, token
                )
                & eligible
            )
        if isinstance(tool, ClusterTool):
            eligible = self._tool_eligible(tool, snap, token)
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

    def _selection_result(
        self, spec: SelectSpec, ticket, token: CancelToken, progress=None
    ):
        """The shared head of select and preview: no state is changed."""
        with self.lock:
            if not self.clock.is_current(ticket):
                raise Stale()
            snap = {
                "active": self._selectable(),
                "selection": self.selection,
                "protection": self.protection,
                "filter": self.display_filter,
                "layer": self.layer,
                "layers": list(self.layers),
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
        return snap, operand, current, new_sel

    def _install_selection(
        self, spec: SelectSpec, snap: dict, new_sel, ticket, token
    ):
        """The shared tail of select and commit: assign, log, bump once."""
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
            self._last_tool_shape = shape_of(
                spec.tool, snap["filter"], self.bounds
            )
            self.candidate = None
            self.pending = None
            self.clock.bump_params()
            return self.clock.ticket()

    def run_select(
        self, spec: SelectSpec, ticket, token: CancelToken, progress=None
    ) -> dict:
        snap, operand, _cur, new_sel = self._selection_result(
            spec, ticket, token, progress
        )
        new_ticket = self._install_selection(spec, snap, new_sel, ticket, token)
        out = {"selected": int(new_sel.sum()), "operand": int(operand.sum())}
        if spec.evaluate_candidate:
            out["candidate"] = self.run_candidate(new_ticket, token)
        return out

    def run_preview(
        self, spec: SelectSpec, ticket, token: CancelToken, progress=None
    ) -> dict:
        """Compute `S OP shape` and keep it as the one pending preview.

        Never assigns the selection, the candidate or the revision clock.
        """
        if spec.op not in PREVIEW_OPS:
            raise EditError(
                "invalid_op", "a preview is only for add, subtract, intersect"
            )
        snap, operand, current, new_sel = self._selection_result(
            spec, ticket, token, progress
        )
        pending = PendingSelection(
            uuid.uuid4().hex,
            ticket,
            spec,
            new_sel,
            snap["filter"],
            snap["protection"],
            snap.get("cluster"),
        )
        with self.lock:
            if token.cancelled:
                raise Cancelled()
            if not self.clock.is_current(ticket):
                raise Stale()
            self.pending = pending
        out = {
            "preview_id": pending.id,
            "selected_after": int(new_sel.sum()),
            "base_selected": int(current.sum()),
            "added": int((new_sel & ~current).sum()),
            "removed": int((current & ~new_sel).sum()),
            "operand": int(operand.sum()),
        }
        if pending.cluster is not None:
            out["cluster"] = pending.cluster
        return out

    def check_preview(self, preview_id: str) -> None:
        """409 unless `preview_id` is the live, current pending preview."""
        with self.lock:
            p = self.pending
            if (
                p is None
                or p.id != preview_id
                or p.ticket != self.clock.ticket()
            ):
                raise StaleRevision(
                    "the preview is obsolete; preview again", self.revision()
                )

    def commit_pending(
        self,
        preview_id: str,
        ticket,
        token: CancelToken,
        evaluate_candidate: bool = True,
    ) -> dict:
        """Install exactly the previewed mask (no recompute, no drift)."""
        with self.lock:
            if not self.clock.is_current(ticket):
                raise Stale()
            self.check_preview(preview_id)
            p = self.pending
        snap = {
            "filter": p.filter,
            "protection": p.protection,
            "cluster": p.cluster,
        }
        new_ticket = self._install_selection(
            p.spec, snap, p.new_sel, ticket, token
        )
        out = {"selected": int(p.new_sel.sum())}
        if evaluate_candidate:
            out["candidate"] = self.run_candidate(new_ticket, token)
        return out

    def discard_preview(self) -> None:
        with self.lock:
            self.pending = None

    def run_candidate(self, ticket, token: CancelToken, progress=None) -> dict:
        with self.lock:
            if not self.clock.is_current(ticket):
                raise Stale()
            active, selection = self._selectable(), self.selection
            protection = self.protection
            layer, layers = self.layer, list(self.layers)
            cluster = self._last_cluster
            tool_text = self._last_tool_text
            tool_shape = self._last_tool_shape
            if self.scope_stale:
                raise EditError(
                    "selection_outdated",
                    "the display filter changed after this selection was "
                    "made in scope displayed; select again",
                )
        display = self._display(token)
        intervals = effective_intervals(protection)
        protected = self._protected(protection, layer, layers)
        by_layer = protected_points(layer, layers)
        token.check()
        res = candidate_deletion(
            self.xyz, active, self.valid, selection, protected, display
        )
        kept_by_layers = (
            0
            if by_layer is None
            else int((selection & active & self.valid & by_layer).sum())
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
            tool_shape=tool_shape,
            protected_by_layers=kept_by_layers,
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
            self.pending = None
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
            self.history.push(
                "delete",
                text,
                ids,
                _step_tool(cand.tool_text),
                cand.tool_shape,
            )
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
            rev = (self.clock.cloud, self.layers_rev)
            active = self._selectable()
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
        preview: str | None = None,
    ) -> tuple[RenderArrays, dict]:
        if mode not in RENDER_MODES:
            raise EditError("invalid_mode", f"unknown render mode {mode}")
        if mode == "step" and step is None:
            raise EditError("invalid_step", "mode step needs a step id")
        if preview is not None and mode != "edited":
            raise EditError(
                "invalid_mode", "a preview is drawn only in mode edited"
            )
        with self.lock:
            active, selection = self.active, self.selection
            protection = self.protection
            rev = self.revision()
            pend = self.pending
            if (
                pend is None
                or pend.id != preview
                or pend.ticket != self.clock.ticket()
            ):
                pend = None
            step_ids = self.history.entry(step).ids if mode == "step" else None
            hidden = hidden_points(self.layer, self.layers)
            layer = self.layer if self.layers else None
            layers = list(self.layers)
        display = self._display()
        valid = self.valid
        if mode == "step":
            # the step's stored id set, never a recomputation
            in_step = np.zeros(self.cloud.n, dtype=bool)
            in_step[step_ids] = True
            base = in_step & valid
            selection = np.zeros(self.cloud.n, dtype=bool)
        else:
            if hidden is None:
                edited, original = active & valid, valid.copy()
            else:
                # a hidden layer is not drawn, in the edited view and in the
                # original view (where its deleted points still are)
                edited = active & valid & ~hidden
                original = valid & ~(active & hidden)
            base = {
                "edited": edited,
                "original": original,
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
        protected = self._protected(protection, layer, layers)
        sel = selection & active & valid
        shown = sel
        if pend is not None:
            new = pend.new_sel & active & valid
            shown = sel | new
        if m > budget:
            # flagged points (selected / candidate / protected / the preview
            # delta) are always drawn, up to budget // 2 extra; the preview
            # delta goes first so it is never crowded out by the old selection
            cap = budget // 2
            groups = [shown]
            if pend is not None:
                groups = [(new & ~sel) | (sel & ~new), shown]
            extra = np.empty(0, dtype=eligible.dtype)
            for g in groups:
                flagged = np.setdiff1d(
                    eligible[g[eligible]], sampled, assume_unique=True
                )
                flagged = np.setdiff1d(flagged, extra, assume_unique=True)
                room = cap - len(extra)
                if len(flagged) > room:
                    flagged = flagged[
                        np.floor(
                            np.linspace(0, len(flagged), room, endpoint=False)
                        ).astype(np.int64)
                    ]
                extra = np.union1d(extra, flagged)
            sampled = np.union1d(sampled, extra)
        ids = sampled.astype(np.uint32)
        if self.bounds is None:
            origin = (0.0, 0.0, 0.0)
        else:
            lo, hi = np.array(self.bounds["min"]), np.array(self.bounds["max"])
            origin = tuple(((lo + hi) / 2.0).tolist())
        coords = (self.xyz[ids] - np.array(origin)).astype(np.float32)
        flags = np.zeros(len(ids), dtype=np.uint8)
        if pend is None:
            flags[sel[ids] & ~protected[ids]] |= FLAG_SELECTED
            flags[sel[ids] & protected[ids]] |= FLAG_PROTECTED
        else:
            # selected = the previewed result; the delta against the committed
            # selection is "will be added" / "will be removed" (still drawn)
            flags[new[ids] & ~protected[ids]] |= FLAG_SELECTED
            flags[shown[ids] & protected[ids]] |= FLAG_PROTECTED
            flags[(new & ~sel)[ids]] |= FLAG_PREVIEW_ADD
            flags[(sel & ~new)[ids]] |= FLAG_PREVIEW_REMOVE
        if mode != "step":
            flags[~active[ids]] |= FLAG_DELETED
        values, kind = self._attr_values(attr, ids) if attr else (None, None)
        return RenderArrays(
            coords,
            ids,
            flags,
            origin,
            m,
            values,
            kind,
            attr,
            None if pend is None else pend.id,
            None if layer is None else layer[ids],
        ), rev

    def _attr_values(self, name: str, ids: np.ndarray):
        if name == NORMAL_ATTR:
            # computed from the points this render returns (display aid, not a file field)
            return normals_u32(self.xyz[ids]), "u32"
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

    def export_mask(
        self, scope: str, layers: list[int] | None = None
    ) -> np.ndarray:
        """The points an export holds. `layers` limits it to the chosen layer
        ids (0 = main); visibility is ignored. None means every layer."""
        with self.lock:
            active, selection = self.active, self.selection
            layer, known = self.layer, {x.id for x in self.layers}
        if scope == "active":
            mask = active
        elif scope == "selected":
            mask = selection & active & self.valid
        elif scope == "displayed":
            mask = active & self.valid & self._display()
        else:
            raise EditError("invalid_scope", f"unknown export scope {scope}")
        if layers is None:
            return mask
        chosen = set(layers)
        if not chosen:
            raise EditError("no_layers_chosen", "choose at least one layer")
        unknown = chosen - known - {0}
        if unknown:
            raise EditError("unknown_layer", f"no such layer: {min(unknown)}")
        if chosen >= known | {0}:
            return mask
        lut = np.zeros(256, dtype=bool)
        lut[sorted(chosen)] = True
        if layer is None:
            return mask  # only main exists and it is chosen
        return mask & lut[layer]


def _step_tool(tool_text: str) -> str:
    # an older build knows no "sparse" or "layer" step tool: it loads such a step as a plain selection
    if tool_text in ("sparse", "layer"):
        return "selection"
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
        "protected_by_layers": cand.protected_by_layers,
    }
