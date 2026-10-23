import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import type { PanelActions } from "./panels";
import { buildSelectionPanel } from "./selectionpanel";
import { applyClientPatch, restoreClientState, serialiseClientState } from "../state/persist";

// the control registry rejects a second build of the same ids, so the panel is built once and the state reset per test
const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const scopeChanged = vi.fn();
const actions = new Proxy({ scopeChanged } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
buildSelectionPanel(dom.root as unknown as HTMLElement, store, actions);
const ctl = (id: string) => dom.root.control(id) as FakeEl;
const byId = (id: string) => dom.root.all().find((e) => e.getAttribute("id") === id) as FakeEl;
beforeEach(() => {
  scopeChanged.mockClear();
  store.set({ ...createAppStore().get(), session: sessionFixture(), tool: "box", liveFirst: true });
});

test("UI-1202 Selection is a foldable section (data-section=selection, summary 'Selection') holding the selection controls in order; the fold is stored and persisted", () => {
  const sections = dom.root.children.filter((c) => c.tag === "details");
  expect(sections).toHaveLength(1);
  const sec = sections[0];
  expect(sec.getAttribute("data-section")).toBe("selection");
  expect(sec.children[0].tag).toBe("summary");
  expect(sec.children[0].text()).toBe("Selection");
  const order = ["op-select", "preview-live", "live-note", "scope-select", "sel-colour"];
  const pos = (id: string) => sec.all().findIndex((e) => e.getAttribute("data-control") === id || e.getAttribute("id") === id);
  const idx = order.map(pos);
  expect(idx.every((i) => i >= 0), `all present: ${idx.join(",")}`).toBe(true);
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  // the fold: the store closes it, a toggle writes the store, the closed state survives serialise/restore
  store.update((s) => ({ ...s, sectionsOpen: { ...s.sectionsOpen, selection: false } }));
  expect((sec as unknown as { open: boolean }).open).toBe(false);
  (sec as unknown as { open: boolean }).open = true;
  sec.fire("toggle");
  expect(store.get().sectionsOpen.selection).toBeUndefined();
  store.update((s) => ({ ...s, sectionsOpen: { ...s.sectionsOpen, selection: false } }));
  const saved = JSON.parse(JSON.stringify(serialiseClientState(store.get())));
  expect(applyClientPatch(createAppStore().get(), restoreClientState(saved)!).sectionsOpen.selection).toBe(false);
  expect(byId("draft-note")).toBeDefined();
  expect(candidateFixture()).toBeDefined();
});

const rowOf = (label: string) => dom.root.all().find((e) => e.className === "prow" && e.children[0]?.text() === label) as FakeEl;

test("UI-1203 Operation is a .seg.icons radiogroup, Live preview a row with a text-free switch, Scope a segmented row, Highlight a row of dots", () => {
  expect(ctl("op-select").className).toBe("seg icons");
  expect(ctl("op-select").getAttribute("role")).toBe("radiogroup");
  expect(ctl("op-select").children.map((c) => c.getAttribute("role"))).toEqual(["radio", "radio", "radio"]);
  expect(rowOf("Operation").all()).toContain(ctl("op-select"));
  const live = ctl("preview-live");
  expect(rowOf("Live preview").all()).toContain(live);
  expect(live.getAttribute("role")).toBe("switch");
  expect(live.className).toContain("switch");
  expect(live.children).toEqual([]);
  expect(live.text()).toBe("");
  for (const on of [true, false]) {
    store.set({ previewLive: on });
    expect(live.getAttribute("aria-checked")).toBe(String(on));
    expect(live.getAttribute("aria-pressed")).toBe(String(on));
  }
  const scope = ctl("scope-select");
  expect(rowOf("Scope").all()).toContain(scope);
  expect(scope.getAttribute("role")).toBe("radiogroup");
  expect(scope.className).toBe("seg");
  expect(scope.children.map((c) => c.getAttribute("data-control"))).toEqual(["scope-displayed", "scope-active"]);
  expect(scope.children.map((c) => c.text())).toEqual(["Displayed", "Active"]);
  const dots = ctl("sel-colour");
  expect(rowOf("Highlight").all()).toContain(dots);
  expect(dots.className).toBe("dots");
  expect(dots.getAttribute("aria-label")).toBe("Selected colour");
  expect(dots.children).toHaveLength(4);
});

test("UI-1204 the Scope radios: a click sets scope and calls scopeChanged once, the same value does not call it, arrows move choice and focus, tabindex roves, a store change re-checks without a call", () => {
  const d = ctl("scope-displayed");
  const a = ctl("scope-active");
  expect([d.getAttribute("aria-checked"), a.getAttribute("aria-checked")]).toEqual(["true", "false"]);
  expect([d.tabIndex, a.tabIndex]).toEqual([0, -1]);
  a.fire("click");
  expect(store.get().scope).toBe("active");
  expect(scopeChanged).toHaveBeenCalledTimes(1);
  expect([d.getAttribute("aria-checked"), a.getAttribute("aria-checked")]).toEqual(["false", "true"]);
  expect([d.tabIndex, a.tabIndex]).toEqual([-1, 0]);
  a.fire("click");
  expect(scopeChanged).toHaveBeenCalledTimes(1);
  const prevent = vi.fn();
  a.fire("keydown", { key: "ArrowLeft", preventDefault: prevent });
  expect(prevent).toHaveBeenCalled();
  expect(store.get().scope).toBe("displayed");
  expect(scopeChanged).toHaveBeenCalledTimes(2);
  expect(d.focused).toBe(1);
  d.fire("keydown", { key: "ArrowRight", preventDefault: prevent });
  expect(store.get().scope).toBe("active");
  expect(a.focused).toBe(1);
  scopeChanged.mockClear();
  store.set({ scope: "displayed" });
  expect([d.getAttribute("aria-checked"), a.getAttribute("aria-checked")]).toEqual(["true", "false"]);
  expect(scopeChanged).not.toHaveBeenCalled();
});
