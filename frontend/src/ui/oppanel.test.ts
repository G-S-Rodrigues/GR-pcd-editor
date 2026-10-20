import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { type PanelActions, buildToolPalette } from "./panels";
import { describeControls } from "./describe";
import { TOOLTIPS } from "./tooltips";
import { applyClientPatch, restoreClientState, serialiseClientState } from "../state/persist";

// the control registry rejects a second build of the same ids, so the panel is built once and the state reset per test
const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const toolChanged = vi.fn();
const selectDisplayed = vi.fn();
const invert = vi.fn();
const setTool = vi.fn();
const actions = new Proxy({ toolChanged, selectDisplayed, invert, setTool } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
buildToolPalette(dom.root as unknown as HTMLElement, store, actions);
const ctl = (id: string) => dom.root.control(id) as FakeEl;
beforeEach(() => {
  toolChanged.mockClear();
  selectDisplayed.mockClear();
  invert.mockClear();
  setTool.mockClear();
  store.set({ ...createAppStore().get(), session: sessionFixture(), tool: "box", liveFirst: true });
});
const build = () => ({ store, ctl, toolChanged });

test("UI-616 the operation group is a radiogroup of three named icon buttons with tooltips, no Replace and no select", () => {
  const { ctl } = build();
  expect(ctl("op-select").getAttribute("role")).toBe("radiogroup");
  const ids = ["op-add", "op-subtract", "op-intersect"];
  expect(ctl("op-select").children.map((c) => c.getAttribute("data-control"))).toEqual(ids);
  for (const id of ids) {
    const b = ctl(id);
    expect(b.getAttribute("role")).toBe("radio");
    expect(b.getAttribute("aria-label")).toBe(describeControls().find((d) => d.id === id)?.label);
    expect(TOOLTIPS[id].length).toBeGreaterThan(10);
    expect(b.title).toBe(TOOLTIPS[id]);
    expect(b.children.map((c) => c.tag)).toEqual(["svg"]);
  }
  expect(dom.root.all().some((e) => e.tag === "select" && e.attrs.get("data-control") === "op-select")).toBe(false);
});

test("UI-617 none is pressed while the first selection is live; pressing an icon checks exactly that one and ends it", () => {
  const { ctl, store } = build();
  const checked = () => ["op-add", "op-subtract", "op-intersect"].map((id) => ctl(id).getAttribute("aria-checked"));
  expect(checked()).toEqual(["false", "false", "false"]);
  ctl("op-subtract").fire("click");
  expect(store.get().op).toBe("subtract");
  expect(store.get().liveFirst).toBe(false);
  expect(checked()).toEqual(["false", "true", "false"]);
  ctl("op-intersect").fire("click");
  expect(checked()).toEqual(["false", "false", "true"]);
  expect(ctl("op-intersect").tabIndex).toBe(0);
  expect(ctl("op-add").tabIndex).toBe(-1);
});

test("UI-618 arrow keys move the choice and the focus around the group", () => {
  const { ctl, store } = build();
  ctl("op-add").fire("click");
  const key = (id: string, k: string) => ctl(id).fire("keydown", { key: k, preventDefault: () => undefined });
  key("op-add", "ArrowRight");
  expect(store.get().op).toBe("subtract");
  expect(ctl("op-subtract").focused).toBe(1);
  key("op-subtract", "ArrowLeft");
  key("op-add", "ArrowLeft"); // wraps
  expect(store.get().op).toBe("intersect");
  key("op-intersect", "ArrowDown");
  expect(store.get().op).toBe("add");
});

test("UI-619 choosing an operation with a draft showing re-previews it; with no draft it only sets the op", () => {
  const { ctl, store, toolChanged } = build();
  ctl("op-add").fire("click");
  expect(toolChanged).not.toHaveBeenCalled();
  store.set({ draft: true });
  ctl("op-subtract").fire("click");
  expect(toolChanged).toHaveBeenCalledTimes(1);
});

test("UI-621 the Live preview toggle: pressed by default, an off state, saved only when off", () => {
  const { ctl, store, toolChanged } = build();
  expect(ctl("preview-live").getAttribute("aria-pressed")).toBe("true");
  expect(store.get().previewLive).toBe(true);
  expect(JSON.stringify(serialiseClientState(store.get()))).not.toMatch(/previewLive/);
  ctl("preview-live").fire("click");
  expect(store.get().previewLive).toBe(false);
  expect(ctl("preview-live").getAttribute("aria-pressed")).toBe("false");
  expect(toolChanged).not.toHaveBeenCalled(); // no draft
  const saved = JSON.parse(JSON.stringify(serialiseClientState(store.get())));
  expect(saved.ui.previewLive).toBe(false);
  const back = applyClientPatch(createAppStore().get(), restoreClientState(saved)!);
  expect(back.previewLive).toBe(false);
  store.set({ draft: true });
  ctl("preview-live").fire("click"); // on again with a draft: preview it now
  expect(store.get().previewLive).toBe(true);
  expect(toolChanged).toHaveBeenCalledTimes(1);
});

test("UI-622 the first-selection note shows only for an armed tool while liveFirst", () => {
  const { store } = build();
  const note = () => dom.root.all().find((e) => e.attrs.get("id") === "live-note")!;
  expect(note().hidden).toBe(false);
  expect(note().textContent).toMatch(/First selection: edits are live/);
  store.set({ liveFirst: false });
  expect(note().hidden).toBe(true);
  store.set({ liveFirst: true, tool: "none" });
  expect(note().hidden).toBe(true);
});

test("UI-639 Select displayed and Invert are aria-disabled with the reason while a tool is armed; a click shows a notice and does nothing", () => {
  const { ctl, store } = build();
  const sd = ctl("sel-select-displayed");
  expect(sd.getAttribute("aria-disabled")).toBe("true"); // tool "box" is armed
  expect(sd.title).toMatch(/Disarm the tool first/);
  expect(ctl("sel-invert").getAttribute("aria-disabled")).toBe("true");
  sd.fire("click");
  ctl("sel-invert").fire("click");
  expect(store.get().notices.map((n) => n.code)).toContain("selection_disabled");
  expect(selectDisplayed).not.toHaveBeenCalled();
  expect(invert).not.toHaveBeenCalled();
  store.set({ tool: "none" });
  sd.fire("click");
  ctl("sel-invert").fire("click");
  expect(selectDisplayed).toHaveBeenCalledTimes(1);
  expect(invert).toHaveBeenCalledTimes(1);
  expect(sd.getAttribute("aria-disabled")).toBe("false");
  expect(sd.title).toBe(TOOLTIPS["sel-select-displayed"]);
  expect(ctl("sel-clear").hasAttribute("aria-disabled")).toBe(false); // Clear selection stays usable
});

test("UI-682 Sparse points is a text tool button beside the other tools: it arms the tool, a second press disarms it", () => {
  const { ctl, store } = build();
  const b = ctl("tool-sparse");
  expect(b.text()).toBe("Sparse points");
  expect(b.children.some((c) => c.tag === "svg")).toBe(false); // no icon on the approved sheet: a text button
  expect(describeControls().find((d) => d.id === "tool-sparse")?.label).toBe("Sparse points");
  expect(TOOLTIPS["tool-sparse"]).toMatch(/isolated/);
  store.set({ tool: "none" });
  b.fire("click");
  expect(setTool).toHaveBeenLastCalledWith("sparse");
  store.set({ tool: "sparse" });
  b.fire("click");
  expect(setTool).toHaveBeenLastCalledWith("none");
  expect(b.classList.contains("active")).toBe(true);
});

test("UI-871 a Selection-block note names the Max points limit from the pending cluster, and is hidden when the cluster is complete", () => {
  const { store } = build();
  const note = dom.root.all().find((e) => e.getAttribute("id") === "cluster-limit") as FakeEl;
  expect(note.className).toBe("note warn");
  expect(note.hidden).toBe(true);
  const cl = (complete: boolean) => ({ seed_id: 1, radius: 0.5, size: 200, complete, limit: complete ? null : 200, bounds: { min: [0, 0, 0], max: [1, 1, 1] } });
  store.update((s) => ({ ...s, tool: "cluster", candidate: candidateFixture({ cluster: cl(false) }) }));
  expect(note.hidden).toBe(false);
  expect(note.text()).toBe("Stopped at limit 200: the 200 points nearest the seed are selected; raise Max points or clear the field for no limit");
  store.update((s) => ({ ...s, candidate: candidateFixture({ cluster: cl(true) }) }));
  expect(note.hidden).toBe(true);
});

test("UI-876 a #delete-blocked note under the Select/Clear/Hide stack carries the reason Delete is off, hidden otherwise", () => {
  const { store } = build();
  const note = dom.root.all().find((e) => e.getAttribute("id") === "delete-blocked") as FakeEl;
  expect(note.className).toBe("note warn");
  store.update((s) => ({ ...s, session: sessionFixture({ selection: { count: 50, ops: [] } }), candidate: candidateFixture() }));
  expect(note.hidden).toBe(true);
  store.update((s) => ({ ...s, tools: { ...s.tools, protection: { ...s.tools.protection, mode: "override", ack: false } } }));
  expect(note.hidden).toBe(false);
  expect(note.text()).toMatch(/^Delete is off: /);
  store.update((s) => ({ ...s, tools: { ...s.tools, protection: { ...s.tools.protection, ack: true, local: { min: 0, max: 1 } } } }));
  expect(note.hidden).toBe(true);
  expect(note.text()).toBe("");
});
