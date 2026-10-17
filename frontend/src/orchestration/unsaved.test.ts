import { expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { beforeUnloadHandler, shouldWarn, unsavedLabel } from "./unsaved";
import { describeControls } from "../ui/describe";
import { TOOLTIPS } from "../ui/tooltips";
import { modeIndicator } from "../status/model";
import { COMPARE_MODES, setCompare } from "../compare/model";

test("UI-93 warn only while there are unsaved edits; badge text follows", () => {
  const store = createAppStore();
  expect(shouldWarn(store.get())).toBe(false);
  store.set({ session: sessionFixture({ unsaved: false }) });
  expect(shouldWarn(store.get())).toBe(false);
  expect(unsavedLabel(store.get())).toBe("No unsaved edits");
  store.set({ session: sessionFixture({ unsaved: true }) });
  expect(shouldWarn(store.get())).toBe(true);
  expect(unsavedLabel(store.get())).toBe("Unsaved edits");
});

test("UI-93 beforeunload handler prevents unload only when unsaved", () => {
  const store = createAppStore();
  const h = beforeUnloadHandler(() => store.get());
  const e1 = { preventDefault: vi.fn(), returnValue: undefined as unknown };
  h(e1);
  expect(e1.preventDefault).not.toHaveBeenCalled();
  store.set({ session: sessionFixture({ unsaved: true }) });
  const e2 = { preventDefault: vi.fn(), returnValue: undefined as unknown };
  h(e2);
  expect(e2.preventDefault).toHaveBeenCalled();
  expect(e2.returnValue).toBe("");
});

test("UI-94 every control has a distinct non-empty tooltip and no dead 'next step' wording", () => {
  const seen = new Map<string, string>();
  for (const { id } of describeControls()) {
    const t = TOOLTIPS[id];
    expect(t, id).toBeTruthy();
    expect(t.trim(), id).not.toBe("");
    expect(seen.get(t), `${id} shares a tooltip with ${seen.get(t)}`).toBeUndefined();
    seen.set(t, id);
    expect(t, id).not.toMatch(/next step|not active yet/i);
  }
  for (const id of ["compare-original", "compare-edited", "compare-overlay", "compare-split", "compare-hold-original", "overlay-opacity", "export-scope", "export-format", "export-go", "export-cancel"]) {
    expect(describeControls().some((c) => c.id === id), id).toBe(true);
  }
});

test("UI-94 inspector copy blocks exist", async () => {
  const { COPY } = await import("../ui/copy");
  for (const k of ["scope", "protectionSlab", "polygonDepth", "filterVsDelete"] as const) {
    expect(COPY[k].length, k).toBeGreaterThan(20);
  }
});

test("UI-95 the mode and frame indicator is present in every tool and comparison mode", () => {
  const store = createAppStore();
  for (const tool of ["none", "box", "polygon", "cluster"] as const) {
    for (const m of COMPARE_MODES) {
      setCompare(store, m);
      store.set({ tool });
      expect(modeIndicator(store.get())).toMatch(/Frame: file \(Z up\) · Unit: m \(assumed\)/);
    }
  }
  setCompare(store, "split");
  expect(modeIndicator(store.get())).toMatch(/View: Split/);
});
