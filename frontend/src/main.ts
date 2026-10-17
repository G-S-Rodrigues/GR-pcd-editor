import * as api from "./api/session";
import { getState } from "./api/session";
import { postJson } from "./files/http";
import { startExport, startSave, markSaved } from "./files/downloads";
import { createHold, setCompare } from "./compare/model";
import { runExport } from "./orchestration/export";
import { runSave } from "./orchestration/session-save";
import { beforeUnloadHandler } from "./orchestration/unsaved";
import { applyClientPatch, createPersister, restoreClientState } from "./state/persist";
import { buildExportDialog } from "./ui/export-dialog";
import { pollJob } from "./files/jobs";
import { createFilterController, enableDefaults, filterFromState, selectDisplayedBody } from "./inspector/filters";
import { type ProtectionModel, protectionFromState } from "./inspector/protection";
import { createProtectionController } from "./inspector/protection-controller";
import { createEditor, keyAction } from "./orchestration/edit";
import { createRunner } from "./orchestration/runner";
import { createParamsHook } from "./orchestration/params";
import { createClearPolygon } from "./orchestration/polygonclear";
import { startDrawing, cancelDrawing, closePolygon, emptyPolygon, enterTool } from "./tools/polygon/model";
import { boxForOpen } from "./tools/box/model";
import { applyPreset } from "./view/presets";
import { buildEditPanels, buildToolPalette } from "./ui/panels";
import { createToolInteraction } from "./viewport/interact";
import { attachDropZone } from "./files/dragdrop";
import { dropNotice, openSource } from "./orchestration/open";
import { createRefresher } from "./orchestration/refresh";
import { createAppStore, addNotice, dismissNotice } from "./state/app";
import type { SessionState } from "./state/types";
import { h } from "./ui/dom";
import { buildInspector } from "./ui/inspector-shell";
import { openMountedDialog } from "./ui/open-dialog";
import { buildStatusbar } from "./ui/statusbar";
import { buildToolbar } from "./ui/toolbar";
import { buildViewbar } from "./ui/viewbar";
import { attachControls } from "./viewport/controls3d";
import { installDebugHook } from "./viewport/debug";
import { createViewport } from "./viewport/scene";
import { fitBounds } from "./view/fit";
import { resetPivot } from "./view/pivot";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const store = createAppStore();
const refresher = createRefresher(store);
const canvas = $<HTMLCanvasElement>("viewport");

const viewport = createViewport(canvas, store, (reason) => {
  const n = $("webgl-notice");
  n.hidden = false;
  n.textContent = `WebGL is unavailable (${reason}). The cloud cannot be drawn, but file information and counts still work.`;
});
const size = () => viewport?.size() ?? { w: canvas.clientWidth, h: canvas.clientHeight };

async function refreshState(): Promise<void> {
  const state = await getState();
  if (state) store.set({ session: state });
  await refresher.refresh();
}
const runner = createRunner(store, {
  submitSelection: (b) => api.submitSelection(b as api.SelectionBody),
  submitCandidate: (rev) => api.submitCandidate(rev),
  cancelJob: (id) => postJson(`/api/jobs/${id}/cancel`),
  poll: (id, opts) => pollJob(id, opts),
  refreshState,
});
const editor = createEditor(
  store,
  {
    apply: api.apply,
    undo: api.undo,
    redo: api.redo,
    removeInvalid: api.removeInvalid,
    clearSelection: api.clearSelection,
    refreshState,
    refreshRender: () => refresher.refresh(),
  },
  (m) => window.confirm(m),
);
const paramsHook = createParamsHook(runner, () => refresher.refresh());
const filters = createFilterController(store, {
  putFilter: api.putFilter,
  onParamsChanged: () => paramsHook("filter"),
  onError: (e) => addNotice(store, "error", "filter_failed", e instanceof Error ? e.message : "The filter could not be set"),
});
const protection = createProtectionController(store, {
  putProtection: api.putProtection,
  onParamsChanged: () => paramsHook("protection"),
  onError: (e) => addNotice(store, "error", "protection_failed", e instanceof Error ? e.message : "Protection could not be set"),
});
const note = (text: string) => addNotice(store, "warn", "tool_edit", text);
const tools = createToolInteraction(canvas, store, size, {
  onToolChanged: () => runner.onToolChanged(),
  protectionEdit: (fn) => protection.edit(fn),
  notify: note,
});
installDebugHook(canvas, store, size);
if (viewport) attachControls(canvas, store, size, tools, () => runner.onToolChanged());

function onOpened(state: SessionState) {
  const { w, h: ph } = size();
  const cam = store.get().camera;
  const fitted = state.active_bounds
    ? fitBounds(resetPivot(cam, state.active_bounds), state.active_bounds, w / Math.max(ph, 1))
    : cam;
  runner.reset();
  const restored = restoreClientState(state.client_state);
  store.update((st) => ({
    ...st,
    camera: fitted,
    tool: "none",
    candidate: null,
    tools: {
      ...st.tools,
      box: boxForOpen(st.tools.box, fitted.target),
      polygon: emptyPolygon(),
      filters: filterFromState(state.display_filter),
      protection: protectionFromState(state.protection) as ProtectionModel,
    },
  }));
  // AC-17: a reopened session brings its saved view back; filters and protection come from the backend state above
  if (restored) store.update((st) => applyClientPatch(st, restored));
}

const deps = {
  store,
  confirm: (m: string) => window.confirm(m),
  refresh: () => refresher.refresh(),
  onOpened,
};

const hold = createHold(store, () => void refresher.refresh());
const exportDialog = buildExportDialog(store, (o) => runExport(store, o, { startExport: (f, s) => startExport(f, s) }));
createPersister(store, api.putClientState, { dragging: () => tools.dragging() });
window.addEventListener("beforeunload", beforeUnloadHandler(() => store.get()));
window.addEventListener("blur", () => hold.blur());
window.addEventListener("keyup", (e) => {
  if (e.key.toLowerCase() === "o") hold.release();
});

buildToolbar($("toolbar"), store, {
  saveSession: () =>
    void runSave(store, { startSave: () => startSave(), markSaved: async (id) => api.normaliseState(await markSaved(id)) }),
  openExport: () => exportDialog.open(),
  pickFile: (file) => void openSource({ kind: "picker", file }, deps),
  openMounted: () =>
    openMountedDialog(
      (c) => void openSource({ kind: "mounted", path: c.path, itemKind: c.kind }, deps),
      (m) => addNotice(store, "error", "mounted_failed", m),
    ),
  preview: () => runner.previewNow(),
  apply: () => void editor.apply(),
  undo: () => void editor.undo(),
  redo: () => void editor.redo(),
});
buildViewbar($("viewbar"), store, {
  size,
  refresh: () => void refresher.refresh(),
  toggleHelp: () => $("help").classList.toggle("on"),
  setCompare: (m) => {
    setCompare(store, m);
    void refresher.refresh();
  },
  holdPress: () => hold.press(),
  holdRelease: () => hold.release(),
  notify: (text) => addNotice(store, "warn", "pivot_invalid", text),
});
buildStatusbar($("statusbar"), $("modebar"), store);
const panelActions = {
  toolChanged: () => runner.onToolChanged(),
  scopeChanged: () => runner.paramsChanged("scope"),
  filterEdit: (axis: "x" | "y" | "z", patch: Partial<{ enabled: boolean; min: number; max: number }>) => filters.edit(axis, enableDefaults(store.get().tools.filters, axis, patch, store.get().session?.bounds ?? null)),
  filterResetBounds: () => filters.resetToCloud(),
  filterResetAll: () => filters.resetAll(),
  protectionEdit: (fn: Parameters<typeof protection.edit>[0]) => protection.edit(fn),
  setTool: (t: "none" | "box" | "polygon" | "cluster") => {
    store.update((st) => ({ ...st, tool: t, interaction: "orbit" }));
    if (t === "polygon") {
      enterTool();
      store.set({ camera: applyPreset(store.get().camera, "top") });
    }
    if (t !== "none") runner.onToolChanged();
    else runner.reset();
  },
  commitDraft: () => runner.commitDraft(),
  selectDisplayed: () => runner.oneShot((rev) => selectDisplayedBody(rev)),
  invert: () =>
    runner.oneShot((rev) => ({ cloud_revision: rev, op: "invert", scope: store.get().scope, tool: null, evaluate_candidate: true })),
  clearSelection: () => {
    runner.reset();
    void editor.clearSelection();
  },
  removeInvalid: () => void editor.removeInvalid(),
  removeInvalidVisible: () => editor.removeInvalidVisible(),
  removeInvalidLabel: () => editor.removeInvalidLabel(),
  cancelJob: () => runner.reset(),
  startDrawing: () => store.update((st) => ({ ...st, tools: { ...st.tools, polygon: startDrawing(st.tools.polygon) } })),
  finishPolygon: (): string | null => {
    const r = closePolygon(store.get().tools.polygon);
    if (!r.ok) return r.message ?? "The polygon is not valid";
    store.update((st) => ({ ...st, tools: { ...st.tools, polygon: r.state } }));
    runner.onToolChanged();
    return null;
  },
  cancelDrawing: () => store.update((st) => ({ ...st, tools: { ...st.tools, polygon: cancelDrawing(st.tools.polygon) } })),
  clearPolygon: createClearPolygon({
    emptyPolygon: () => store.update((st) => ({ ...st, tools: { ...st.tools, polygon: emptyPolygon() } })),
    polygonSelected: () => {
      const st = store.get();
      return st.tool === "polygon" && st.tools.polygon.phase === "closed" && st.op === "replace" && (st.session?.selection.count ?? 0) > 0;
    },
    resetRunner: () => runner.reset(),
    clearSelection: () => void editor.clearSelection(),
  }),
};
buildInspector($("fileinfo"), store);
buildToolPalette($("tools"), store, panelActions);
buildEditPanels($("editpanels"), store, panelActions);

window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement | null;
  const a = keyAction({ key: e.key, ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey, target: t?.tagName ?? "" });
  if ((e.key === "o" || e.key === "O") && !e.ctrlKey && !e.metaKey && !e.altKey && !["INPUT", "TEXTAREA", "SELECT"].includes(t?.tagName ?? "")) {
    if (store.get().session) hold.press();
  } else if (a === "undo") {
    e.preventDefault();
    void editor.undo();
  } else if (a === "redo") {
    e.preventDefault();
    void editor.redo();
  } else if (e.key === "Enter" && store.get().tool === "polygon" && store.get().tools.polygon.phase === "drawing" && t?.tagName !== "INPUT") {
    const msg = panelActions.finishPolygon();
    if (msg) note(msg);
  } else if (e.key === "Escape" && store.get().tools.polygon.phase === "drawing") {
    panelActions.cancelDrawing();
  }
});

$("help").append(
  h("strong", { text: "Controls" }),
  h(
    "table",
    {},
    ...[
      ["Left-drag", "Orbit about the pivot"],
      ["Middle/right-drag, Shift+left-drag", "Pan"],
      ["Wheel", "Zoom"],
      ["1 2 3 4 5 6", "Top, bottom, front, back, left, right"],
      ["P", "Perspective / orthographic"],
      ["F", "Fit the cloud"],
      ["Esc", "Leave pick mode / cancel polygon drawing"],
      ["Ctrl+Z, Ctrl+Y", "Undo, redo"],
      ["Hold O", "Show the original cloud while held (read-only)"],
      ["Enter", "Close the polygon"],
    ].map(([k, v]) => h("tr", {}, h("td", { text: k }), h("td", { text: v }))),
  ),
);

// notices
const noticeBox = $("notices");
store.select(
  (s) => s.notices,
  (notices) => {
    noticeBox.replaceChildren(
      ...notices.map((n) =>
        h("div", { class: `notice ${n.level}`, role: "alert", title: "Click to dismiss", onclick: () => dismissNotice(store, n.id) }, n.text),
      ),
    );
  },
);

// progress and empty state
const progress = $("progress");
const empty = $("empty");
store.subscribe((s) => {
  empty.style.display = s.session ? "none" : "grid";
  const u = s.upload;
  progress.classList.toggle("on", u !== null || s.rendering);
  if (u) {
    const pct = u.total ? ` ${Math.round((u.loaded / u.total) * 100)}%` : "";
    progress.textContent = u.phase === "sending" ? `Uploading${pct}` : "Importing the point cloud…";
  } else if (s.rendering) progress.textContent = "Loading points…";
});

// drag and drop
const dropzone = $("dropzone");
attachDropZone(document.body, {
  onFile: (file) => void openSource({ kind: "picker", file }, deps),
  onError: (code) => dropNotice(store, code),
  onHover: (on) => dropzone.classList.toggle("on", on),
});

// an existing session (page reload)
void getState()
  .then((state) => {
    if (!state) return;
    store.set({ session: state });
    onOpened(state);
    return refresher.refresh();
  })
  .catch(() => undefined);
