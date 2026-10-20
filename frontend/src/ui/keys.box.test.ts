import { describe, expect, it } from "vitest";
import { KEY_DOCS, classifyKey } from "./keys";

const ev = (o: Partial<Parameters<typeof classifyKey>[0]>) => ({ key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: "BODY", boxTool: true, ...o });

describe("box keys (Part 14)", () => {
  it("UI-571 the nudge, grow and turn keys classify only with the Box tool in the edited view and never from a field, a button or a focused control", () => {
    for (const [e, id] of [
      [{ key: "ArrowLeft" }, "box-nudge"],
      [{ key: "ArrowUp", shiftKey: true }, "box-nudge"],
      [{ key: "PageUp" }, "box-nudge"],
      [{ key: "PageDown" }, "box-nudge"],
      [{ key: "ArrowRight", altKey: true }, "box-grow"],
      [{ key: "ArrowDown", altKey: true, shiftKey: true }, "box-grow"],
      [{ key: "." }, "box-turn"],
      [{ key: "," }, "box-turn"],
      [{ key: ">", shiftKey: true }, "box-turn"],
      [{ key: "<", shiftKey: true }, "box-turn"],
      [{ key: ".", ctrlKey: true, shiftKey: true }, "box-turn"],
    ] as const) {
      expect(classifyKey(ev(e))).toBe(id);
      expect(classifyKey(ev({ ...e, boxTool: false }))).toBeNull();
      expect(classifyKey(ev({ ...e, boxTool: undefined }))).toBeNull();
      for (const target of ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "DIV", "A"]) expect(classifyKey(ev({ ...e, target }))).toBeNull();
      expect(classifyKey(ev({ ...e, target: "CANVAS" }))).toBe(id);
    }
    // the existing keys do not change meaning
    expect(classifyKey(ev({ key: "z", ctrlKey: true }))).toBe("undo");
    expect(classifyKey(ev({ key: "f", altKey: true }))).toBe("fit-selection");
    expect(classifyKey(ev({ key: "." , ctrlKey: true }))).toBeNull(); // Ctrl alone is not a turn
    expect(classifyKey(ev({ key: "ArrowRight", ctrlKey: true }))).toBeNull();
  });

  it("UI-575 the help table documents each box key, with its step names", () => {
    const rows = Object.fromEntries(KEY_DOCS.filter((d) => d.id.startsWith("box-")).map((d) => [d.id, d]));
    expect(Object.keys(rows).sort()).toEqual(["box-grow", "box-nudge", "box-turn"]);
    expect(rows["box-nudge"].keys).toMatch(/Arrow/);
    expect(rows["box-nudge"].label).toMatch(/Step/);
    expect(rows["box-grow"].keys).toMatch(/Alt/);
    expect(rows["box-turn"].keys).toMatch(/\./);
    expect(rows["box-turn"].label).toMatch(/Angle step/);
    for (const d of Object.values(rows)) expect(d.label).toMatch(/Box tool/);
  });
});
