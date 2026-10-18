import { PROTECTION_COPY, effectiveText, retainedText } from "../inspector/protection";
import * as P from "../inspector/protection";
import { FILTER_COPY, filterSummary } from "../inspector/filters";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import type { Vec3 } from "../state/types";
import * as B from "../tools/box/model";
import { displayedBounds, fitToView, rectAxis, rectDepth } from "../tools/box/rect";
import { POLYGON_DEPTH_NOTE, Z_UNLIMITED } from "../tools/polygon/model";
import * as PG from "../tools/polygon/model";
import { CLUSTER_LIMIT_TEXT, clusterLimitText, clusterPanel, regionOptions, setRadius } from "../tools/cluster/model";
import { clusterPickState, pickText, pressPick } from "../tools/cluster/pick";
import { headline } from "../status/headline";
import { commitEnabled, commitLabel, discardEnabled, previewText } from "../tools/preview";
import { scopeNotice, selectionDisabledReason } from "../orchestration/selection";
import { historyRows } from "../inspector/history";
import { control } from "./controls";
import { iconControl } from "./iconbutton";
import { iconSvg } from "./icons";
import { commitNumber } from "./numfield";
import { TOOLTIPS } from "./tooltips";
import { h } from "./dom";
import { foldSyncer, foldable } from "./fold";
import type { SectionId } from "./sections";

/** What the panels need from the rest of the app. */
export interface PanelActions {
  toolChanged: () => void;
  scopeChanged: () => void;
  filterResetAll: () => void;
  protectionEdit: (fn: (m: P.ProtectionModel) => P.ProtectionEdit) => P.ProtectionEdit;
  setTool: (t: AppState["tool"]) => void;
  commitDraft: () => void;
  discardDraft: () => void;
  selectDisplayed: () => void;
  invert: () => void;
  clearSelection: () => void;
  removeInvalid: () => void;
  removeInvalidVisible: () => boolean;
  removeInvalidLabel: () => string;
  cancelJob: () => void;
  startDrawing: () => void;
  finishPolygon: () => string | null;
  cancelDrawing: () => void;
  clearPolygon: () => void;
  viewSize: () => { w: number; h: number };
}

const RECT_REASON = "switch to an ortho view (click a ViewCube face)";
type Sync = (s: AppState) => void;
const fmt = (v: number) => String(Math.round(v * 1e6) / 1e6);

export function buildToolPalette(root: HTMLElement, store: Store<AppState>, a: PanelActions): void {
  const toolBtn = (id: string, tool: AppState["tool"], label: string) =>
    control("button", { id, onclick: () => a.setTool(store.get().tool === tool ? "none" : tool) }, label);
  const btns = { box: toolBtn("tool-box", "box", "Box"), polygon: toolBtn("tool-polygon", "polygon", "Polygon"), cluster: toolBtn("tool-cluster", "cluster", "Cluster") };
  // Operation: three icon radios (none pressed while the first selection is live). Replace is not offered.
  const OPS = [
    ["add", "op-add", "add"],
    ["subtract", "op-subtract", "sub"],
    ["intersect", "op-intersect", "int"],
  ] as const;
  const chooseOp = (value: AppState["op"]) => {
    // choosing an operation ends the first (live) selection: the next edit previews against the selection
    store.set({ op: value, liveFirst: false });
    const s = store.get();
    // with a draft showing, a new operation re-previews that shape
    if ((s.draft || s.preview) && s.tool !== "none") a.toolChanged();
  };
  const opBtns = OPS.map(([value, id, icon], i) => {
    const b = iconControl(id, icon, {
      role: "radio",
      onclick: () => chooseOp(value),
      onkeydown: (e: KeyboardEvent) => {
        const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const j = (i + d + OPS.length) % OPS.length;
        chooseOp(OPS[j][0]);
        opBtns[j].focus();
      },
    });
    return b;
  });
  const op = control("div", { id: "op-select", role: "radiogroup", "aria-label": "Operation", class: "opgroup" }, ...opBtns);
  const previewLive = control(
    "button",
    {
      id: "preview-live",
      role: "switch",
      class: "toggle",
      onclick: () => {
        store.set({ previewLive: !store.get().previewLive });
        const s = store.get();
        if (s.draft && s.tool !== "none") a.toolChanged(); // turning it on previews the shape now; off drops the old preview
      },
    },
    iconSvg("eye", 16),
    " Live preview",
  );
  const liveNote = h("p", { id: "live-note", class: "note", hidden: true });
  const scope = control(
    "select",
    {
      id: "scope-select",
      onchange: () => {
        store.set({ scope: scope.value as AppState["scope"] });
        a.scopeChanged();
      },
    },
    h("option", { value: "displayed", text: "Displayed" }),
    h("option", { value: "active", text: "Active" }),
  );
  // Select displayed and Invert stay clickable but inactive (aria-disabled) while a tool is armed: the click explains why
  const guardedBtns: HTMLButtonElement[] = [];
  const guarded = (b: HTMLButtonElement) => (guardedBtns.push(b), b);
  const refuse = (): boolean => {
    const why = selectionDisabledReason(store.get());
    if (why) addNotice(store, "warn", "selection_disabled", why);
    return why !== null;
  };
  const commit = control("button", { id: "sel-commit", onclick: a.commitDraft }, "Commit draft");
  const discard = control("button", { id: "sel-discard", onclick: a.discardDraft }, "Discard draft");
  const note = h("p", { id: "scope-note", class: "note" });
  const invalid = control("button", { id: "remove-invalid", onclick: a.removeInvalid }, "Remove invalid");
  const draftNote = h("p", { id: "draft-note", class: "note warn", hidden: true });
  const keptWarn = h("p", { id: "kept-warning", class: "note warn", hidden: true });
  const keptDelete = control(
    "button",
    { id: "sel-delete-kept", onclick: () => showKeptErr(a.protectionEdit((m) => P.alsoDeleteKept(m, store.get().session?.bounds ?? null)).error) },
    "Also delete the kept points",
  );
  const showKeptErr = (m: string | null | undefined) => {
    if (m) addNotice(store, "error", "delete_kept_failed", m);
  };
  const keptToggle = control("button", { id: "sel-show-kept", onclick: () => store.update((s) => ({ ...s, showKept: !s.showKept })) }, "Show kept points");
  root.append(
    h("h2", { text: "Tools" }),
    h("div", { class: "stack" }, btns.box, btns.polygon, btns.cluster),
    h("h2", { text: "Selection" }),
    h("div", { class: "oprow" }, h("span", { text: "Operation" }), op, previewLive),
    liveNote,
    h("label", {}, "Scope ", scope),
    h("div", { class: "stack" }, commit, discard),
    h(
      "div",
      { class: "stack" },
      guarded(control("button", { id: "sel-select-displayed", onclick: () => refuse() || a.selectDisplayed() }, "Select displayed")),
      guarded(control("button", { id: "sel-invert", onclick: () => refuse() || a.invert() }, "Invert")),
      control("button", { id: "sel-clear", onclick: a.clearSelection }, "Clear selection"),
    ),
    note,
    draftNote,
    keptWarn,
    keptDelete,
    keptToggle,
    h("h2", { text: "Cloud" }),
    invalid,
  );
  const sync: Sync = (s) => {
    for (const k of ["box", "polygon", "cluster"] as const) btns[k].classList.toggle("active", s.tool === k);
    const open = s.session !== null;
    const ro = s.compare !== "edited";
    for (const [k, b] of Object.entries(btns)) {
      b.disabled = !open || ro;
      b.title = `${TOOLTIPS[`tool-${k}`]}${ro ? " (disabled: return to the edited view to edit)" : ""}`;
    }
    OPS.forEach(([value], i) => {
      const on = !s.liveFirst && s.op === value;
      opBtns[i].setAttribute("aria-checked", String(on));
      opBtns[i].tabIndex = on || (s.liveFirst && i === 0) ? 0 : -1;
      opBtns[i].disabled = !open || ro;
    });
    previewLive.setAttribute("aria-checked", String(s.previewLive));
    previewLive.setAttribute("aria-pressed", String(s.previewLive));
    previewLive.replaceChildren(iconSvg(s.previewLive ? "eye" : "eyeoff", 16), " Live preview");
    liveNote.hidden = !(s.liveFirst && s.tool !== "none");
    liveNote.textContent = liveNote.hidden ? "" : "First selection: edits are live. Choose Add, Subtract or Intersect to preview changes instead.";
    scope.value = s.scope;
    const why = selectionDisabledReason(s);
    for (const b of guardedBtns) {
      const id = b.getAttribute("data-control") ?? "";
      b.setAttribute("aria-disabled", String(why !== null));
      b.classList.toggle("inactive", why !== null);
      b.title = why ? `${TOOLTIPS[id]} (${why})` : (TOOLTIPS[id] ?? "");
    }
    commit.disabled = !commitEnabled(s);
    commit.textContent = commitLabel(s);
    discard.disabled = !discardEnabled(s);
    const dn = previewText(s);
    draftNote.hidden = dn === null;
    draftNote.textContent = dn ?? "";
    const n = scopeNotice(s);
    note.textContent = n ?? "";
    const hl = headline(s);
    keptWarn.hidden = hl.warning === null;
    keptWarn.textContent = hl.warning ?? "";
    keptDelete.hidden = hl.deleteKeptLabel === null;
    keptDelete.textContent = hl.deleteKeptLabel ?? "";
    keptToggle.hidden = hl.keptCount === 0;
    keptToggle.classList.toggle("active", s.showKept);
    invalid.hidden = !a.removeInvalidVisible();
    invalid.textContent = a.removeInvalidLabel();
  };
  store.subscribe(sync);
  sync(store.get());
}

export function buildEditPanels(root: HTMLElement, store: Store<AppState>, a: PanelActions): void {
  const syncs: Sync[] = [];
  const errors = h("div", { id: "edit-error", class: "notice error", hidden: true });
  const showErr = (m: string | null | undefined) => {
    errors.hidden = !m;
    errors.textContent = m ?? "";
  };

  /** Numeric text input committed on change. `commit` returns an error message or null. */
  const field = (
    id: string,
    label: string,
    get: (s: AppState) => number,
    commit: (v: number) => string | null,
    off?: (s: AppState) => boolean,
    /** Optional text view: `show` renders the value, `empty` is the number an empty field means. */
    view?: { show: (v: number) => string; empty: number },
  ) => {
    const input = control("input", { id, type: "text", inputmode: "decimal", onchange: () => {
      const err = commitNumber(input.value, label, commit, view);
      showErr(err);
      sync(store.get());
    } });
    const sync: Sync = (s) => {
      if (document.activeElement !== input) input.value = view ? view.show(get(s)) : fmt(get(s));
      input.disabled = off ? off(s) : false;
    };
    syncs.push(sync);
    return h("label", { class: "f" }, label, input);
  };
  const check = (id: string, label: string, get: (s: AppState) => boolean, set: (v: boolean) => void) => {
    const input = control("input", { id, type: "checkbox", onchange: () => set(input.checked) });
    syncs.push((s) => (input.checked = get(s)));
    return h("label", { class: "f" }, input, label);
  };
  const select = (id: string, label: string, options: [string, string][], get: (s: AppState) => string, set: (v: string) => void) => {
    const el = control("select", { id, onchange: () => set(el.value) }, ...options.map(([v, t]) => h("option", { value: v, text: t })));
    syncs.push((s) => (el.value = get(s)));
    return h("label", { class: "f" }, label, el);
  };
  const button = (id: string, label: string, onclick: () => void) => control("button", { id, onclick }, label);
  const section = (id: SectionId, title: string, visible: (s: AppState) => boolean, ...kids: (Node | null)[]) => {
    const f = foldable(store, id, h("h2", { text: title }), ...kids);
    syncs.push((s) => {
      f.el.hidden = !visible(s);
      f.sync(s);
    });
    return f.el;
  };
  /** A panel section the user can fold; its open state is `floorPanelOpen` (also drives the strong protected colour). */
  const collapsible = (title: string, visible: (s: AppState) => boolean, ...kids: (Node | null)[]) => {
    const el = h("details", { class: "panel", open: true }, h("summary", { title: "Fold or unfold this section; while it is open the protected slab is drawn in a stronger colour" }, h("h2", { text: title })), ...kids);
    el.addEventListener("toggle", () => {
      if (el.open !== store.get().floorPanelOpen) store.update((s) => ({ ...s, floorPanelOpen: el.open }));
    });
    const foldSync = foldSyncer(el, (s) => s.floorPanelOpen);
    syncs.push((s) => {
      el.hidden = !visible(s);
      foldSync(s);
    });
    return el;
  };
  const text = (get: (s: AppState) => string, cls = "note") => {
    const el = h("p", { class: cls });
    syncs.push((s) => (el.textContent = get(s)));
    return el;
  };
  const row = (...kids: Node[]) => h("div", { class: "triple" }, ...kids);

  // ---- box
  const boxEdit = (fn: (b: B.BoxModel) => B.BoxEdit): string | null => {
    const r = fn(store.get().tools.box);
    if (!r.ok) return r.error ?? "Invalid box";
    store.update((s) => ({ ...s, tools: { ...s.tools, box: r.box } }));
    a.toolChanged();
    return null;
  };
  const vecField = (kind: "center" | "size", i: 0 | 1 | 2, ax: string) =>
    field(
      `box-${kind}-${ax}`,
      ax.toUpperCase(),
      (s) => (kind === "center" ? s.tools.box.center[i] : s.tools.box.dimensions[i]),
      (v) =>
        boxEdit((b) => {
          const cur = [...(kind === "center" ? b.center : b.dimensions)] as Vec3;
          cur[i] = v;
          return kind === "center" ? B.setCenter(b, cur) : B.setDimensions(b, cur);
        }),
    );
  const rpyField = (i: 0 | 1 | 2, id: string, label: string) =>
    field(id, label, (s) => B.quatToRpy(s.tools.box.quat)[i], (v) =>
      boxEdit((b) => {
        const rpy = B.quatToRpy(b.quat);
        rpy[i] = v;
        return B.setRpy(b, rpy);
      }),
    );
  const mmField = (which: "min" | "max", i: 0 | 1 | 2, ax: string) =>
    field(
      `box-${which}-${ax}`,
      `${which} ${ax.toUpperCase()}`,
      (s) => B.minMaxState(s.tools.box)[which][i],
      (v) =>
        boxEdit((b) => {
          const st = B.minMaxState(b);
          const min = [...st.min] as Vec3;
          const max = [...st.max] as Vec3;
          (which === "min" ? min : max)[i] = v;
          return B.setMinMax(b, min, max);
        }),
      (s) => !B.minMaxState(s.tools.box).enabled,
    );
  const AXN = ["x", "y", "z"] as const;
  const rectButton = button("box-rect", "Rect", () => store.update((s) => ({ ...s, rect: !s.rect })));
  syncs.push((s) => {
    const ok = rectAxis(s.camera) !== null;
    rectButton.disabled = !ok;
    rectButton.classList.toggle("active", s.rect && ok);
    rectButton.title = ok ? TOOLTIPS["box-rect"] : `${TOOLTIPS["box-rect"]} (disabled: ${RECT_REASON})`;
  });
  const boxPanel = section(
    "box",
    "Box",
    (s) => s.tool === "box",
    text((s) => B.boxValidity(s.tools.box) ?? ""),
    h("h3", { text: "Centre" }),
    row(...AXN.map((ax, i) => vecField("center", i as 0 | 1 | 2, ax))),
    h("h3", { text: "Size" }),
    row(...AXN.map((ax, i) => vecField("size", i as 0 | 1 | 2, ax))),
    h("h3", { text: "Rotation (deg)" }),
    row(rpyField(0, "box-roll", "Roll"), rpyField(1, "box-pitch", "Pitch"), rpyField(2, "box-yaw", "Yaw")),
    h("h3", { text: "Min / max" }),
    row(...AXN.map((ax, i) => mmField("min", i as 0 | 1 | 2, ax))),
    row(...AXN.map((ax, i) => mmField("max", i as 0 | 1 | 2, ax))),
    text((s) => {
      const m = B.minMaxState(s.tools.box);
      const e = B.worldExtents(s.tools.box);
      return `${m.enabled ? "" : `${m.reason}. `}World extents: ${e.min.map(fmt).join(", ")} to ${e.max.map(fmt).join(", ")}`;
    }),
    select("box-mode", "Mode", [["inside", "Inside"], ["outside", "Outside"]], (s) => s.tools.box.mode, (v) => {
      boxEdit((b) => ({ ok: true, box: B.setMode(b, v as B.BoxMode) }));
    }),
    h(
      "div",
      { class: "stack" },
      rectButton,
      button("box-reset-rotation", "Reset rotation", () => boxEdit((b) => ({ ok: true, box: B.resetRotation(b) }))),
      button("box-reset", "Reset box", () => boxEdit((b) => ({ ok: true, box: { ...B.resetBox(store.get().camera.target), mode: b.mode } }))),
      button("box-fit-cloud", "Fit cloud", () => {
        const bb = store.get().session?.active_bounds;
        if (bb) boxEdit((b) => ({ ok: true, box: B.fitToBounds(b, bb) }));
      }),
      button("box-fit-displayed", "Fit displayed", () => {
        const s = store.get();
        const bb = s.session?.active_bounds;
        if (bb) boxEdit((b) => ({ ok: true, box: B.fitToBounds(b, displayedBounds(bb, s.tools.filters)) }));
      }),
      button("box-fit-view", "Fit to view", () => {
        const s = store.get();
        const axis = rectAxis(s.camera);
        const depth = axis === null ? null : rectDepth(axis, s.session?.active_bounds ?? null);
        const box = depth ? fitToView(s.tools.box, s.camera, a.viewSize(), depth) : null;
        if (box) boxEdit(() => ({ ok: true, box }));
        else showErr(RECT_REASON);
      }),
      button("box-fit-selection", "Fit selection", () => {
        const bb = store.get().candidate?.bounds;
        if (bb) boxEdit((b) => ({ ok: true, box: B.fitToBounds(b, bb) }));
        else showErr("Preview a selection first; there is no candidate to fit");
      }),
    ),
    h("h3", { text: "Handles" }),
    check("gizmo-snap", "Snap", (s) => s.gizmo.snap, (v) => store.update((s) => ({ ...s, gizmo: { ...s.gizmo, snap: v } }))),
    row(
      field("gizmo-step", "Step", (s) => s.gizmo.step, (v) => {
        if (!(v > 0)) return "Snap step must be greater than 0";
        store.update((s) => ({ ...s, gizmo: { ...s.gizmo, step: v } }));
        return null;
      }),
      field("gizmo-angle-step", "Angle", (s) => s.gizmo.angleStep, (v) => {
        if (!(v > 0)) return "Angle step must be greater than 0";
        store.update((s) => ({ ...s, gizmo: { ...s.gizmo, angleStep: v } }));
        return null;
      }),
    ),
    select("gizmo-frame", "Axes", [["local", "Box axes"], ["world", "World axes"]], (s) => (s.gizmo.local ? "local" : "world"), (v) =>
      store.update((s) => ({ ...s, gizmo: { ...s.gizmo, local: v === "local" } })),
    ),
    h("p", { class: "note", text: "Drag arrows to move, squares to resize (Alt: both sides), rings to rotate; Shift for fine control." }),
  );

  // ---- polygon
  const polyZ = (which: "zMin" | "zMax", id: string, label: string) =>
    field(
      id,
      label,
      (s) => s.tools.polygon[which],
      (v) => {
        const p = store.get().tools.polygon;
        const r = PG.setZ(p, which === "zMin" ? v : p.zMin, which === "zMax" ? v : p.zMax);
        if (!r.ok) return r.message ?? "Invalid Z limit";
        store.update((s) => ({ ...s, tools: { ...s.tools, polygon: r.state } }));
        a.toolChanged();
        return null;
      },
      undefined,
      { show: (v) => PG.zText(v, fmt), empty: which === "zMin" ? -Z_UNLIMITED : Z_UNLIMITED },
    );
  const vertexList = h("div", { class: "verts" });
  let vertKey = "";
  syncs.push((s) => {
    const key = `${s.tools.polygon.phase}|${s.tools.polygon.vertices.length}`;
    if (key === vertKey && vertexList.contains(document.activeElement)) return;
    vertKey = key;
    vertexList.replaceChildren(
      ...s.tools.polygon.vertices.map((v, i) => {
        const mk = (axis: 0 | 1) => {
          const inp = h("input", {
            type: "text",
            class: "vert",
            "data-vertex": `${i}-${axis === 0 ? "x" : "y"}`,
            title: `Polygon vertex ${i + 1} ${axis === 0 ? "X" : "Y"} (file frame)`,
            value: fmt(v[axis]),
            onchange: () => {
              const n = Number(inp.value);
              const cur = store.get().tools.polygon.vertices[i];
              const next: [number, number] = axis === 0 ? [n, cur[1]] : [cur[0], n];
              const r = PG.setVertexNumeric(store.get().tools.polygon, i, next);
              if (!r.ok) showErr(r.message ?? "Invalid vertex");
              else {
                showErr(null);
                store.update((st) => ({ ...st, tools: { ...st.tools, polygon: r.state } }));
                a.toolChanged();
              }
            },
          });
          return inp;
        };
        return h("div", { class: "vertrow" }, h("span", { text: `${i + 1}` }), mk(0), mk(1));
      }),
    );
  });
  const polyPanel = section(
    "polygon",
    "Polygon",
    (s) => s.tool === "polygon",
    h("div", { class: "stack" }, button("poly-draw", "Draw polygon", a.startDrawing), button("poly-finish", "Close polygon", () => showErr(a.finishPolygon())), button("poly-cancel", "Cancel drawing", a.cancelDrawing), button("poly-clear", "Clear polygon", a.clearPolygon)),
    text((s) => (s.tools.polygon.phase === "drawing" ? `Drawing: ${s.tools.polygon.vertices.length} vertices. Click to add, Enter to close, Esc to cancel.` : s.tools.polygon.phase === "closed" ? "Polygon closed. Drag a vertex or edit it numerically." : "Press Draw polygon, then click in the view.")),
    vertexList,
    row(polyZ("zMin", "poly-zmin", "Z min"), polyZ("zMax", "poly-zmax", "Z max")),
    text((s) => PG.polygonProblem(s.tools.polygon) ?? (s.tools.polygon.zMin <= -Z_UNLIMITED && s.tools.polygon.zMax >= Z_UNLIMITED ? "Z limits: unlimited" : "")),
    select("poly-mode", "Mode", [["inside", "Inside"], ["outside", "Outside"]], (s) => s.tools.polygon.mode, (v) => {
      store.update((s) => ({ ...s, tools: { ...s.tools, polygon: { ...s.tools.polygon, mode: v as "inside" | "outside" } } }));
      a.toolChanged();
    }),
    h("p", { class: "note", text: POLYGON_DEPTH_NOTE }),
  );

  // ---- cluster
  // Pick point is a toggle with three states (waiting, set, paused); pressing it always leaves it waiting
  const pickButton = control(
    "button",
    {
      id: "cluster-pick-seed",
      class: "toggle",
      onclick: () => {
        const had = store.get().tools.cluster.seed !== null;
        store.update((s) => ({ ...s, ...pressPick(s) }));
        if (had) a.discardDraft(); // the old seed's draft or preview is gone with it
      },
    },
    "Pick point",
  );
  syncs.push((s) => {
    const st = clusterPickState(s);
    pickButton.setAttribute("data-state", st);
    pickButton.setAttribute("aria-pressed", String(st === "waiting"));
  });
  const clusterPanelEl = section(
    "cluster",
    "Cluster",
    (s) => s.tool === "cluster",
    h("div", { class: "stack" }, pickButton, button("cluster-cancel", "Cancel", a.cancelJob)),
    text((s) => pickText(s)),
    field("cluster-radius", "Link distance", (s) => s.tools.cluster.radius, (v) => {
      const r = setRadius(store.get().tools.cluster, v);
      if (!r.ok) return r.error ?? "Invalid radius";
      store.update((s) => ({ ...s, tools: { ...s.tools, cluster: r.model } }));
      a.toolChanged();
      return null;
    }),
    (() => {
      const input = control("input", { id: "cluster-max-points", type: "text", inputmode: "numeric", placeholder: "No limit", onchange: () => {
        const raw = input.value.trim().replace(/[ ,_]/g, "");
        const v = raw === "" ? null : Number(raw);
        if (v !== null && (!Number.isInteger(v) || v < 1)) {
          showErr("Max points must be a whole number of at least 1, or empty for no limit");
        } else {
          showErr(null);
          store.update((s) => ({ ...s, tools: { ...s.tools, cluster: { ...s.tools.cluster, maxPoints: v } } }));
          a.toolChanged();
        }
        sync(store.get());
      } });
      const sync: Sync = (s) => {
        if (document.activeElement !== input) input.value = s.tools.cluster.maxPoints === null ? "" : fmt(s.tools.cluster.maxPoints);
      };
      syncs.push(sync);
      return h("label", { class: "f" }, "Max points", input);
    })(),
    (() => {
      const sel = control("select", { id: "cluster-region", onchange: () => {
        store.update((s) => ({ ...s, tools: { ...s.tools, cluster: { ...s.tools.cluster, region: sel.value as "none" | "box" | "prism" } } }));
        a.toolChanged();
      } });
      syncs.push((s) => {
        const t = currentToolPair(s);
        const opts = regionOptions(t.box, t.prism);
        sel.replaceChildren(...opts.map((o) => h("option", { value: o, text: o === "none" ? "Whole cloud" : o === "box" ? "Current box" : "Current polygon" })));
        sel.value = opts.includes(s.tools.cluster.region) ? s.tools.cluster.region : "none";
      });
      return h("label", { class: "f" }, "Region ", sel);
    })(),
    check("cluster-exclude-protected", "Exclude protected points", (s) => s.tools.cluster.excludeProtected, (v) => {
      store.update((s) => ({ ...s, tools: { ...s.tools, cluster: { ...s.tools.cluster, excludeProtected: v } } }));
      a.toolChanged();
    }),
    (() => {
      const dl = h("dl", { id: "cluster-result" });
      syncs.push((s) => dl.replaceChildren(...clusterPanel(s.candidate).flatMap((r) => [h("dt", { text: r.label }), h("dd", { text: r.value })])));
      return dl;
    })(),
    text((s) => clusterLimitText(s.candidate) ?? (s.notices.some((n) => n.code === "component_limit_reached") ? CLUSTER_LIMIT_TEXT : ""), "note warn"),
  );

  // ---- filters (the six boxes live on the canvas, see filterboxes/; the panel keeps the note, summary and global reset)
  const filterPanel = section(
    "display",
    "Display filter",
    (s) => s.session !== null,
    h("p", { class: "note", text: FILTER_COPY }),
    text((s) =>
      s.session ? `${filterSummary(s.tools.filters, s.session.bounds, s.session.counts)}. Displayed: ${s.session.counts.displayed.toLocaleString("en-US")} of ${s.session.counts.active.toLocaleString("en-US")} active points` : "",
    ),
    h("div", { class: "stack" }, button("filter-reset-all", "Reset filters", a.filterResetAll)),
  );

  // ---- protection
  const prot = (fn: (m: P.ProtectionModel) => P.ProtectionEdit) => showErr(a.protectionEdit(fn).error);
  // a refused tilt says why right under the fields (the shared #edit-error sits at the top of the panels, out of sight from here)
  const tiltNote = h("p", { id: "prot-tilt-note", class: "note warn", hidden: true });
  const tiltKey = (s: AppState) => `${s.tools.protection.tilt.rx},${s.tools.protection.tilt.ry}`;
  let noteAt = "";
  const tiltMsg = (m: string | null) => {
    tiltNote.hidden = !m;
    tiltNote.textContent = m ?? "";
    noteAt = tiltKey(store.get());
  };
  syncs.push((s) => {
    if (!tiltNote.hidden && tiltKey(s) !== noteAt) tiltMsg(null); // the tilt moved by a ring drag or Level: the refusal is outdated
  });
  const tilt = (patch: { rx?: number; ry?: number }) => {
    const b = store.get().session?.active_bounds;
    const centre: [number, number] = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] : [0, 0];
    const r = a.protectionEdit((m) => P.setTilt(m, patch, centre));
    tiltMsg(r.ok ? null : (r.error ?? "Invalid"));
    return r.ok ? null : (r.error ?? "Invalid");
  };
  const protPanel = collapsible(
    "Height protection",
    (s) => s.session !== null,
    h("p", { class: "note", text: PROTECTION_COPY }),
    h(
      "div",
      { class: "stack" },
      button("prot-pick-floor", "Pick floor point", () => store.set({ interaction: store.get().interaction === "pick-floor" ? "orbit" : "pick-floor" })),
    ),
    field("prot-floor-t", "Floor +/-", (s) => s.floorT, (v) => {
      if (!P.intervalFromPick(0, v).ok) return "The floor thickness must be a number above 0";
      store.update((s) => ({ ...s, floorT: v }));
      return null;
    }),
    check("prot-enabled", "Global protection", (s) => s.tools.protection.global.enabled, (v) => prot((m) => P.setGlobal(m, { enabled: v }))),
    row(
      field("prot-min", "Min Z", (s) => s.tools.protection.global.min, (v) => { const r = a.protectionEdit((m) => P.setGlobal(m, { min: v })); return r.ok ? null : (r.error ?? "Invalid"); }),
      field("prot-max", "Max Z", (s) => s.tools.protection.global.max, (v) => { const r = a.protectionEdit((m) => P.setGlobal(m, { max: v })); return r.ok ? null : (r.error ?? "Invalid"); }),
    ),
    row(
      field("prot-tilt-x", "Tilt X (deg)", (s) => s.tools.protection.tilt.rx, (v) => tilt({ rx: v })),
      field("prot-tilt-y", "Tilt Y (deg)", (s) => s.tools.protection.tilt.ry, (v) => tilt({ ry: v })),
    ),
    tiltNote,
    button("prot-level", "Level", () => { tiltMsg(null); prot((m) => ({ ok: true, model: P.levelled(m) })); }),
    select("prot-mode", "This operation", [["inherit", "Use global"], ["add_local", "Add local slab"], ["override", "Override global"]], (s) => s.tools.protection.mode, (v) => prot((m) => ({ ok: true, model: P.setOperationMode(m, v as P.OpMode) }))),
    row(
      field("prot-local-min", "Local min", (s) => s.tools.protection.local?.min ?? 0, (v) => { const r = a.protectionEdit((m) => P.setLocal(m, { min: v, max: m.local?.max ?? v })); return r.ok ? null : (r.error ?? "Invalid"); }, (s) => s.tools.protection.mode === "inherit"),
      field("prot-local-max", "Local max", (s) => s.tools.protection.local?.max ?? 0, (v) => { const r = a.protectionEdit((m) => P.setLocal(m, { min: m.local?.min ?? v, max: v })); return r.ok ? null : (r.error ?? "Invalid"); }, (s) => s.tools.protection.mode === "inherit"),
    ),
    (() => {
      const wrap = check("prot-ack", "I understand: override ignores global protection", (s) => s.tools.protection.ack, (v) => prot((m) => ({ ok: true, model: P.acknowledge(m, v) })));
      syncs.push((s) => (wrap.hidden = s.tools.protection.mode !== "override"));
      return wrap;
    })(),
    text((s) => P.protectionBlock(s.tools.protection) ?? ""),
    text((s) => retainedText(s.candidate), "note retained"),
    text((s) => effectiveText(s.candidate)),
  );

  // ---- history
  const histList = h("ol", { id: "history-list" });
  syncs.push((s) => {
    histList.replaceChildren(
      ...(s.session ? historyRows(s.session) : []).map((r) =>
        h("li", { class: r.undone ? "undone" : "", text: `${r.label} (${r.count.toLocaleString("en-US")})${r.undone ? " - undone" : ""}` }),
      ),
    );
  });
  const histPanel = section("history", "History", (s) => s.session !== null, histList, text((s) => (s.session && s.session.history.entries.length === 0 ? "No edits yet" : "")));

  root.append(errors, boxPanel, polyPanel, clusterPanelEl, filterPanel, protPanel, histPanel);
  const syncAll = (s: AppState) => {
    for (const f of syncs) f(s);
  };
  store.subscribe(syncAll);
  syncAll(store.get());
}

function currentToolPair(s: AppState) {
  const box = B.toBoxTool(s.tools.box);
  const prism = PG.toPrismTool(s.tools.polygon);
  return { box, prism };
}
