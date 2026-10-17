import { expect, test } from "vitest";
import { applyClientPatch, restoreClientState, serialiseClientState } from "../state/persist";
import { createAppStore } from "../state/app";
import { SECTION_IDS, isSectionOpen, setSectionOpen } from "./sections";

test("UI-230 every inspector section starts open and the ids avoid the UI-92 words", () => {
  const s = createAppStore().get();
  for (const id of SECTION_IDS) {
    expect(isSectionOpen(s.sectionsOpen, id)).toBe(true);
    expect(id).not.toMatch(/filters|protection/);
  }
  expect(new Set(SECTION_IDS).size).toBe(SECTION_IDS.length);
});

test("UI-231 setSectionOpen changes one section and leaves the rest and the input alone", () => {
  const a = createAppStore().get().sectionsOpen;
  const b = setSectionOpen(a, "slice", false);
  expect(isSectionOpen(b, "slice")).toBe(false);
  expect(isSectionOpen(b, "history")).toBe(true);
  expect(isSectionOpen(a, "slice")).toBe(true);
  expect(setSectionOpen(b, "slice", true)).toEqual({});
});

test("UI-232 section state is saved and restored, old sessions and bad content give all open", () => {
  const a = createAppStore();
  a.update((s) => ({ ...s, sectionsOpen: setSectionOpen(setSectionOpen(s.sectionsOpen, "box", false), "history", false) }));
  const saved = JSON.parse(JSON.stringify(serialiseClientState(a.get())));
  expect(JSON.stringify(saved)).not.toMatch(/filters|protection/);
  const patch = restoreClientState(saved);
  const out = applyClientPatch(createAppStore().get(), patch!);
  expect(isSectionOpen(out.sectionsOpen, "box")).toBe(false);
  expect(isSectionOpen(out.sectionsOpen, "history")).toBe(false);
  expect(isSectionOpen(out.sectionsOpen, "slice")).toBe(true);
  const old = applyClientPatch(createAppStore().get(), restoreClientState({ v: 1, ui: {} })!);
  expect(old.sectionsOpen).toEqual({});
  const bad = restoreClientState({ v: 1, ui: { sectionsOpen: { nope: false, box: "x", slice: false } } });
  expect(bad?.sectionsOpen).toEqual({ slice: false });
  expect(restoreClientState({ v: 1, ui: { sectionsOpen: [1] } })?.sectionsOpen).toBeUndefined();
});
