import { afterAll, beforeEach, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { type PanelActions, buildToolPalette } from "./panels";
import { buildLayersPanel } from "./layerspanel";
import { previewParts } from "../tools/preview";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const actions = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
buildToolPalette(dom.root as unknown as HTMLElement, store, actions);
const slot = dom.root.all().find((e) => e.getAttribute("id") === "layers-slot") as FakeEl;
buildLayersPanel(slot as unknown as HTMLElement, store, actions);
const byId = (id: string) => dom.root.all().find((e) => e.getAttribute("id") === id) as FakeEl;
beforeEach(() => {
  store.set({ ...createAppStore().get(), session: sessionFixture(), tool: "box", liveFirst: true });
});

test("UI-892 (slot) the Layers section sits in #layers-slot after the Selection block, as the last child", () => {
  const kids = dom.root.children;
  const i = kids.indexOf(slot);
  expect(i).toBeGreaterThan(kids.findIndex((c) => c.tag === "h2" && c.text() === "Selection"));
  expect(kids[kids.length - 1]).toBe(slot);
  expect(slot.children[0].getAttribute("data-section")).toBe("layers");
});

test("UI-893 the short texts are visible and the long ones are tooltips; Select displayed/Invert and Clear selection/Hide selected share a row; every earlier left-panel control id is still there", () => {
  expect(byId("live-note").text()).toBe("First selection: edits are live.");
  expect(byId("live-note").title).toContain("Choose Add, Subtract or Intersect");
  const preview = { id: "p1", op: "add" as const, selected_after: 120, base_selected: 100, added: 20, removed: 0 };
  store.set({ draft: true, preview, candidate: candidateFixture() });
  const parts = previewParts(store.get())!;
  expect(parts.text).toContain("Preview, not applied");
  expect(parts.text).toContain("Apply uses only those 100 committed points");
  expect(byId("draft-note").text()).toBe(parts.text);
  expect(byId("draft-note").title).toContain("Press Commit draft");
  expect(byId("draft-note").title).toContain("Esc discards");
  const rowOf = (id: string) => dom.root.all().find((e) => e.children.some((c) => c.getAttribute("data-control") === id)) as FakeEl;
  expect(rowOf("sel-select-displayed")).toBe(rowOf("sel-invert"));
  expect(rowOf("sel-clear")).toBe(rowOf("sel-hide"));
  expect(rowOf("sel-commit")).toBe(rowOf("sel-discard"));
  const HEAD_IDS = ["op-select", "op-add", "op-subtract", "op-intersect", "preview-live", "scope-select", "sel-colour", "sel-commit", "sel-discard", "sel-select-displayed", "sel-invert", "sel-clear", "sel-hide", "sel-delete-kept", "sel-show-kept", "layer-name", "layer-new", "layer-assign", "layer-release", "layer-set"];
  for (const id of HEAD_IDS) expect(dom.root.control(id), id).toBeDefined();
});
