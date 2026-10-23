import * as api from "./api/session";
import * as layerApi from "./api/layers";
import { getState } from "./api/session";
import { postJson, setSessionChangedHandler, setSessionId } from "./files/http";
import { startExport, startExportPerLayer, startSave, markSaved } from "./files/downloads";
import { setCompare } from "./compare/model";
import { runExport } from "./orchestration/export";
import { runSave } from "./orchestration/session-save";
import { beforeUnloadHandler } from "./orchestration/unsaved";
import { applyClientPatch, createPersister, restoreClientState } from "./state/persist";
import { buildExportDialog } from "./ui/export-dialog";
import { pollJob } from "./files/jobs";
import { createFilterController, filterFromState, selectDisplayedBody } from "./inspector/filters";
import { slabCoordinate } from "./inspector/tilt";
import { type ProtectionModel, floorFromPick, protectionFromState, setGlobal } from "./inspector/protection";
import { createProtectionController } from "./inspector/protection-controller";
import { createEditor } from "./orchestration/edit";
import { createRunner, deleteKeyOutcome } from "./orchestration/runner";
import { createPlanesController } from "./orchestration/planes";
import { emptyPlanes } from "./tools/plane/model";
import { armTool, disarmed, disarmedKeepingRegion, escTarget } from "./orchestration/toolstate";
import { createUploadCanceller } from "./orchestration/upload-cancel";
import { type UploadOptions, uploadFile } from "./files/upload";
import { startBanner } from "./status/startbanner";
import { defaultCluster } from "./tools/cluster/model";
import { createParamsHook } from "./orchestration/params";
import { createClearPolygon } from "./orchestration/polygonclear";
import { startDrawing, cancelDrawing, closePolygon, emptyPolygon, enterTool, setEditing } from "./tools/polygon/model";
import { polygonKeyAction } from "./tools/polygon/edit";
import { boxForOpen } from "./tools/box/model";
import { applyPreset } from "./view/presets";
import { buildEditPanels, buildToolPalette } from "./ui/panels";
import { buildPalette } from "./ui/palette";
import { buildLayersPanel } from "./ui/layerspanel";
import { createToolInteraction } from "./viewport/interact";
import { attachDropZone } from "./files/dragdrop";
import { dropNotice, openSource } from "./orchestration/open";
import { createRefresher } from "./orchestration/refresh";
import { createStepView } from "./orchestration/stepview";
import { createSessionSync } from "./orchestration/session-sync";
import { createAppStore, addNotice, dismissNotice } from "./state/app";
import { createJobHint } from "./orchestration/jobhint";
import type { SessionState, ToolKind } from "./state/types";
import { h } from "./ui/dom";
import { control } from "./ui/controls";
import { buildCloudDetails } from "./ui/inspector-shell";
import { buildStatusbar } from "./ui/statusbar";
import { buildBandPill } from "./ui/bandpill";
import { buildLegend } from "./ui/legend";
import { createHide } from "./orchestration/hide";
import { editEnded, layerModeFix } from "./layers/model";
import { createLayers, layerAddBody, layerOpBody, layerSelectBody } from "./orchestration/layers";
import { discardEnabled } from "./tools/preview";
import { buildTimeline } from "./timeline/strip";
import { createStepCentre } from "./timeline/centre";
import { createEditShape } from "./orchestration/editshape";
import { bindPopovers } from "./ui/popover";
import { buildHistoryPopover } from "./ui/historypop";
import { iconControl } from "./ui/iconbutton";
import { buildHelp } from "./ui/help";
import { classifyKey, escapeInField } from "./ui/keys";
import { buildViewCube } from "./ui/viewcube";
import { buildTriad } from "./ui/triad";
import { buildFilterBoxes } from "./ui/filterboxes";
import { buildToolbar } from "./ui/toolbar";
import { buildCameraCluster } from "./ui/camera-cluster";
import { buildDataMode } from "./ui/viewbar";
import { buildDisplayPopover } from "./ui/displaypop";
import { applyTheme, readTheme, writeTheme } from "./ui/themechoice";
import { attachControls } from "./viewport/controls3d";
import { installDebugHook } from "./viewport/debug";
import { createViewport } from "./viewport/scene";
import { fitBounds } from "./view/fit";
import { resetPivot } from "./view/pivot";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// The theme choice is per browser: it is applied before anything is built so the first paint is already themed.
const storage = ((): Storage | { getItem: () => null; setItem: () => void; removeItem: () => void } => {
  try {
    return localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  }
})();
applyTheme(document.documentElement, readTheme(storage));

const store = createAppStore();
createJobHint(store);
const refresher = createRefresher(store);
const stepView = createStepView(store);
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
const sessionSync = createSessionSync(store, { clear: () => refresher.clear(), refresh: () => refresher.refresh() });
setSessionChangedHandler(() => void sessionSync.onChanged());
store.subscribe((s) => setSessionId(s.session?.session_id ?? null));
window.addEventListener("focus", () => void sessionSync.check());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void sessionSync.check();
});
const runner = createRunner(store, {
  submitSelection: (b) => api.submitSelection(b as api.SelectionBody),
  submitCandidate: (rev) => api.submitCandidate(rev),
  submitPreview: (b) => api.submitPreview(b as api.PreviewBody),
  submitCommit: (b) => api.submitCommit(b),
  discardPreview: (rev) => api.discardPreview(rev),
  cancelJob: (id) => postJson(`/api/jobs/${id}/cancel`),
  beaconCancel: (id) => void navigator.sendBeacon(`/api/jobs/${id}/cancel`),
  poll: (id, opts) => pollJob(id, opts),
  refreshState,
});
window.addEventListener("pagehide", () => runner.onPageHide());
const editor = createEditor(
  store,
  {
    apply: api.apply,
    undo: api.undo,
    redo: api.redo,
    removeInvalid: api.removeInvalid,
    rollback: api.rollback,
    deleteStep: api.deleteStep,
    renameStep: api.renameStep,
    clearSelection: api.clearSelection,
    refreshState,
    refreshRender: () => refresher.refresh(),
    checkSession: () => sessionSync.check(),
    supersedePreview: () => runner.supersedePreview(),
  },
  (m) => window.confirm(m),
);
const paramsHook = createParamsHook(runner, () => refresher.refresh());
const layers = createLayers(
  store,
  { createLayer: layerApi.createLayer, assignLayer: layerApi.assignLayer, deleteLayer: layerApi.deleteLayer, setMembers: layerApi.setMembers, patchLayer: layerApi.patchLayer, setVisibility: layerApi.setVisibility, mergeLayer: layerApi.mergeLayer, setOrder: layerApi.setOrder, layerFromProtection: layerApi.layerFromProtection, refreshState },
  {
    paramsHook,
    flushProtection: () => protection.flush(),
    confirm: (m) => window.confirm(m),
    selectLayer: (id) => runner.oneShot((rev) => layerSelectBody(rev, id, store.get().scope)),
    selectLayerAdd: (id) => runner.oneShot((rev) => layerAddBody(rev, id)),
    selectLayerOp: (id, op) => runner.oneShot((rev) => layerOpBody(rev, id, op)),
    apply: () => editor.apply(),
    discardDraft: () => runner.discardDraft(),
    openShape: (shape, centre) => stepEdit.openShape(shape, centre),
  },
);
const hide = createHide(store, { hideSelected: () => layers.hideSelected(), showHidden: () => layers.showHidden() });
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
let rectHeld = false;
const tools = createToolInteraction(canvas, store, size, {
  rectHeld: () => rectHeld,
  onToolChanged: () => runner.onToolChanged(),
  protectionEdit: (fn) => protection.edit(fn),
  notify: note,
  hint: (text) => addNotice(store, "info", "box_body_hint", text),
  filterEdit: (axis, side, value, o) => filters.editSide(axis, side, value, o),
});
let popOpenAtEsc = false; // a popover was open when this Esc began; the later listener must not also discard a draft (E6b)
// The first global keydown listener: it reads the state before controls3d, the timeline, the filter boxes and the one below act.
// A popover added later must report itself through `overlay` (22-5).
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  popOpenAtEsc = pops.isOpen();
  const st = store.get();
  const el = e.target as HTMLInputElement | null;
  const target = escTarget(st, {
    field: escapeInField(el?.tagName ?? "", el?.type ?? ""),
    dragging: tools.dragging() || filterBoxes.dragging() || st.timeline.dragging !== null,
    overlay: pops.isOpen() || document.querySelector("dialog[open]") !== null,
  });
  tools.cancel(); // an arrow drag in progress goes back to its start value
  if (target === "tool") store.update(disarmedKeepingRegion); // R22-1: nothing more specific was pending; the selection and its candidate stay
});
installDebugHook(canvas, store, size, () => viewport?.drawnCount() ?? 0, () => viewport?.stepLayer() ?? { visible: false }, () => viewport?.previewLayer() ?? { id: null, add: 0, remove: 0 });
if (viewport) {
  attachControls(canvas, store, size, tools, () => runner.onToolChanged(), (kind, point) => {
    const st = store.get();
    // on a tilted slab the picked point's slab coordinate is what the interval is measured in (level: its z)
    const r = floorFromPick(st.compare, slabCoordinate(point, st.tools.protection.tilt), st.floorT);
    if (!r.ok) return note(r.reason);
    protection.edit((m) => setGlobal(m, { enabled: true, min: r.min, max: r.max }));
  });
}

function onOpened(state: SessionState) {
  const { w, h: ph } = size();
  const cam = store.get().camera;
  const fitted = state.active_bounds
    ? fitBounds(resetPivot(cam, state.active_bounds), state.active_bounds, w / Math.max(ph, 1))
    : cam;
  planesCtl.cancel();
  runner.reset();
  const restored = restoreClientState(state.client_state);
  store.update((st) => ({
    ...st,
    camera: fitted,
    tool: "none",
    op: "add",
    liveFirst: state.selection.count === 0,
    scope: "displayed",
    candidate: null,
    planes: emptyPlanes(),
    layerUi: { editing: null, active: null }, // layer ids repeat from file to file: a new file has no chosen layer
    tools: {
      ...st.tools,
      box: boxForOpen(st.tools.box, fitted.target),
      polygon: emptyPolygon(),
      cluster: defaultCluster(),
      filters: filterFromState(state.display_filter),
      protection: protectionFromState(state.protection) as ProtectionModel,
    },
  }));
  // AC-17: a reopened session brings its saved view back; filters and protection come from the backend state above
  if (restored) store.update((st) => applyClientPatch(st, restored));
}

// colouring by layer needs layers: when the last one is gone (deleted, or a session without any opens) the mode is Turbo again
store.subscribe((st) => {
  const fix = layerModeFix(st);
  if (fix) store.update((x) => ({ ...x, colour: fix }));
  if (editEnded(st)) layers.leaveEdit();
});

const canceller = createUploadCanceller(store);
const deps = {
  store,
  upload: (f: File, o: UploadOptions) => {
    const handle = uploadFile(f, o);
    canceller.track(handle);
    return handle;
  },
  confirm: (m: string) => window.confirm(m),
  refresh: () => refresher.refresh(),
  clearCache: () => {
    refresher.clear();
    stepView.clear();
  },
  onOpened,
};

const exportDialog = buildExportDialog(store, (o) => runExport(store, o, { startExport: (f, s, l) => startExport(f, s, {}, l), startExportPerLayer: (f, s, l) => startExportPerLayer(f, s, {}, l) }));
const persister = createPersister(store, api.putClientState, { dragging: () => tools.dragging() });
window.addEventListener("beforeunload", beforeUnloadHandler(() => store.get()));

const topbar = buildToolbar($("toolbar"), store, {
  saveSession: () =>
    void runSave(store, { flushClientState: () => persister.flush(), startSave: () => startSave(), markSaved: async (id) => api.normaliseState(await markSaved(id)) }),
  openExport: () => exportDialog.open(),
  pickFile: (file) => void openSource({ kind: "picker", file }, deps),
  preview: () => runner.previewNow(),
  apply: () => void editor.apply(),
  undo: () => void editor.undo(),
  redo: () => void editor.redo(),
});
// The popovers. Their Escape listener is on window and registered after the first global one above, so that listener
// still sees a popover as open (overlay) when it picks what the Esc is for; popOpenAtEsc keeps that for the draft branch below.
const historyOpen = iconControl("history-open", "list");
const pops = bindPopovers([
  { id: "display", anchor: topbar.anchors.display, panel: $("display-pop") },
  { id: "details", anchor: topbar.anchors.details, panel: $("cloud-details") },
  { id: "help", anchor: topbar.anchors.help, panel: $("help-overlay") },
  { id: "history", anchor: historyOpen, panel: $("history-pop") },
], {
  listenPointerDown: (f) => document.addEventListener("pointerdown", f, true),
  listenKey: (f) => window.addEventListener("keydown", f),
  listenResize: (f) => window.addEventListener("resize", f),
  viewport: () => ({ w: window.innerWidth, h: window.innerHeight }),
  measure: (anchor, panel) => {
    const r = anchor.getBoundingClientRect();
    return { anchor: { left: r.left, top: r.top, width: r.width, height: r.height }, size: { w: panel.offsetWidth, h: panel.offsetHeight } };
  },
});
buildCameraCluster($("camera-cluster"), store, { size });
buildDataMode(topbar.centre, store, {
  setCompare: (m) => {
    setCompare(store, m);
    void refresher.refresh();
  },
});
buildDisplayPopover($("display-pop"), store, {
  size,
  refresh: () => void refresher.refresh(),
  theme: readTheme(storage),
  setTheme: (c) => {
    applyTheme(document.documentElement, c);
    writeTheme(storage, c);
  },
});
buildStatusbar($("statusbar"), $("modebar"), store, { openDetails: () => pops.open("details") });
const planesCtl = createPlanesController(
  store,
  { detect: (b) => api.detectPlanes(b as api.DetectPlanesBody), poll: (id, opts) => pollJob(id, opts), cancelJob: (id) => postJson(`/api/jobs/${id}/cancel`) },
  { protectionEdit: (fn) => protection.edit(fn), confirm: (m) => window.confirm(m), toolChanged: () => runner.onToolChanged() },
);
const panelActions = {
  planeDetect: () => void planesCtl.detect(),
  planeCancel: () => planesCtl.cancel(),
  planeSelect: (i: number) => planesCtl.select(i),
  planeBand: (i: number) => planesCtl.band(i),
  toolChanged: () => runner.onToolChanged(),
  scopeChanged: () => runner.paramsChanged("scope"),
  filterResetAll: () => filters.resetToCloud(),
  protectionEdit: (fn: Parameters<typeof protection.edit>[0]) => protection.edit(fn),
  setTool: (t: ToolKind) => {
    store.update((st) => armTool(st, t));
    if (t === "polygon") {
      enterTool();
      store.set({ camera: applyPreset(store.get().camera, "top") });
    }
    if (t !== "none") runner.onToolChanged();
    else runner.reset();
  },
  commitDraft: () => runner.commitDraft(),
  discardDraft: () => runner.discardDraft(),
  selectDisplayed: () => runner.oneShot((rev) => selectDisplayedBody(rev)),
  invert: () =>
    runner.oneShot((rev) => ({ cloud_revision: rev, op: "invert", scope: store.get().scope, tool: null, evaluate_candidate: true })),
  // Clear selection also disarms the tool: no armed button, no seed, no polygon, orbit works again
  clearSelection: () => {
    runner.reset();
    store.update(disarmed);
    void editor.clearSelection();
  },
  toggleHide: () => void hide.toggle(),
  layerCreate: (name: string) => void layers.create(name),
  layerAssign: () => void layers.assign(),
  layerRelease: () => void layers.release(),
  layerSelect: (id: number) => layers.select(id),
  layerToggle: (id: number) => void layers.toggle(id),
  layerToMain: (id: number) => void layers.toMain(id),
  layerChoose: (id: number) => layers.setActive(id),
  layerEdit: (id: number) => void layers.editLayer(id),
  layerSet: () => void layers.setMembers(),
  layerFromBand: () => void layers.fromBand(),
  layerRename: (id: number, name: string) => void layers.rename(id, name),
  layerColour: (id: number, colour: number) => void layers.setColour(id, colour),
  layerFlag: (id: number, flag: "protected" | "locked", value: boolean) => void layers.setFlag(id, flag, value),
  layerOp: (id: number, op: "replace" | "add" | "subtract" | "intersect") => void layers.layerOp(id, op),
  layerMove: (id: number, dir: -1 | 1) => void layers.move(id, dir),
  layerMerge: (from: number, into: number) => void layers.merge(from, into),
  layerDeletePoints: (id: number) => void layers.deletePoints(id),
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
  viewSize: size,
  clearPolygon: createClearPolygon({
    emptyPolygon: () => store.update((st) => ({ ...st, tools: { ...st.tools, polygon: emptyPolygon() } })),
    polygonSelected: () => {
      const st = store.get();
      return st.tool === "polygon" && st.tools.polygon.phase === "closed" && st.liveFirst && (st.session?.selection.count ?? 0) > 0;
    },
    resetRunner: () => runner.reset(),
    clearSelection: () => void editor.clearSelection(),
  }),
};
buildCloudDetails($("cloud-details"), store, { removeInvalid: () => void editor.removeInvalid(), removeInvalidVisible: () => editor.removeInvalidVisible(), removeInvalidLabel: () => editor.removeInvalidLabel() });
buildPalette($("palette"), store, panelActions, $("arm-pill"));
buildToolPalette($("tools"), store, panelActions);
buildLayersPanel($("layers-slot"), store, panelActions);
buildBandPill($("stage"), store);
const legend = buildLegend($("legend"), store, () => void hide.show(), (id) => void layers.toggle(id));
store.subscribe((s) => legend.update(s.timeline.highlight !== null, s.preview?.op ?? null));
const stepEdit = createEditShape(store, {
  resetRunner: () => runner.reset(),
  clearSelection: () => editor.clearSelection(),
  toolChanged: () => runner.onToolChanged(),
});
createStepCentre(store, size);
buildTimeline($("timeline"), store, {
  editShape: (sid) => void stepEdit.edit(sid),
  rollback: (c) => void editor.rollback(c),
  deleteStep: (sid) => void editor.deleteStep(sid),
  renameStep: (sid, name) => void editor.renameStep(sid, name),
  pendingCursor: () => editor.pendingCursor(),
});
$("timeline").append(historyOpen);
buildHistoryPopover($("history-pop"), store);
store.subscribe(() => {
  if (pops.openId() === "history") pops.replace(); // a step added or undone while it is open changes its height
});
buildViewCube($("viewcube"), store);
buildTriad($("triad"), store);
const filterBoxes = buildFilterBoxes($("fbox-layer"), canvas, store, {
  editSide: (axis, side, value, o) => filters.editSide(axis, side, value, o),
  resetSide: (axis, side) => filters.resetSide(axis, side),
});
buildEditPanels($("editpanels"), store, panelActions, { toolRoot: $("toolpanels"), scroller: $("inspector"), pops, popRoot: $("popovers") });

window.addEventListener("keyup", (e) => {
  if (e.key.toLowerCase() === "r") rectHeld = false;
});
window.addEventListener("blur", () => {
  rectHeld = false;
});
const help = buildHelp($("help-overlay"), pops);
window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement | null;
  const id = classifyKey({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, target: t?.tagName ?? "" });
  help.apply(id);
  const pact = polygonKeyAction(store.get().tools.polygon, id, t?.tagName ?? "");
  if (pact === "leave-edit") {
    store.update((st) => ({ ...st, tools: { ...st.tools, polygon: setEditing(st.tools.polygon, false) } }));
  } else if (pact === "remove-vertex") {
    if (t?.tagName !== "BUTTON") {
      e.preventDefault();
      tools.removeHovered();
    }
  } else if (id === "rect") rectHeld = true;
  else if (id === "undo") {
    e.preventDefault();
    void editor.undo();
  } else if (id === "redo") {
    e.preventDefault();
    void editor.redo();
  } else if (id === "apply") {
    const out = deleteKeyOutcome(store.get());
    if (out.run) void editor.apply();
    else addNotice(store, "info", "delete_blocked", out.notice);
  } else if (id === "polygon-close" && store.get().tool === "polygon" && store.get().tools.polygon.phase === "drawing") {
    const msg = panelActions.finishPolygon();
    if (msg) note(msg);
  } else if (id === "cancel" && store.get().layerUi.editing !== null) {
    layers.leaveEdit();
  } else if (id === "cancel" && store.get().tools.polygon.phase === "drawing") {
    panelActions.cancelDrawing();
  } else if (id === "cancel" && store.get().interaction === "orbit" && discardEnabled(store.get()) && !popOpenAtEsc) {
    runner.discardDraft();
  }
});

// notices
const noticeBox = $("notices");
store.select(
  (s) => s.notices,
  (notices) => {
    noticeBox.replaceChildren(
      ...notices.map((n) =>
        h("div", { class: `notice ${n.level}`, role: n.level === "error" ? "alert" : "status", title: "Click to dismiss", onclick: () => dismissNotice(store, n.id) }, n.text),
      ),
    );
  },
);

// progress and empty state
const progress = $("progress");
const progressText = h("span", { id: "progress-text" });
const cancelUpload = control("button", { id: "upload-cancel", onclick: () => void canceller.cancel() }, "Cancel upload");
progress.append(progressText, cancelUpload);
const empty = $("empty");
const banner = $("start-banner");
const syncChrome = (s: ReturnType<typeof store.get>) => {
  empty.style.display = s.session ? "none" : "grid";
  const u = s.upload;
  progress.classList.toggle("on", u !== null || s.rendering);
  if (u) {
    const pct = u.total ? ` ${Math.round((u.loaded / u.total) * 100)}%` : "";
    progressText.textContent = u.phase === "sending" ? `Uploading${pct}` : "Importing the point cloud…";
  } else if (s.rendering) progressText.textContent = "Loading points…";
  cancelUpload.hidden = !canceller.visible(u);
  const sb = startBanner(s);
  banner.hidden = sb === null;
  banner.replaceChildren(...(sb ? [h("strong", { text: sb.title }), h("p", { class: "note", text: sb.reason })] : []));
};
store.subscribe(syncChrome);
syncChrome(store.get());

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
