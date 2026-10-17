import { lodLabel } from "../render/lod";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { h } from "./dom";

const f3 = (v: readonly number[]) => v.map((x) => Math.round(x * 1000) / 1000).join(", ");

/** Read-only file and view information . */
export function buildInspector(root: HTMLElement, store: Store<AppState>): void {
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
