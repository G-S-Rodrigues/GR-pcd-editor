import { expect, test } from "vitest";
import { PRESET_ORDER } from "../view/presets";
import { describeControls } from "./describe";
import { VIEW_KEYS, presetForKey } from "./keys";
import { TOOLTIPS } from "./tooltips";

test("UI-133 keys 1-6 map to the six presets in order", () => {
  expect(VIEW_KEYS.map((k) => k.key)).toEqual(["1", "2", "3", "4", "5", "6"]);
  PRESET_ORDER.forEach((p, i) => expect(presetForKey(String(i + 1))).toBe(p));
  expect(presetForKey("7")).toBeNull();
  expect(presetForKey("a")).toBeNull();
});

test("UI-133 the six view buttons are gone; the six ViewCube faces are described and have tooltips", () => {
  const ids = describeControls().map((c) => c.id);
  for (const p of PRESET_ORDER) {
    expect(ids).not.toContain(`view-${p}`);
    expect(TOOLTIPS[`view-${p}`]).toBeUndefined();
    expect(ids).toContain(`cube-${p}`);
    expect(TOOLTIPS[`cube-${p}`]).toMatch(/key [1-6]/);
  }
  expect(ids).toContain("view-perspective");
});

import { KEY_DOCS, classifyKey, helpOpenAfter } from "./keys";

const ev = (o: Partial<Parameters<typeof classifyKey>[0]>) => ({ key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: "BODY", ...o });

test("UI-140 the key table has no duplicate keys and every documented key classifies to its own handler id", () => {
  const ids = KEY_DOCS.map((d) => d.id);
  expect(new Set(ids).size).toBe(ids.length);
  const shown = KEY_DOCS.map((d) => d.keys);
  expect(new Set(shown).size).toBe(shown.length);
  const probes = KEY_DOCS.flatMap((d) => d.probes.map((p) => ({ id: d.id, p })));
  expect(probes.length).toBeGreaterThanOrEqual(KEY_DOCS.length);
  for (const { id, p } of probes) expect(classifyKey(ev(p))).toBe(id);
  // no two documented ids answer to the same key event
  const seen = new Map<string, string>();
  for (const { id, p } of probes) {
    const k = JSON.stringify(p);
    expect(seen.get(k) ?? id).toBe(id);
    seen.set(k, id);
  }
  for (const want of ["undo", "redo", "help", "perspective", "fit", "fit-selection", "rect", "polygon-close", "cancel", "apply"]) {
    expect(ids).toContain(want);
  }
});

test("UI-140 typing in a field never triggers a view or edit key", () => {
  for (const key of ["1", "p", "f", "o", "r", "[", "?", "Delete", "Enter"]) expect(classifyKey(ev({ key, target: "INPUT" }))).toBeNull();
  expect(classifyKey(ev({ key: "z", ctrlKey: true, target: "INPUT" }))).toBeNull();
  expect(classifyKey(ev({ key: "7" }))).toBeNull();
  expect(classifyKey(ev({ key: "1", ctrlKey: true }))).toBeNull();
});

test("UI-141 ? toggles the help overlay, Escape closes it, other keys leave it alone", () => {
  expect(helpOpenAfter(false, "help")).toBe(true);
  expect(helpOpenAfter(true, "help")).toBe(false);
  expect(helpOpenAfter(true, "cancel")).toBe(false);
  expect(helpOpenAfter(false, "cancel")).toBe(false);
  expect(helpOpenAfter(true, "fit")).toBe(true);
  expect(classifyKey(ev({ key: "?", shiftKey: true }))).toBe("help");
});

test("UI-418 the Esc row says it discards a pending draft", () => {
  expect(KEY_DOCS.find((d) => d.id === "cancel")!.label).toContain("discard a pending draft");
});

test("UI-664 Backspace is the polygon vertex removal key, Delete stays Apply, typing in a field ignores both", () => {
  expect(classifyKey(ev({ key: "Backspace" }))).toBe("polygon-remove-vertex");
  expect(classifyKey(ev({ key: "Delete" }))).toBe("apply");
  expect(classifyKey(ev({ key: "Backspace", target: "INPUT" }))).toBeNull();
  const doc = KEY_DOCS.find((d) => d.id === "polygon-remove-vertex")!;
  expect(doc.keys).toBe("Backspace");
  expect(doc.label).toMatch(/edit mode/);
  expect(KEY_DOCS.find((d) => d.id === "cancel")!.label).toContain("leave polygon edit mode");
});
