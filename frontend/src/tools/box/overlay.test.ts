import { describe, expect, it } from "vitest";
import { dot, length, sub } from "../../math/vec";
import { project } from "../../pick/ray";
import type { Vec3 } from "../../state/types";
import { defaultCamera } from "../../view/camera";
import { applyPreset } from "../../view/presets";
import { AXIS_COLOUR } from "../../filterboxes/plane";
import { ARROW_HEAD_HALF_PX, ARROW_HEAD_LEN_PX, ARROW_WIDTH_HOVER_PX, ARROW_WIDTH_PX, RING_TINT, RING_WIDTH_HOVER_PX, RING_WIDTH_PX, boxOverlaySpec, dim } from "./overlay";
import { HANDLE_ARROW_PX, boxHandles } from "./handles";
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
      const axis = Number(a.id[7]);
      expect(a.colour).toBe(AXIS_COLOUR[(["x", "y", "z"] as const)[axis]]);
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
    for (const r of spec.rings) expect(r.colour).toBe(dim(AXIS_COLOUR[(["x", "y", "z"] as const)[Number(r.id[7])]], RING_TINT));
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

  const lum = (c: number) => {
    const f = (v: number) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f((c >> 16) & 255) + 0.7152 * f((c >> 8) & 255) + 0.0722 * f(c & 255);
  };
  const contrast = (a: number, b: number) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

  it("UI-903 arrows are axis-coloured, 3 px (4.5 hovered) with a 14 x 10 px filled head; rings are 32 points about their centre in 75% of the axis colour, full colour and 3.5 px hovered; edge-on rings stay in the spec", () => {
    const flat: BoxModel = { ...defaultBox([0, 0, 0]), dimensions: [4, 4, 2] };
    const spec = boxOverlaySpec(flat, cam, null, vp.h);
    const a = spec.arrows.find((x) => x.id === "resize-0+")!;
    expect(ARROW_WIDTH_PX).toBe(3);
    expect(ARROW_WIDTH_HOVER_PX).toBe(4.5);
    expect(a.width).toBe(3);
    const px = (p: Vec3) => project(cam, p, zero, vp)!;
    const tip = px(a.tip);
    const hb = px(a.headBase);
    expect(Math.hypot(tip.x - hb.x, tip.y - hb.y)).toBeCloseTo(ARROW_HEAD_LEN_PX, 6);
    expect(ARROW_HEAD_LEN_PX).toBe(14);
    expect(ARROW_HEAD_HALF_PX).toBe(5);
    for (const b of a.barbs) {
      const q = px(b);
      expect(Math.hypot(q.x - hb.x, q.y - hb.y)).toBeCloseTo(ARROW_HEAD_HALF_PX, 6);
      expect(Math.hypot(q.x - tip.x, q.y - tip.y)).toBeGreaterThan(ARROW_HEAD_LEN_PX - 1e-6); // behind the tip
    }
    expect(spec.rings).toHaveLength(6);
    for (const r of spec.rings) {
      expect(r.pts).toHaveLength(32);
      const h = boxHandles(flat, cam, vp.h).find((x) => x.id === r.id)!;
      const mean = [0, 1, 2].map((k) => r.pts.reduce((acc, p) => acc + p[k], 0) / 32);
      for (let k = 0; k < 3; k++) expect(mean[k]).toBeCloseTo(h.centre![k], 9);
      expect(r.width).toBe(RING_WIDTH_PX);
    }
    expect(RING_WIDTH_PX).toBe(2);
    expect(RING_WIDTH_HOVER_PX).toBe(3.5);
    expect(spec.rings.find((r) => r.id === "rotate-0+")!.colour).toBe(0xbf4040);
    expect(spec.rings.find((r) => r.id === "rotate-1+")!.colour).toBe(0x40bf40);
    expect(spec.rings.find((r) => r.id === "rotate-2+")!.colour).toBe(0x4073bf);
    const hot = boxOverlaySpec(flat, cam, "rotate-1-", vp.h).rings.find((r) => r.id === "rotate-1-")!;
    expect(hot.colour).toBe(AXIS_COLOUR.y);
    expect(hot.width).toBe(3.5);
    // the side view makes the X rings edge-on lines: still drawn
    const side = boxOverlaySpec(flat, applyPreset({ ...defaultCamera(), distance: 10 }, "right"), null, vp.h);
    expect(side.rings).toHaveLength(6);
  });

  it("UI-906 against the clear colour 0x15181d every ring colour has contrast >= 3 and every arrow colour >= 4.5", () => {
    const clear = 0x15181d;
    const spec = boxOverlaySpec(box, cam, null, vp.h);
    for (const r of spec.rings) expect(contrast(r.colour, clear), r.id).toBeGreaterThanOrEqual(3);
    for (const a of spec.arrows) expect(contrast(a.colour, clear), a.id).toBeGreaterThanOrEqual(4.5);
    for (const r of boxOverlaySpec(box, cam, "rotate-0+", vp.h).rings) expect(contrast(r.colour, clear), r.id).toBeGreaterThanOrEqual(3);
  });
});
