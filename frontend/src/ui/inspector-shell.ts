import { countsPanel } from "../compare/model";
import { lodLabel } from "../render/lod";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { control } from "./controls";
import { h } from "./dom";

const f3 = (v: readonly number[]) => v.map((x) => Math.round(x * 1000) / 1000).join(", ");

export interface CloudDetailsActions {
  removeInvalid: () => void;
  removeInvalidVisible: () => boolean;
  removeInvalidLabel: () => string;
}

/** The Cloud details popover body: read-only file, count and view information, and the Remove invalid action. */
export function buildCloudDetails(root: HTMLElement, store: Store<AppState>, a: CloudDetailsActions): void {
  const removeInvalid = control("button", { id: "remove-invalid", onclick: a.removeInvalid }, "Remove invalid");
  const render = (s: AppState) => {
    const sess = s.session;
    if (!sess) {
      root.replaceChildren(h("p", { text: "No file open" }));
      return;
    }
    const row = (k: string, v: string, status?: string) => [h("dt", { text: k }), h("dd", status ? { text: v, "data-status": status } : { text: v })];
    const n = (v: number) => v.toLocaleString("en-US");
    const c = countsPanel(sess.counts);
    removeInvalid.hidden = !a.removeInvalidVisible();
    removeInvalid.replaceChildren(a.removeInvalidLabel());
    root.replaceChildren(
      h("h4", { text: "Cloud details" }),
      h("h5", { text: "File" }),
      h(
        "dl",
        { class: "kv" },
        ...row("Name", sess.filename),
        ...row("Encoding", sess.encoding),
        ...row("Fields", sess.schema.map((x) => x.name).join(", ")),
        ...row("Unit", `${sess.unit} (assumed)`),
        ...(sess.bounds ? row("Min", f3(sess.bounds.min)) : []),
        ...(sess.bounds ? row("Max", f3(sess.bounds.max)) : []),
      ),
      h("h5", { text: "Counts" }),
      h(
        "dl",
        { id: "counts-panel", class: "kv" },
        ...row("Original", n(c.original), "Original"),
        ...row("Active", n(sess.counts.active), "Active"),
        ...row("Remaining", n(c.remaining)),
        ...row("Deleted", `${n(c.deleted)} (${c.deletedPercent})`),
        ...row("Invalid", `${n(sess.counts.invalid_active)} / ${n(sess.counts.invalid_total)}`),
      ),
      removeInvalid,
      h("h5", { text: "View" }),
      h(
        "dl",
        { class: "kv" },
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
