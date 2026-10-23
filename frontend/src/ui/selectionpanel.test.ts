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
