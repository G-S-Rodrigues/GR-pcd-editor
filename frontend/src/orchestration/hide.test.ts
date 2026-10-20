import { expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { restoreClientState, serialiseClientState } from "../state/persist";
import { sessionFixture } from "../testing/fixtures";
import { TOOLTIPS } from "../ui/tooltips";
import { describeControls } from "../ui/describe";
import type { RenderData } from "../render/parse";
import type { SessionState } from "../state/types";
import { selectionDisabledReason } from "./selection";
import { createHide, hideState } from "./hide";
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
const hiddenSess = (selected: number, hidden: number): SessionState => {
  const s = sess(selected);
  return { ...s, counts: { ...s.counts, hidden } };
};
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
  store.set({ session: hiddenSess(2, 2) });
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

test("UI-509 Select displayed and Invert stay allowed while layers are hidden (the server excludes hidden points); the tool reason keeps priority", () => {
  const store = withSel({ session: hiddenSess(2, 2) });
  expect(selectionDisabledReason(store.get())).toBeNull();
  store.set({ tool: "box" });
  expect(selectionDisabledReason(store.get())).toMatch(/Disarm the tool first/);
});

test("UI-510 Apply asks nothing extra while layers are hidden (the candidate already excludes hidden points)", async () => {
  const store = withSel({ session: hiddenSess(2, 2), candidate: { candidate_id: "c1", candidates: 1, cloud_revision: 1, params_revision: 1 } });
  store.update((s) => ({ ...s, session: { ...(s.session as never as Record<string, unknown>), revision: { cloud: 1, params: 1 } } as never }));
  const api = { apply: vi.fn(async () => sess(0)), refreshRender: vi.fn(async () => true) };
  const texts: string[] = [];
  await createEditor(store, api as never, (m) => (texts.push(m), false)).apply();
  expect(texts).toEqual([]);
  expect(api.apply).toHaveBeenCalledTimes(1);
});

test("UI-512 nothing about hidden or layers is in the serialised client state, and nothing of the kind is restored", () => {
  const store = withSel({ session: hiddenSess(2, 2), layerUi: { editing: 3, active: 3 } });
  const text = JSON.stringify(serialiseClientState(store.get()));
  expect(text).not.toMatch(/hidden|layer/i);
  const patch = restoreClientState({ v: 1, ui: { hidden: [1, 2], layerUi: { editing: 3, active: 3 } } } as never);
  expect(patch && ("hidden" in patch || "layerUi" in patch)).toBeFalsy();
});

test("UI-513 hide makes one hideSelected call, raises no hide_partial notice and leaves the armed tool armed; refused cases call nothing", async () => {
  const store = withSel({ tool: "box" });
  const hideSelected = vi.fn(async () => undefined);
  const showAll = vi.fn(async () => undefined);
  const hide = createHide(store, { hideSelected, showAll });
  await hide.toggle();
  expect(hideSelected).toHaveBeenCalledTimes(1);
  expect(store.get().tool).toBe("box");
  expect(store.get().notices.some((n) => n.code === "hide_partial")).toBe(false);
  store.set({ session: hiddenSess(0, 2) });
  await hide.toggle(); // now Show
  expect(showAll).toHaveBeenCalledTimes(1);
  expect(hideSelected).toHaveBeenCalledTimes(1);
  const none = withSel({ session: sess(0) });
  hideSelected.mockClear();
  await createHide(none, { hideSelected, showAll }).toggle();
  expect(hideSelected).not.toHaveBeenCalled();
  expect(none.get().notices.find((n) => n.code === "hide_disabled")?.text).toBe("Select some points first");
});

test("UI-514 saving says nothing about hidden points, with or without hidden layers (they are saved now)", async () => {
  const deps = { startSave: async () => ({ filename: "a.pcdsession", archiveId: "x" }) as never, markSaved: async () => sess(0) };
  const plain = withSel();
  await runSave(plain, deps);
  expect(plain.get().notices.some((n) => n.code === "hidden_saved")).toBe(false);
  const store = withSel({ session: hiddenSess(2, 2) });
  await runSave(store, deps);
  expect(store.get().notices.some((n) => n.code === "hidden_saved")).toBe(false);
});
