import { countsPanel } from "../compare/model";
import { lodLabel } from "../render/lod";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { h } from "./dom";
import { foldable } from "./fold";
import type { SectionId } from "./sections";

const f3 = (v: readonly number[]) => v.map((x) => Math.round(x * 1000) / 1000).join(", ");

/** Read-only file and view information . */
export function buildInspector(root: HTMLElement, store: Store<AppState>): void {
  // The folds are built once so a keyboard toggle keeps focus; only their bodies are rebuilt.
  const mk = (id: SectionId, title: string) => {
    const head = h("h2", { text: title });
    const body = h("div", { class: "fold-body" });
    return { ...foldable(store, id, head, body), head, body };
  };
  const file = mk("file", "File");
  const counts = mk("counts", "Counts (exact)");
  const view = mk("view", "View");
  root.replaceChildren(file.el, counts.el, view.el);
  const render = (s: AppState) => {
    const sess = s.session;
    for (const f of [file, counts, view]) f.sync(s);
    counts.el.hidden = view.el.hidden = !sess;
    if (!sess) {
      file.body.replaceChildren(h("p", { text: "No file open" }));
      return;
    }
    const row = (k: string, v: string) => [h("dt", { text: k }), h("dd", { text: v })];
    file.body.replaceChildren(
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
    );
    const c = countsPanel(sess.counts);
    const n = (v: number) => v.toLocaleString("en-US");
    counts.body.replaceChildren(
      h("dl", { id: "counts-panel" }, ...row("Original", n(c.original)), ...row("Remaining", n(c.remaining)), ...row("Deleted", `${n(c.deleted)} (${c.deletedPercent})`)),
    );
    view.head.textContent = `View: ${s.compare}`;
    view.body.replaceChildren(
      h(
        "dl",
        {},
        ...row("Projection", s.camera.ortho ? "Orthographic" : "Perspective"),
        ...row("Pivot", f3(s.camera.target)),
        ...(s.render
          ? row(s.compare === "split" ? "Left drawn" : "Drawn", lodLabel({ count: s.render.count, eligible: s.render.eligible, budget: s.budget }))
          : []),
        ...(s.render2 && s.compare !== "edited" && s.compare !== "original"
          ? row(s.compare === "split" ? "Right drawn" : "Deleted drawn", lodLabel({ count: s.render2.count, eligible: s.render2.eligible, budget: s.budget }))
          : []),
      ),
    );
  };
  store.subscribe(render);
  render(store.get());
}
