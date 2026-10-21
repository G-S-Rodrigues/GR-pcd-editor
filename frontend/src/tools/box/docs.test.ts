import { describe, expect, it } from "vitest";
import { FIELD_SPECS } from "../../ui/fields";
import { BOX_NOTE } from "../../ui/panels";
import { boxFromShape, quatToRpy, rpyToQuat, toBoxTool } from "./model";

describe("box text and shape contract (Part 14)", () => {
  it("UI-576 the panel note says arrows resize, the body moves, rings rotate, Ctrl orbits and keys nudge; it no longer says arrows move", () => {
    expect(BOX_NOTE).not.toMatch(/arrows? to move/i);
    expect(BOX_NOTE).toMatch(/arrow[^.]*resize/i);
    expect(BOX_NOTE).toMatch(/drag the box to move/i);
    expect(BOX_NOTE).toMatch(/ring[^.]*rotate/i);
    expect(BOX_NOTE).toMatch(/Ctrl/);
    expect(BOX_NOTE).toMatch(/Arrow keys/i);
  });

  it("UI-904 the Axes select is gone and the note names the small ring on an arrow", () => {
    expect(FIELD_SPECS.some((f) => f.id === "gizmo-frame")).toBe(false);
    expect(BOX_NOTE).toMatch(/small ring on an arrow/i);
    expect(BOX_NOTE).not.toMatch(/world axes/i);
  });

  it("UI-577 boxFromShape(toBoxTool(b)) round-trips random three-axis boxes within 1e-12 (the stored-shape contract of the history steps)", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let n = 0; n < 200; n++) {
      const rpy: [number, number, number] = [(rnd() - 0.5) * 340, (rnd() - 0.5) * 170, (rnd() - 0.5) * 340];
      const b = {
        center: [rnd() * 20 - 10, rnd() * 20 - 10, rnd() * 20 - 10] as [number, number, number],
        dimensions: [0.1 + rnd() * 5, 0.1 + rnd() * 5, 0.1 + rnd() * 5] as [number, number, number],
        quat: rpyToQuat(rpy),
        mode: "inside" as const,
      };
      const back = boxFromShape(toBoxTool(b));
      b.center.forEach((v, i) => expect(Math.abs(back.center[i] - v)).toBeLessThan(1e-12));
      b.dimensions.forEach((v, i) => expect(Math.abs(back.dimensions[i] - v)).toBeLessThan(1e-12));
      // same rotation: q and -q are the same orientation
      const sign = Math.sign(b.quat.reduce((a, v, i) => a + v * back.quat[i], 0)) || 1;
      b.quat.forEach((v, i) => expect(Math.abs(sign * back.quat[i] - v)).toBeLessThan(1e-12));
      quatToRpy(back.quat).forEach((v, i) => expect(Math.abs(v - rpy[i])).toBeLessThan(1e-9));
    }
  });
});
