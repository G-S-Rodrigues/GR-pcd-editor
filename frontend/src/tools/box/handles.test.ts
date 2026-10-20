import { describe, expect, it } from "vitest";
import { project } from "../../pick/ray";
import type { Vec3 } from "../../state/types";
import { applyPreset } from "../../view/presets";
import { defaultCamera } from "../../view/camera";
import { beginDrag, dragBox } from "./drag";
import type { Ray } from "./gizmo-math";
import { boxHandles, handleLength, hitHandle } from "./handles";
import { rotate } from "../../math/quat";
import { type BoxModel, defaultBox, quatToRpy, rpyToQuat } from "./model";

const mods = { symmetric: false, fine: false, snap: { on: false, step: 0.1, angleStep: 5 } };
const down = (x: number, y: number): Ray => ({ origin: [x, y, 10], dir: [0, 0, -1] });
const box = { ...defaultBox([0, 0, 0]), dimensions: [2, 2, 2] as Vec3 };
const topCam = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
const vp = { w: 800, h: 600 };

describe("box handles", () => {
  it("UI-552 an arrow drag resizes along its own axis only; snap and fine modifiers apply; the opposite face stays fixed on a rotated box", () => {
    const h = boxHandles(box, topCam, true).find((x) => x.id === "resize-0+")!;
    const d = beginDrag(h, box, down(h.anchor[0], 0));
    const grown = dragBox(d, down(h.anchor[0] + 2, 0), mods);
    expect(grown.dimensions[0]).toBeCloseTo(4, 12);
    expect(grown.center[0]).toBeCloseTo(1, 12);
    expect(dragBox(d, down(h.anchor[0] + 0.26, 0), { ...mods, snap: { on: true, step: 0.5, angleStep: 5 } }).dimensions[0]).toBeCloseTo(2.5, 12);
    expect(dragBox(d, down(h.anchor[0] + 2, 0), { ...mods, fine: true }).dimensions[0]).toBeCloseTo(2.2, 12);
    expect(dragBox(d, down(h.anchor[0] + 2, 5), mods).dimensions[1]).toBe(2); // only along the axis
    // a rotated box: the face opposite the dragged one does not move, the other dimensions and the orientation do not change
    const rot: BoxModel = { ...box, center: [1, -2, 3], dimensions: [2, 3, 4], quat: rpyToQuat([20, 30, 40]) };
    const face = (b: BoxModel, axis: number, sign: number): Vec3 => {
      const e = rotate(b.quat, [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0]);
      return [0, 1, 2].map((i) => b.center[i] + (sign * b.dimensions[axis] * e[i]) / 2) as Vec3;
    };
    const hm = boxHandles(rot, topCam, true).find((x) => x.id === "resize-1-")!;
    const perp: Vec3 = [0, 0, -1];
    const at = (p: Vec3, k: number): Ray => ({ origin: [p[0] + hm.dir[0] * k * -1 - perp[0] * 9, p[1] + hm.dir[1] * k * -1 - perp[1] * 9, p[2] + hm.dir[2] * k * -1 - perp[2] * 9], dir: perp });
    const dm = beginDrag(hm, rot, at(hm.anchor, 0));
    const r = dragBox(dm, at(hm.anchor, 0.7), mods); // 0.7 m outward along the minus-Y face normal
    expect(r.dimensions[1]).toBeGreaterThan(3);
    expect(r.dimensions[0]).toBe(2);
    expect(r.dimensions[2]).toBe(4);
    expect(r.quat).toEqual(rot.quat);
    const before = face(rot, 1, 1);
    const after = face(r, 1, 1);
    for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(before[i], 12);
    const sym = dragBox(dm, at(hm.anchor, 0.7), { ...mods, symmetric: true });
    for (let i = 0; i < 3; i++) expect(sym.center[i]).toBeCloseTo(rot.center[i], 12);
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

  it("UI-550 there are six resize arrows (resize-0+ .. resize-2-) and three rings, and no translate handle", () => {
    const hs = boxHandles(box, topCam, true);
    expect(hs.filter((x) => x.cls === "resize").map((x) => x.id).sort()).toEqual(["resize-0+", "resize-0-", "resize-1+", "resize-1-", "resize-2+", "resize-2-"]);
    expect(hs.filter((x) => x.cls === "rotate").map((x) => x.id).sort()).toEqual(["rotate-0", "rotate-1", "rotate-2"]);
    expect(hs.filter((x) => (x.cls as string) === "translate")).toHaveLength(0);
    expect(hs).toHaveLength(9);
  });

  it("UI-551 each arrow runs from its face centre outward by the fixed arrow length, on the box's own axes (also when the rings use world axes)", () => {
    const rot: BoxModel = { ...box, center: [1, 2, 3], dimensions: [2, 4, 6], quat: rpyToQuat([10, 20, 30]) };
    for (const local of [true, false]) {
      const len = handleLength(topCam, 720);
      for (const h of boxHandles(rot, topCam, local, 720).filter((x) => x.cls === "resize")) {
        const axis = rotate(rot.quat, [h.axis === 0 ? 1 : 0, h.axis === 1 ? 1 : 0, h.axis === 2 ? 1 : 0]);
        const out = [0, 1, 2].map((i) => h.sign * axis[i]);
        for (let i = 0; i < 3; i++) {
          expect(h.anchor[i]).toBeCloseTo(rot.center[i] + out[i] * (rot.dimensions[h.axis] / 2 + len), 12);
          expect(h.base![i]).toBeCloseTo(rot.center[i] + (out[i] * rot.dimensions[h.axis]) / 2, 12);
        }
      }
    }
  });

  it("UI-557 a ring drag about each of the three axes changes only the orientation", () => {
    for (const axis of [0, 1, 2] as const) {
      const h = boxHandles(box, topCam, true).find((x) => x.id === `rotate-${axis}`)!;
      const u: Vec3 = [(axis + 1) % 3 === 0 ? 1 : 0, (axis + 1) % 3 === 1 ? 1 : 0, (axis + 1) % 3 === 2 ? 1 : 0];
      const w: Vec3 = [(axis + 2) % 3 === 0 ? 1 : 0, (axis + 2) % 3 === 1 ? 1 : 0, (axis + 2) % 3 === 2 ? 1 : 0];
      const rayAt = (p: Vec3): Ray => ({ origin: [p[0] + h.dir[0] * 8, p[1] + h.dir[1] * 8, p[2] + h.dir[2] * 8], dir: [-h.dir[0], -h.dir[1], -h.dir[2]] });
      const d = beginDrag(h, box, rayAt(u.map((v) => v * 3) as Vec3));
      const r = dragBox(d, rayAt(w.map((v) => v * 3) as Vec3), mods);
      expect(r.center).toEqual(box.center);
      expect(r.dimensions).toEqual(box.dimensions);
      const rpy = quatToRpy(r.quat);
      expect(Math.abs(rpy[axis])).toBeCloseTo(90, 6);
      expect(rpy[(axis + 1) % 3]).toBeCloseTo(0, 6);
      expect(rpy[(axis + 2) % 3]).toBeCloseTo(0, 6);
    }
  });

  it("UI-558 turning about X, Y and Z and back returns the exact zero angles, with snap on and off", () => {
    for (const snapOn of [false, true]) {
      let b: BoxModel = box;
      const m = { ...mods, snap: { on: snapOn, step: 0.1, angleStep: 15 } };
      const turn = (axis: 0 | 1 | 2, from: Vec3, to: Vec3) => {
        const h = boxHandles(b, topCam, false).find((x) => x.id === `rotate-${axis}`)!;
        const rayAt = (p: Vec3): Ray => ({ origin: [b.center[0] + p[0] + h.dir[0] * 8, b.center[1] + p[1] + h.dir[1] * 8, b.center[2] + p[2] + h.dir[2] * 8], dir: [-h.dir[0], -h.dir[1], -h.dir[2]] });
        b = dragBox(beginDrag(h, b, rayAt(from)), rayAt(to), m);
      };
      turn(0, [0, 3, 0], [0, 0, 3]);
      turn(1, [3, 0, 0], [0, 0, -3]);
      turn(2, [3, 0, 0], [0, 3, 0]);
      expect(quatToRpy(b.quat).some((v) => v !== 0)).toBe(true);
      turn(2, [0, 3, 0], [3, 0, 0]);
      turn(1, [0, 0, -3], [3, 0, 0]);
      turn(0, [0, 0, 3], [0, 3, 0]);
      expect(quatToRpy(b.quat)).toEqual([0, 0, 0]);
    }
  });

  it("UI-559 an arrow beats a ring where they overlap, and the box body is not a handle", () => {
    const hs = boxHandles(box, topCam, true);
    const arrow = hs.find((x) => x.id === "resize-0+")!;
    const ringH = hs.find((x) => x.id === "rotate-2")!;
    const overlapped = hs.map((x) => (x === ringH ? { ...x, ring: [arrow.anchor] } : x));
    const s = project(topCam, arrow.anchor, [0, 0, 0], vp)!;
    expect(hitHandle(overlapped, topCam, vp, s.x, s.y)?.id).toBe("resize-0+");
    expect(hitHandle(overlapped.filter((x) => x.cls === "rotate"), topCam, vp, s.x, s.y)?.cls).toBe("rotate");
    const c = project(topCam, [0.5, 0.5, 0], [0, 0, 0], vp)!; // inside the box, away from every handle
    expect(hitHandle(hs, topCam, vp, c.x, c.y)).toBeNull();
  });
});
