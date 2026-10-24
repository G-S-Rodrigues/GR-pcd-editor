import { describe, expect, it } from "vitest";
import { emptyFilter, setSide } from "../inspector/filters";
import type { Bounds } from "../state/types";
import { boxView, nudgeValue, parseBoxInput } from "./view";

const B: Bounds = { min: [0, -5, 2], max: [10, 5, 12] };

describe("filter box view model", () => {
  it("UI-206 an inactive side shows the cloud bound; an active one its value, plain and rounded", () => {
    const m = setSide(emptyFilter(), B, "z", "min", 4.123456789).model;
    const a = boxView(m, B, "z", "min", false);
    expect(a.label).toBe("Z min");
    expect(a.valueText).toBe("4.123457");
    expect(a.ariaValueText).toBe("Z min 4.123457");
    expect(a.chipText).toBe("Z ≥ 4.123");
    expect(a.active).toBe(true);
    expect(a.collapsed).toBe(false);
    expect(a.disabled).toBe(false);
    expect([a.min, a.max, a.now]).toEqual([2, 12, 4.123456789]);
    const i = boxView(m, B, "z", "max", true);
    expect(i.valueText).toBe("12");
    expect(i.chipText).toBe("Z ≤ 12");
    expect(i.active).toBe(false);
    expect(i.collapsed).toBe(true);
    expect(i.classes).toBe("fbox collapsed");
    expect(a.classes).toBe("fbox active");
    expect(boxView(m, B, "z", "min", true).classes).toBe("fbox active collapsed");
  });

  it("UI-206 with no cloud every box is disabled and inactive", () => {
    const v = boxView(emptyFilter(), null, "x", "max", false);
    expect(v.disabled).toBe(true);
    expect(v.active).toBe(false);
    expect(v.classes).toBe("fbox disabled");
  });

  it("UI-206 typed text parses like the panel fields: blank and junk are rejected", () => {
    expect(parseBoxInput(" 3.5 ")).toEqual({ ok: true, value: 3.5 });
    expect(parseBoxInput("")).toEqual({ ok: false });
    expect(parseBoxInput("abc")).toEqual({ ok: false });
    expect(parseBoxInput("1e3")).toEqual({ ok: true, value: 1000 });
  });

  it("UI-207 keys nudge by 1% of the axis extent; Shift is a tenth, Page keys ten steps, Home and End the bounds", () => {
    const step = 0.1; // z extent 10
    const at = (key: string, shift = false) => nudgeValue(5, B, "z", key, shift);
    expect(at("ArrowRight")).toBeCloseTo(5 + step);
    expect(at("ArrowUp")).toBeCloseTo(5 + step);
    expect(at("ArrowLeft")).toBeCloseTo(5 - step);
    expect(at("ArrowDown")).toBeCloseTo(5 - step);
    expect(at("ArrowRight", true)).toBeCloseTo(5 + step / 10);
    expect(at("PageUp")).toBeCloseTo(5 + 10 * step);
    expect(at("PageDown")).toBeCloseTo(5 - 10 * step);
    expect(at("Home")).toBe(2);
    expect(at("End")).toBe(12);
    expect(at("a")).toBeNull();
    expect(at("Tab")).toBeNull();
    expect(nudgeValue(5, null, "z", "ArrowUp", false)).toBeNull();
  });
});
