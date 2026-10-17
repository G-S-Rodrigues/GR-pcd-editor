import { expect, test } from "vitest";
import { applyClientPatch, restoreClientState, serialiseClientState } from "./persist";
import { createAppStore } from "./app";

test("UI-204 box collapse state and the floor panel state are saved and restored; they do not mention filters or protection keys", () => {
  const a = createAppStore();
  a.update((s) => ({ ...s, filterUi: { ...s.filterUi, collapsed: { "x-min": true, "z-max": true } }, floorPanelOpen: false }));
  const saved = JSON.parse(JSON.stringify(serialiseClientState(a.get())));
  expect(saved.ui.boxesCollapsed).toEqual({ "x-min": true, "z-max": true });
  expect(saved.ui.floorPanelOpen).toBe(false);
  expect(JSON.stringify(saved)).not.toMatch(/filters|protection/);
  const patch = restoreClientState(saved);
  expect(patch?.boxesCollapsed).toEqual({ "x-min": true, "z-max": true });
  expect(patch?.floorPanelOpen).toBe(false);
  const out = applyClientPatch(createAppStore().get(), patch!);
  expect(out.filterUi.collapsed).toEqual({ "x-min": true, "z-max": true });
  expect(out.floorPanelOpen).toBe(false);
  expect(out.filterUi.interacting).toBeNull();
});

test("UI-204 malformed box or panel state is ignored", () => {
  const bad = restoreClientState({ v: 1, ui: { boxesCollapsed: { "q-min": true, "x-min": "yes", "y-max": true }, floorPanelOpen: "no" } });
  expect(bad?.boxesCollapsed).toEqual({ "y-max": true });
  expect(bad?.floorPanelOpen).toBeUndefined();
  expect(restoreClientState({ v: 1, ui: { boxesCollapsed: [1, 2] } })?.boxesCollapsed).toBeUndefined();
  const defaults = createAppStore().get();
  expect(defaults.floorPanelOpen).toBe(true);
  expect(defaults.filterUi.collapsed).toEqual({});
});
