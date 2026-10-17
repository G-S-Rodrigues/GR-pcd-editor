import { getState } from "./api/session";
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
if (viewport) attachControls(canvas, store, size);

function onOpened(state: SessionState) {
  const { w, h: ph } = size();
  const cam = store.get().camera;
  const fitted = state.active_bounds
    ? fitBounds(resetPivot(cam, state.active_bounds), state.active_bounds, w / Math.max(ph, 1))
    : cam;
  store.set({ camera: fitted });
}

const deps = {
  store,
  confirm: (m: string) => window.confirm(m),
  refresh: () => refresher.refresh(),
  onOpened,
};

buildToolbar($("toolbar"), store, {
  pickFile: (file) => void openSource({ kind: "picker", file }, deps),
  openMounted: () =>
    openMountedDialog(
      (c) => void openSource({ kind: "mounted", path: c.path, itemKind: c.kind }, deps),
      (m) => addNotice(store, "error", "mounted_failed", m),
    ),
});
buildViewbar($("viewbar"), store, {
  size,
  refresh: () => void refresher.refresh(),
  toggleHelp: () => $("help").classList.toggle("on"),
  notify: (text) => addNotice(store, "warn", "pivot_invalid", text),
});
buildStatusbar($("statusbar"), $("modebar"), store);
buildInspector($("tools"), $("inspector"), store);

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
      ["Esc", "Leave pivot-pick mode"],
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
