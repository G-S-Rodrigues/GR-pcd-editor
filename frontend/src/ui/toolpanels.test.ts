import { afterAll, beforeEach, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { PROTECTION_COPY } from "../inspector/protection";
import { POLYGON_DEPTH_NOTE } from "../tools/polygon/model";
import { type PanelActions, BOX_NOTE, buildEditPanels } from "./panels";
import { CLUSTER_HELP, PLANE_HELP, SPARSE_HELP, THIN_HELP } from "./copy";
import type { PopEntry } from "./popover";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const setToolCalls: unknown[] = [];
const actions = new Proxy({ setTool: (t: unknown) => void setToolCalls.push(t) } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
const added: PopEntry[] = [];
const popRoot = new (dom.root.constructor as new (t: string) => FakeEl)("div");
const fakePops = { add: (e: PopEntry) => void added.push(e), close: () => undefined };
const toolRoot = new (dom.root.constructor as new (t: string) => FakeEl)("div");
const scroller = { scrollTop: 0 };
buildEditPanels(dom.root as unknown as HTMLElement, store, actions, { toolRoot: toolRoot as unknown as HTMLElement, scroller, pops: fakePops, popRoot: popRoot as unknown as HTMLElement });
const ids = (el: FakeEl) => el.children.map((c) => c.getAttribute("data-section"));
beforeEach(() => {
  scroller.scrollTop = 40;
  store.set({ ...createAppStore().get(), session: sessionFixture(), tool: "none" });
});

test("UI-890 the six tool sections live in the toolRoot slot and the other sections stay in the root; the slot order is box, polygon, cluster, sparse, plane, thin", () => {
  expect(ids(toolRoot).filter((x) => x !== null)).toEqual(["box", "polygon", "cluster", "sparse", "plane", "thin"]); // 22-6: the idle line (no data-section) shares the slot
  const rest = ids(dom.root).filter((x) => x !== null);
  expect(rest).not.toContain("box");
  expect(rest).not.toContain("cluster");
  expect(rest).not.toContain("layers"); // 17-10: Layers moved to the left panel
  expect(rest).toEqual([]); // 22-5: History is a popover, so the root holds no fold section
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

const SECTIONS: [string, string, string][] = [
  ["box", "Box", BOX_NOTE],
  ["polygon", "Polygon", POLYGON_DEPTH_NOTE],
  ["cluster", "Cluster", CLUSTER_HELP],
  ["sparse", "Sparse points", SPARSE_HELP],
  ["plane", "Planes", PLANE_HELP],
  ["thin", "Thin", THIN_HELP],
];
const cls = (e: FakeEl) => e.className.split(/\s+/);

test("UI-1165 each tool section's summary is the shared header: icon tile, name, ? help, Esc kbd and an exit button; exit disarms; no static note outside a help panel", () => {
  for (const [id, name] of SECTIONS) {
    const det = toolRoot.children.find((c) => c.getAttribute("data-section") === id) as FakeEl;
    const sum = det.children.find((c) => c.tag === "summary") as FakeEl;
    const kids = sum.children;
    expect(kids.map((k) => k.tag)).toEqual(["span", "h2", "button", "span", "button"]);
    expect(cls(kids[0])).toContain("ticon");
    expect(kids[0].children[0].tag).toBe("svg");
    expect(kids[1].text()).toBe(name);
    expect(kids[2].getAttribute("data-control")).toBe(`${id}-help`);
    expect(cls(kids[3])).toContain("kbd");
    expect(kids[3].text()).toBe("Esc to exit");
    expect(kids[4].getAttribute("data-control")).toBe(`${id}-exit`);
  }
  setToolCalls.length = 0;
  (toolRoot.control("box-exit") as FakeEl).fire("click");
  expect(setToolCalls).toEqual(["none"]);
  const notes = toolRoot.all().filter((e) => e.tag === "p" && [BOX_NOTE, POLYGON_DEPTH_NOTE].includes(e.text()));
  expect(notes).toEqual([]);
});

test("UI-1166 the seven ? helps register as popovers whose panels hang off the popover container (not off a details), carry their copy, and are distinct", () => {
  expect(added.map((e) => e.id)).toEqual(["help-box", "help-polygon", "help-cluster", "help-sparse", "help-plane", "help-thin", "help-prot"]);
  const copies = [...SECTIONS.map((x) => x[2]), PROTECTION_COPY];
  added.forEach((e, i) => {
    const panel = e.panel as unknown as FakeEl;
    expect(popRoot.children).toContain(panel);
    expect(toolRoot.all().includes(panel) || dom.root.all().includes(panel)).toBe(false);
    expect(panel.text()).toBe(copies[i]);
    expect(e.anchor.getAttribute("title")).toBe(copies[i]);
    expect(cls(panel)).toContain("pop");
  });
  expect(new Set(copies).size).toBe(7);
});

test("UI-1167 an open session with no tool armed shows the idle line in the tool slot; arming a tool hides it", () => {
  const idle = toolRoot.children.find((c) => cls(c).includes("idle-tool")) as FakeEl;
  expect(idle.text()).toBe("Pick a tool on the canvas to start a selection.");
  store.set({ tool: "none" });
  expect(idle.hidden).toBe(false);
  store.set({ tool: "box" });
  expect(idle.hidden).toBe(true);
  store.set({ tool: "none" });
});
