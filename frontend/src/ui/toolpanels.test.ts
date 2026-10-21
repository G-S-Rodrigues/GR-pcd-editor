import { afterAll, beforeEach, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { type PanelActions, buildEditPanels } from "./panels";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const actions = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
const toolRoot = new (dom.root.constructor as new (t: string) => FakeEl)("div");
const scroller = { scrollTop: 0 };
buildEditPanels(dom.root as unknown as HTMLElement, store, actions, { toolRoot: toolRoot as unknown as HTMLElement, scroller });
const ids = (el: FakeEl) => el.children.map((c) => c.getAttribute("data-section"));
beforeEach(() => {
  scroller.scrollTop = 40;
  store.set({ ...createAppStore().get(), session: sessionFixture(), tool: "none" });
});

test("UI-890 the four tool sections live in the toolRoot slot and the other sections stay in the root; the slot order is box, polygon, cluster, sparse", () => {
  expect(ids(toolRoot)).toEqual(["box", "polygon", "cluster", "sparse"]);
  const rest = ids(dom.root).filter((x) => x !== null);
  expect(rest).not.toContain("box");
  expect(rest).not.toContain("cluster");
  expect(rest).not.toContain("layers"); // 17-10: Layers moved to the left panel
  expect(rest).toContain("history");
});

test("UI-891 arming a tool whose section is folded opens it through the store once, and scrolls the panel to the top once per arming, not on every sync", () => {
  store.update((s) => ({ ...s, sectionsOpen: { cluster: false } }));
  store.set({ tool: "cluster" });
  expect(store.get().sectionsOpen.cluster).toBeUndefined(); // open again: only closed sections are stored
  expect(scroller.scrollTop).toBe(0);
  store.update((s) => ({ ...s, sectionsOpen: { cluster: false } })); // the user folds it while armed: respected
  scroller.scrollTop = 40;
  store.set({ scope: "active" });
  expect(store.get().sectionsOpen.cluster).toBe(false);
  expect(scroller.scrollTop).toBe(40);
  store.set({ tool: "none" });
  expect(scroller.scrollTop).toBe(40);
  store.set({ tool: "cluster" }); // armed again: opens again
  expect(store.get().sectionsOpen.cluster).toBeUndefined();
  expect(scroller.scrollTop).toBe(0);
});
