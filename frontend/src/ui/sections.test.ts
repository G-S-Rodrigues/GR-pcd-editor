import { expect, test } from "vitest";
import { applyClientPatch, restoreClientState, serialiseClientState } from "../state/persist";
import { createAppStore } from "../state/app";
import { foldSyncStep, foldSyncer } from "./fold";
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
  const b = setSectionOpen(a, "history", false);
  expect(isSectionOpen(b, "history")).toBe(false);
  expect(isSectionOpen(b, "box")).toBe(true);
  expect(isSectionOpen(a, "history")).toBe(true);
  expect(setSectionOpen(b, "history", true)).toEqual({});
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
  expect(isSectionOpen(out.sectionsOpen, "polygon")).toBe(true);
  const old = applyClientPatch(createAppStore().get(), restoreClientState({ v: 1, ui: {} })!);
  expect(old.sectionsOpen).toEqual({});
  const bad = restoreClientState({ v: 1, ui: { sectionsOpen: { nope: false, box: "x", history: false, slice: false } } });
  expect(bad?.sectionsOpen).toEqual({ history: false }); // the removed slice section id is ignored too
  expect(restoreClientState({ v: 1, ui: { sectionsOpen: [1] } })?.sectionsOpen).toBeUndefined();
});

test("UI-233 a store update never writes the element back while the store value is unchanged (lost-click race)", () => {
  // the user flips el.open to false; the queued toggle has not stored it yet, an unrelated update runs sync
  expect(foldSyncStep(true, true, false)).toEqual({ write: false, last: true });
  // the first sync applies the store value, and a real store change is applied
  expect(foldSyncStep(undefined, false, true)).toEqual({ write: true, last: false });
  expect(foldSyncStep(false, true, false)).toEqual({ write: true, last: true });
  // nothing to write when the element already matches
  expect(foldSyncStep(false, true, true)).toEqual({ write: false, last: true });
});

test("UI-234 foldSyncer keeps the user's flip through repeated unrelated syncs, then follows the store", () => {
  const store = createAppStore();
  const el = { open: true };
  const sync = foldSyncer(el, (s) => isSectionOpen(s.sectionsOpen, "history"));
  sync(store.get());
  el.open = false; // user click, toggle event still queued
  sync(store.get());
  sync(store.get());
  expect(el.open).toBe(false);
  store.update((s) => ({ ...s, sectionsOpen: setSectionOpen(s.sectionsOpen, "history", false) })); // the toggle handler arrives
  sync(store.get());
  expect(el.open).toBe(false);
  store.update((s) => ({ ...s, sectionsOpen: setSectionOpen(s.sectionsOpen, "history", true) })); // a session reopen
  sync(store.get());
  expect(el.open).toBe(true);
});
