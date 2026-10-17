import { describe, expect, it } from "vitest";
import { project } from "../../pick/ray";
import type { Vec3 } from "../../state/types";
import { applyPreset } from "../../view/presets";
import { defaultCamera } from "../../view/camera";
import { beginDrag, dragBox } from "./drag";
import type { Ray } from "./gizmo-math";
import { boxHandles, hitHandle } from "./handles";
import { defaultBox, quatToRpy } from "./model";

const mods = { symmetric: false, fine: false, snap: { on: false, step: 0.1, angleStep: 5 } };
const down = (x: number, y: number): Ray => ({ origin: [x, y, 10], dir: [0, 0, -1] });
const box = { ...defaultBox([0, 0, 0]), dimensions: [2, 2, 2] as Vec3 };
const topCam = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
const vp = { w: 800, h: 600 };

describe("box handles", () => {
  it("translate drag moves the centre along the axis; snap and fine modifiers apply", () => {
    const h = boxHandles(box, topCam, true).find((x) => x.cls === "translate" && x.axis === 0)!;
    const d = beginDrag(h, box, down(0, 0));
    expect(dragBox(d, down(2, 0), mods).center).toEqual([2, 0, 0]);
    expect(dragBox(d, down(0.26, 0), { ...mods, snap: { on: true, step: 0.5, angleStep: 5 } }).center[0]).toBeCloseTo(0.5, 12);
    expect(dragBox(d, down(2, 0), { ...mods, fine: true }).center[0]).toBeCloseTo(0.2, 12);
    expect(dragBox(d, down(2, 5), mods).center[1]).toBe(0); // only along the axis
  });

  it("resize drag keeps the opposite face; Alt resizes symmetrically", () => {
    const h = boxHandles(box, topCam, true).find((x) => x.cls === "resize" && x.axis === 0 && x.sign === 1)!;
    const d = beginDrag(h, box, down(1, 0));
    const r = dragBox(d, down(2, 0), mods);
    expect(r.dimensions[0]).toBeCloseTo(3, 12);
    expect(r.center[0]).toBeCloseTo(0.5, 12);
    const s = dragBox(d, down(2, 0), { ...mods, symmetric: true });
    expect(s.dimensions[0]).toBeCloseTo(4, 12);
    expect(s.center).toEqual([0, 0, 0]);
  });

  it("rotate drag turns the box about the ring axis by the dragged angle", () => {
    const h = boxHandles(box, topCam, true).find((x) => x.cls === "rotate" && x.axis === 2)!;
    const d = beginDrag(h, box, down(3, 0));
    const r = dragBox(d, down(0, 3), mods);
    expect(quatToRpy(r.quat)[2]).toBeCloseTo(90, 6);
    expect(r.center).toEqual([0, 0, 0]);
    const sn = dragBox(d, down(3, 2.9), { ...mods, snap: { on: true, step: 0.1, angleStep: 45 } });
    expect(quatToRpy(sn.quat)[2]).toBeCloseTo(45, 6);
  });

  it("hit testing finds a handle near its screen anchor and nothing far away", () => {
    const hs = boxHandles(box, topCam, true);
    const face = hs.find((x) => x.cls === "resize" && x.axis === 0 && x.sign === 1)!;
    const s = project(topCam, face.anchor, [0, 0, 0], vp)!;
    expect(hitHandle(hs, topCam, vp, s.x + 3, s.y + 2)?.id).toBe(face.id);
    expect(hitHandle(hs, topCam, vp, 5, 5)).toBeNull();
  });
});
