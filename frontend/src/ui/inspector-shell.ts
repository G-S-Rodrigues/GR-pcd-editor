import { lodLabel } from "../render/lod";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { h } from "./dom";

const f3 = (v: readonly number[]) => v.map((x) => Math.round(x * 1000) / 1000).join(", ");

/** Read-only file and view information (editing inspectors arrive with the tools). */
export function buildInspector(tools: HTMLElement, root: HTMLElement, store: Store<AppState>): void {
  tools.append(
    h("h2", { text: "Tools" }),
    h("p", { text: "Selection tools (box, polygon, cluster) arrive in the next step. Navigation, views, pivot and colouring work now." }),
    h("h2", { text: "Navigate" }),
    h("p", { text: "Left-drag orbits, middle/right-drag or Shift-drag pans, wheel zooms. Click ? for all keys." }),
  );
  const render = (s: AppState) => {
    const sess = s.session;
    if (!sess) {
      root.replaceChildren(h("h2", { text: "File" }), h("p", { text: "No file open" }));
      return;
    }
    const row = (k: string, v: string) => [h("dt", { text: k }), h("dd", { text: v })];
    root.replaceChildren(
      h("h2", { text: "File" }),
      h(
        "dl",
        {},
        ...row("Name", sess.filename),
        ...row("Encoding", sess.encoding),
        ...row("Fields", sess.schema.map((x) => x.name).join(", ")),
        ...row("Unit", `${sess.unit} (assumed)`),
        ...(sess.bounds ? row("Min", f3(sess.bounds.min)) : []),
        ...(sess.bounds ? row("Max", f3(sess.bounds.max)) : []),
      ),
      h("h2", { text: "View" }),
      h(
        "dl",
        {},
        ...row("Projection", s.camera.ortho ? "Orthographic" : "Perspective"),
        ...row("Pivot", f3(s.camera.target)),
        ...(s.render
          ? row("Drawn", lodLabel({ count: s.render.count, eligible: s.render.eligible, budget: s.budget }))
          : []),
      ),
    );
  };
  store.subscribe(render);
  render(store.get());
}
