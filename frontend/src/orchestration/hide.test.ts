import { expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { restoreClientState, serialiseClientState } from "../state/persist";
import { sessionFixture } from "../testing/fixtures";
import { TOOLTIPS } from "../ui/tooltips";
import { describeControls } from "../ui/describe";
import { emptyHidden, stashSelected } from "../view/hidden";
import type { RenderData } from "../render/parse";
import { selectionDisabledReason } from "./selection";
import { applyNeedsHiddenConfirm, createHide, hideState, seedHiddenReason } from "./hide";
import { createEditor } from "./edit";
import { runSave } from "./session-save";

const render = (): RenderData => ({
  coords: new Float32Array(12),
  ids: Uint32Array.from([10, 11, 12, 13]),
  flags: Uint8Array.from([0, 1, 1, 0]),
  origin: [0, 0, 0],
  count: 4,
  eligible: 4,
  cloudRevision: 1,
  paramsRevision: 1,
});
const sess = (selected: number) => sessionFixture({ session_id: "s1", selection: { count: selected, ops: [] }, counts: { ...sessionFixture().counts, original: 100 } });
const withSel = (over: Record<string, unknown> = {}) => {
  const store = createAppStore();
  store.set({ session: sess(2), render: render(), ...over } as never);
  return store;
};

test("UI-507 the control is registered with a label and tooltip, reads Hide selected, and becomes a pressed Show hidden (N) once the set is non-empty", () => {
  expect(TOOLTIPS["sel-hide"]).toMatch(/hide/i);
  expect(describeControls().find((d) => d.id === "sel-hide")?.label).toBe("Hide selected");
  const store = withSel();
  expect(hideState(store.get())).toEqual({ label: "Hide selected", pressed: false, reason: null });
  store.set({ hidden: stashSelected(emptyHidden(), render(), "s1", 100, 2).hidden });
  expect(hideState(store.get())).toEqual({ label: "Show hidden (2)", pressed: true, reason: null });
});

test("UI-508 hide is refused with a reason: no file, not the edited view, a draft or preview, no selection", () => {
  const reason = (over: Record<string, unknown>) => hideState(withSel(over).get()).reason;
  expect(hideState(createAppStore().get()).reason).toBe("No file is open");
  expect(reason({ compare: "overlay" })).toMatch(/edited view/);
  expect(reason({ draft: true })).toBe("Commit or discard the draft first");
  expect(reason({ preview: { id: "p" } })).toBe("Commit or discard the draft first");
  expect(reason({ session: sess(0) })).toBe("Select some points first");
  expect(reason({})).toBeNull();
});

test("UI-509 Select displayed and Invert are refused while points are hidden, with the reason; the tool reason keeps priority", () => {
  const store = withSel();
  expect(selectionDisabledReason(store.get())).toBeNull();
  store.set({ hidden: stashSelected(emptyHidden(), render(), "s1", 100, 2).hidden });
  expect(selectionDisabledReason(store.get())).toMatch(/Show the hidden points first/);
  store.set({ tool: "box" });
  expect(selectionDisabledReason(store.get())).toMatch(/Disarm the tool first/);
});

test("UI-510 Apply asks once more while points are hidden, with the exact text, and declining keeps the cloud", async () => {
  expect(applyNeedsHiddenConfirm(emptyHidden())).toBe(false);
  const hidden = stashSelected(emptyHidden(), render(), "s1", 100, 2).hidden;
  expect(applyNeedsHiddenConfirm(hidden)).toBe(true);
  const store = withSel({ hidden, candidate: { candidate_id: "c1", candidates: 1, cloud_revision: 1, params_revision: 1 } });
  store.update((s) => ({ ...s, session: { ...(s.session as never as Record<string, unknown>), revision: { cloud: 1, params: 1 } } as never }));
  const api = { apply: vi.fn(async () => sess(0)), refreshRender: vi.fn(async () => true) };
  const texts: string[] = [];
  const decline = createEditor(store, api as never, (m) => (texts.push(m), false));
  await decline.apply();
  expect(texts).toEqual(["2 points are hidden (view only); the selection may include hidden points inside the shape. Continue?"]);
  expect(api.apply).not.toHaveBeenCalled();
});

test("UI-511 a seed pick whose id is in the hidden set is refused with the info text", () => {
  const hidden = stashSelected(emptyHidden(), render(), "s1", 100, 2).hidden;
  expect(seedHiddenReason(hidden, 11)).toBe("That point is hidden");
  expect(seedHiddenReason(hidden, 10)).toBeNull();
  expect(seedHiddenReason(emptyHidden(), 11)).toBeNull();
});

test("UI-512 the hidden set is never persisted: not in the serialised client state and not restored", () => {
  const store = withSel({ hidden: stashSelected(emptyHidden(), render(), "s1", 100, 2).hidden });
  const text = JSON.stringify(serialiseClientState(store.get()));
  expect(text).not.toMatch(/hidden/i);
  const patch = restoreClientState({ v: 1, ui: { hidden: [1, 2] } } as never);
  expect(patch && "hidden" in patch).toBeFalsy();
});

test("UI-513 hide stashes the selected ids, clears the selection through the server route only and leaves the armed tool armed", async () => {
  const store = withSel({ tool: "box" });
  const clearSelection = vi.fn(async () => undefined);
  const hide = createHide(store, { clearSelection, refresh: async () => true });
  await hide.toggle();
  expect(clearSelection).toHaveBeenCalledTimes(1);
  expect(store.get().hidden.size).toBe(2);
  expect(store.get().tool).toBe("box");
  expect(store.get().notices.some((n) => n.code === "hide_partial")).toBe(false);
  await hide.toggle(); // now Show
  expect(store.get().hidden.size).toBe(0);
  expect(clearSelection).toHaveBeenCalledTimes(1);
  // a sample that misses selected points is reported
  const partial = withSel({ session: sess(500) });
  await createHide(partial, { clearSelection, refresh: async () => true }).toggle();
  expect(partial.get().notices.find((n) => n.code === "hide_partial")?.level).toBe("warn");
  // refused: nothing stashed, nothing cleared
  const none = withSel({ session: sess(0) });
  clearSelection.mockClear();
  await createHide(none, { clearSelection, refresh: async () => true }).toggle();
  expect(none.get().hidden.size).toBe(0);
  expect(clearSelection).not.toHaveBeenCalled();
});

test("UI-514 saving with hidden points says they are saved as visible; without them there is no such notice", async () => {
  const deps = { startSave: async () => ({ filename: "a.pcdsession", archiveId: "x" }) as never, markSaved: async () => sess(0) };
  const plain = withSel();
  await runSave(plain, deps);
  expect(plain.get().notices.some((n) => n.code === "hidden_saved")).toBe(false);
  const store = withSel({ hidden: stashSelected(emptyHidden(), render(), "s1", 100, 2).hidden });
  await runSave(store, deps);
  expect(store.get().notices.find((n) => n.code === "hidden_saved")?.text).toBe("2 hidden points are saved as visible");
});
