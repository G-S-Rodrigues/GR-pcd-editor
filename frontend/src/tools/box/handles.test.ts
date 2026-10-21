import { describe, expect, it } from "vitest";
import { project } from "../../pick/ray";
import { screenRay } from "../../pick/screenray";
import { fromAxisAngle, mul } from "../../math/quat";
import { RING_DEADZONE_PX, RING_PICK_EDGE_ON } from "./handles";
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
    const h = boxHandles(box, topCam).find((x) => x.id === "resize-0+")!;
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
    const hm = boxHandles(rot, topCam).find((x) => x.id === "resize-1-")!;
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
    const h = boxHandles(box, topCam).find((x) => x.cls === "resize" && x.axis === 0 && x.sign === 1)!;
    const d = beginDrag(h, box, down(1, 0));
    const r = dragBox(d, down(2, 0), mods);
    expect(r.dimensions[0]).toBeCloseTo(3, 12);
    expect(r.center[0]).toBeCloseTo(0.5, 12);
    const s = dragBox(d, down(2, 0), { ...mods, symmetric: true });
    expect(s.dimensions[0]).toBeCloseTo(4, 12);
    expect(s.center).toEqual([0, 0, 0]);
  });

  it("rotate drag turns the box about the ring axis by the dragged angle", () => {
    const h = boxHandles(box, topCam).find((x) => x.id === "rotate-2+")!;
    const d = beginDrag(h, box, down(3, 0));
    const r = dragBox(d, down(0, 3), mods);
    expect(quatToRpy(r.quat)[2]).toBeCloseTo(90, 6);
    expect(r.center).toEqual([0, 0, 0]);
    const sn = dragBox(d, down(3, 2.9), { ...mods, snap: { on: true, step: 0.1, angleStep: 45 } });
    expect(quatToRpy(sn.quat)[2]).toBeCloseTo(45, 6);
  });

  it("hit testing finds a handle near its screen anchor and nothing far away", () => {
    const hs = boxHandles(box, topCam);
    const face = hs.find((x) => x.cls === "resize" && x.axis === 0 && x.sign === 1)!;
    const s = project(topCam, face.anchor, [0, 0, 0], vp)!;
    expect(hitHandle(hs, topCam, vp, s.x + 3, s.y + 2)?.id).toBe(face.id);
    expect(hitHandle(hs, topCam, vp, 5, 5)).toBeNull();
  });

  it("UI-550 there are six resize arrows (resize-0+ .. resize-2-) and six rings (rotate-0+ .. rotate-2-), one on each arrow, and no translate handle", () => {
    const hs = boxHandles(box, topCam);
    expect(hs.filter((x) => x.cls === "resize").map((x) => x.id).sort()).toEqual(["resize-0+", "resize-0-", "resize-1+", "resize-1-", "resize-2+", "resize-2-"]);
    expect(hs.filter((x) => x.cls === "rotate").map((x) => x.id).sort()).toEqual(["rotate-0+", "rotate-0-", "rotate-1+", "rotate-1-", "rotate-2+", "rotate-2-"]);
    expect(hs.filter((x) => (x.cls as string) === "translate")).toHaveLength(0);
    expect(hs).toHaveLength(12);
  });

  it("UI-551 each arrow runs from its face centre outward by the fixed arrow length, on the box's own axes", () => {
    const rot: BoxModel = { ...box, center: [1, 2, 3], dimensions: [2, 4, 6], quat: rpyToQuat([10, 20, 30]) };
    const len = handleLength(topCam, 720);
    for (const h of boxHandles(rot, topCam, 720).filter((x) => x.cls === "resize")) {
      const axis = rotate(rot.quat, [h.axis === 0 ? 1 : 0, h.axis === 1 ? 1 : 0, h.axis === 2 ? 1 : 0]);
      const out = [0, 1, 2].map((i) => h.sign * axis[i]);
      for (let i = 0; i < 3; i++) {
        expect(h.anchor[i]).toBeCloseTo(rot.center[i] + out[i] * (rot.dimensions[h.axis] / 2 + len), 12);
        expect(h.base![i]).toBeCloseTo(rot.center[i] + (out[i] * rot.dimensions[h.axis]) / 2, 12);
      }
    }
  });

  it("UI-557 a ring drag about each of the three axes, on the + and the - ring, changes only the orientation", () => {
    for (const axis of [0, 1, 2] as const) {
      for (const tag of ["+", "-"]) {
        const h = boxHandles(box, topCam).find((x) => x.id === `rotate-${axis}${tag}`)!;
        const { u, w } = plane(h.dir);
        const rayAt = (p: Vec3): Ray => ({ origin: [p[0] + h.dir[0] * 8, p[1] + h.dir[1] * 8, p[2] + h.dir[2] * 8], dir: [-h.dir[0], -h.dir[1], -h.dir[2]] });
        const at = (v: Vec3): Vec3 => [h.centre![0] + v[0] * 3, h.centre![1] + v[1] * 3, h.centre![2] + v[2] * 3];
        const d = beginDrag(h, box, rayAt(at(u)));
        const r = dragBox(d, rayAt(at(w)), mods);
        expect(r.center).toEqual(box.center);
        expect(r.dimensions).toEqual(box.dimensions);
        const rpy = quatToRpy(r.quat);
        expect(Math.abs(rpy[axis])).toBeCloseTo(90, 6);
        expect(rpy[(axis + 1) % 3]).toBeCloseTo(0, 6);
        expect(rpy[(axis + 2) % 3]).toBeCloseTo(0, 6);
      }
    }
  });

  it("UI-558 turning about X, Y and Z (each ring of the current box) and back returns the exact zero angles, with snap on and off", () => {
    for (const snapOn of [false, true]) {
      let b: BoxModel = box;
      const m = { ...mods, snap: { on: snapOn, step: 0.1, angleStep: 15 } };
      const turn = (axis: 0 | 1 | 2, forward: boolean) => {
        const h = boxHandles(b, topCam).find((x) => x.id === `rotate-${axis}+`)!;
        const { u, w } = plane(h.dir);
        const from = forward ? u : w;
        const to = forward ? w : u;
        const rayAt = (v: Vec3): Ray => ({ origin: [h.centre![0] + v[0] * 3 + h.dir[0] * 8, h.centre![1] + v[1] * 3 + h.dir[1] * 8, h.centre![2] + v[2] * 3 + h.dir[2] * 8], dir: [-h.dir[0], -h.dir[1], -h.dir[2]] });
        b = dragBox(beginDrag(h, b, rayAt(from)), rayAt(to), m);
      };
      turn(0, true);
      turn(1, true);
      turn(2, true);
      expect(quatToRpy(b.quat).some((v) => v !== 0)).toBe(true);
      turn(2, false);
      turn(1, false);
      turn(0, false);
      expect(quatToRpy(b.quat)).toEqual([0, 0, 0]);
    }
  });

  it("UI-559 a ring beats an arrow where they overlap; a point in an arrow's tip disc outside the ring band gets the arrow; the box body is not a handle", () => {
    const hs = boxHandles(box, topCam);
    const arrow = hs.find((x) => x.id === "resize-0+")!;
    const ring = hs.find((x) => x.id === "rotate-2+")!;
    // slide the arrow's grab point onto the ring outline: the ring wins
    const onRing = project(topCam, ring.ring![0], [0, 0, 0], vp)!;
    const moved = hs.map((x) => (x === arrow ? { ...x, anchor: ring.ring![0] } : x));
    expect(hitHandle(moved, topCam, vp, onRing.x, onRing.y)?.id).toBe("rotate-2+");
    // the real arrow tip is far from every ring: the arrow
    const s = project(topCam, arrow.anchor, [0, 0, 0], vp)!;
    expect(hitHandle(hs, topCam, vp, s.x + 3, s.y)?.id).toBe("resize-0+");
    const c = project(topCam, [0.5, 0.5, 0], [0, 0, 0], vp)!; // inside the box, away from every handle
    expect(hitHandle(hs, topCam, vp, c.x, c.y)).toBeNull();
  });

  it("UI-578 a ring seen edge-on is never picked: in a side view a press on the ring that faces the camera grabs it, a press on an edge-on tick grabs nothing", () => {
    const rightCam = applyPreset({ ...defaultCamera(), distance: 10 }, "right");
    const hs = boxHandles(box, rightCam);
    // looking along -X, the X rings are circles and the Y and Z rings are straight ticks through the arrows
    const faces = hs.find((x) => x.id === "rotate-0+")!;
    const s = project(rightCam, faces.ring![0], [0, 0, 0], vp)!;
    expect(hitHandle(hs, rightCam, vp, s.x, s.y)?.id).toBe("rotate-0+"); // the two X rings coincide: the one whose arrow points at the eye
    const edge = hs.find((x) => x.id === "rotate-2+")!;
    const t = project(rightCam, edge.centre!, [0, 0, 0], vp)!;
    expect(hitHandle(hs.filter((x) => x.cls === "rotate" && x.axis === 2), rightCam, vp, t.x, t.y)).toBeNull();
  });
});

/** Two unit vectors u, w spanning the plane normal to `dir`, with w = dir x u (so u -> w is +90 degrees about dir). */
function plane(dir: Vec3): { u: Vec3; w: Vec3 } {
  const helper: Vec3 = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const c = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const u0 = c(helper, dir);
  const l = Math.hypot(...u0);
  const u: Vec3 = [u0[0] / l, u0[1] / l, u0[2] / l];
  return { u, w: c(dir, u) };
}

describe("ring picking and dragging (Part 14b)", () => {
  const ringAt = (cam: typeof topCam, id: string) => {
    const hs = boxHandles(box, cam);
    return { hs, h: hs.find((x) => x.id === id)! };
  };

  it("UI-897 the front-most ring wins where the + and - rings coincide, and an end-on arrow is skipped", () => {
    // from the top both Z rings project to the same circle: the + ring (its arrow points at the eye) wins
    const { hs, h } = ringAt(topCam, "rotate-2+");
    const q = project(topCam, h.ring![5], [0, 0, 0], vp)!;
    expect(hitHandle(hs, topCam, vp, q.x, q.y)?.id).toBe("rotate-2+");
    const bottomCam = applyPreset({ ...defaultCamera(), distance: 10 }, "bottom");
    const b = ringAt(bottomCam, "rotate-2-");
    const qb = project(bottomCam, b.h.ring![5], [0, 0, 0], vp)!;
    expect(hitHandle(b.hs, bottomCam, vp, qb.x, qb.y)?.id).toBe("rotate-2-");
    // the Z arrows point straight at the eye: pressing on their tips (the box centre on screen, outside any ring band) is not an arrow grab
    const tip = project(topCam, hs.find((x) => x.id === "resize-2+")!.anchor, [0, 0, 0], vp)!;
    expect(hitHandle(hs, topCam, vp, tip.x, tip.y)).toBeNull();
  });

  it("UI-898 a ring is not picked when its axis is within the ring-specific edge-on cutoff of the view plane (0.25), and is picked just outside it", () => {
    expect(RING_PICK_EDGE_ON).toBe(0.25);
    for (const [cosv, expectId] of [[0.2, null], [0.3, "rotate-2+"]] as const) {
      const theta = Math.acos(cosv);
      // tilt the top view about the world X axis so the view vector makes |dot| = cosv with the Z axis
      const cam = { ...topCam, orientation: mul(fromAxisAngle([1, 0, 0], theta), topCam.orientation) };
      const { hs, h } = ringAt(cam, "rotate-2+");
      const q = project(cam, h.anchor, [0, 0, 0], vp)!;
      const got = hitHandle(hs.filter((x) => x.cls === "rotate" && x.axis === 2), cam, vp, q.x, q.y);
      expect(got?.id ?? null, `cos ${cosv}`).toBe(expectId);
    }
  });

  const arc = (cam: typeof topCam, id: string, deg: number, mods2 = mods, steps = 1) => {
    const b0 = box;
    const { h } = ringAt(cam, id);
    const c = project(cam, h.centre!, [0, 0, 0], vp)!;
    const at = (a: number, r: number) => screenRay(cam, vp, c.x + r * Math.cos(a), c.y - r * Math.sin(a));
    const d = beginDrag(h, b0, at(0, 40), RING_DEADZONE_PX / (vp.h / (2 * 10 * Math.tan((50 * Math.PI) / 360))), cam.ortho);
    let b = b0;
    for (let i = 1; i <= steps; i++) b = dragBox(d, at(((deg * i) / steps) * (Math.PI / 180), 40), mods2);
    return { b, d, at, h };
  };

  it("UI-899 ring drags: + and - agree, the same screen arc from the top and from the bottom turns opposite ways, turns past 180 degrees accumulate, the dead zone and a parallel ray hold", () => {
    const bottomCam = applyPreset({ ...defaultCamera(), distance: 10 }, "bottom");
    const top = quatToRpy(arc(topCam, "rotate-2+", 60).b.quat)[2];
    const topMinus = quatToRpy(arc(topCam, "rotate-2-", 60).b.quat)[2];
    const bottom = quatToRpy(arc(bottomCam, "rotate-2+", 60).b.quat)[2];
    expect(Math.abs(top)).toBeCloseTo(60, 6);
    expect(topMinus).toBeCloseTo(top, 9);
    expect(bottom).toBeCloseTo(-top, 6);
    // 190 degrees in 10-degree steps with the fine modifier: 19 degrees, not the wrapped -17
    const fine = arc(topCam, "rotate-2+", 190, { ...mods, fine: true }, 19);
    expect(quatToRpy(fine.b.quat)[2]).toBeCloseTo(19 * Math.sign(top), 6);
    // dead zone: the pointer at the ring centre holds the angle reached so far
    const a90 = arc(topCam, "rotate-2+", 90);
    const centrePx = project(topCam, a90.h.centre!, [0, 0, 0], vp)!;
    const held = dragBox(a90.d, screenRay(topCam, vp, centrePx.x + 0.5, centrePx.y), mods);
    expect(held.quat).toEqual(a90.b.quat);
    const out = dragBox(a90.d, a90.at((180 * Math.PI) / 180, 40), mods);
    expect(Math.abs(quatToRpy(out.quat)[2])).toBeCloseTo(180, 6);
    // a ray parallel to the ring plane holds
    expect(dragBox(a90.d, { origin: [0, 0, a90.h.centre![2]], dir: [1, 0, 0] }, mods).quat).toEqual(out.quat);
    // snap on a ring drag
    const sn = arc(topCam, "rotate-2+", 47, { ...mods, snap: { on: true, step: 0.1, angleStep: 15 } });
    expect(Math.abs(quatToRpy(sn.b.quat)[2])).toBeCloseTo(45, 6);
  });

  it("UI-899 a plane behind the eye holds a perspective ring drag; the same geometry in ortho does not", () => {
    const { h } = ringAt(topCam, "rotate-2+");
    const c = h.centre!;
    const front = { origin: [c[0] + 3, c[1], c[2] + 8] as Vec3, dir: [0, 0, -1] as Vec3 };
    const behind = { origin: [c[0], c[1] + 3, c[2] - 8] as Vec3, dir: [0, 0, -1] as Vec3 }; // the ring plane lies behind this ray
    const persp = beginDrag(h, box, front, 0, false);
    expect(dragBox(persp, behind, mods).quat).toEqual(box.quat);
    const ortho = beginDrag(h, box, front, 0, true);
    expect(Math.abs(quatToRpy(dragBox(ortho, behind, mods).quat)[2])).toBeCloseTo(90, 6);
  });

  it("UI-901 the grabbed point follows the pointer in an oblique view: the pointer ray through the rotated point turns the box by exactly that angle", () => {
    const oblique = { ...defaultCamera(), ortho: true, distance: 10 };
    for (const id of ["rotate-0+", "rotate-1-", "rotate-2+"]) {
      const { h } = ringAt(oblique, id);
      const look = [0, 0, 0] as Vec3;
      const lk = (() => {
        const r = screenRay(oblique, vp, vp.w / 2, vp.h / 2);
        return r.dir;
      })();
      look.splice(0, 3, ...lk);
      const through = (p: Vec3): Ray => ({ origin: [p[0] - lk[0] * 5, p[1] - lk[1] * 5, p[2] - lk[2] * 5], dir: lk });
      const p0 = h.ring![0];
      const delta = (37 * Math.PI) / 180;
      const rel = [p0[0] - h.centre![0], p0[1] - h.centre![1], p0[2] - h.centre![2]];
      const q = fromAxisAngle(h.dir, delta);
      const rr = rotate(q, rel as Vec3);
      const p1: Vec3 = [h.centre![0] + rr[0], h.centre![1] + rr[1], h.centre![2] + rr[2]];
      const d = beginDrag(h, box, through(p0), 0, true);
      const r = dragBox(d, through(p1), mods);
      const want = mul(fromAxisAngle(h.dir, delta), box.quat);
      const dotq = Math.abs(r.quat.reduce((a, v, i) => a + v * want[i], 0));
      expect(dotq, id).toBeCloseTo(1, 12);
    }
  });
});
