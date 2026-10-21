import { describe, expect, it } from "vitest";
import { dot, length, sub } from "../../math/vec";
import { project } from "../../pick/ray";
import type { Vec3 } from "../../state/types";
import { defaultCamera } from "../../view/camera";
import { applyPreset } from "../../view/presets";
import { BOX_ARROW_COLOUR, BOX_RING_COLOUR, boxOverlaySpec } from "./overlay";
import { HANDLE_ARROW_PX } from "./handles";
import { type BoxModel, defaultBox, rpyToQuat } from "./model";

const zero: Vec3 = [0, 0, 0];
const vp = { w: 1280, h: 720 };
const cam = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
const box: BoxModel = { ...defaultBox([1, 2, 3]), dimensions: [2, 3, 4], quat: rpyToQuat([10, 20, 30]) };

describe("box overlay (Part 14)", () => {
  it("UI-569 six arrows from the face centre to a tip 72 px out with a head, six rings, the documented colours, and no centre-to-tip line", () => {
    const spec = boxOverlaySpec(box, cam, null, vp.h);
    expect(spec.arrows.map((a) => a.id).sort()).toEqual(["resize-0+", "resize-0-", "resize-1+", "resize-1-", "resize-2+", "resize-2-"]);
    expect(spec.rings.map((r) => r.id).sort()).toEqual(["rotate-0+", "rotate-0-", "rotate-1+", "rotate-1-", "rotate-2+", "rotate-2-"]);
    for (const a of spec.arrows) {
      expect(a.colour).toBe(BOX_ARROW_COLOUR);
      const axis = Number(a.id[7]);
      // the arrow starts on its face (half the dimension from the centre along the box's own axis), not at the box centre
      expect(length(sub(a.base, box.center))).toBeCloseTo(box.dimensions[axis] / 2, 9);
      const s0 = project(cam, a.base, zero, vp)!;
      const s1 = project(cam, a.tip, zero, vp)!;
      // seen from the top an arrow in the picture plane is 72 px long; one pointing at the eye is shorter, none is longer
      expect(Math.hypot(s1.x - s0.x, s1.y - s0.y)).toBeLessThanOrEqual(HANDLE_ARROW_PX + 1e-6);
      expect(length(sub(a.tip, a.base))).toBeGreaterThan(0);
      // a head: two barbs behind the tip, symmetric about the shaft
      expect(a.barbs).toHaveLength(2);
      const dir = sub(a.tip, a.base);
      for (const b of a.barbs) expect(dot(sub(b, a.tip), dir)).toBeLessThan(0);
    }
    for (const r of spec.rings) expect(r.colour).toBe(BOX_RING_COLOUR);
    expect(spec.arrows.every((a) => a.base !== a.tip)).toBe(true);
    const flat = (box.center as Vec3).toString();
    expect(spec.arrows.some((a) => a.base.toString() === flat)).toBe(false); // nothing starts at the centre: the old move arrow is gone
  });

  it("UI-570 the hovered arrow or ring is drawn heavier; the rest keep the normal width", () => {
    const base = boxOverlaySpec(box, cam, null, vp.h);
    const hot = boxOverlaySpec(box, cam, "resize-1-", vp.h);
    const w0 = base.arrows.find((a) => a.id === "resize-1-")!.width;
    expect(hot.arrows.find((a) => a.id === "resize-1-")!.width).toBeGreaterThan(w0);
    for (const a of hot.arrows.filter((x) => x.id !== "resize-1-")) expect(a.width).toBe(base.arrows.find((x) => x.id === a.id)!.width);
    const ring = boxOverlaySpec(box, cam, "rotate-0+", vp.h);
    expect(ring.rings.find((r) => r.id === "rotate-0+")!.width).toBeGreaterThan(base.rings[0].width);
    expect(ring.rings.filter((r) => r.id !== "rotate-0+").every((r) => r.width === base.rings[0].width)).toBe(true);
  });
});
