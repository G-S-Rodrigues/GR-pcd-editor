import { describe, expect, it } from "vitest";
import { cross, normalize } from "../../math/vec";
import { rotate } from "../../math/quat";
import type { Vec3 } from "../../state/types";
import { type Camera, defaultCamera, lookDirection, rightVector } from "../../view/camera";
import { pxPerUnit } from "../../view/pointsize";
import { applyPreset } from "../../view/presets";
import { advanceRing, beginDrag, dragBox } from "./drag";
import { type Ray, advanceTurn, ringAngle, ringPlaneHit } from "./gizmo-math";
import { HANDLE_ARROW_PX, RING_AT, RING_DEADZONE_PX, RING_RADIUS_PX, boxHandles, shaftRing } from "./handles";
import { type BoxModel, defaultBox, rpyToQuat } from "./model";
import { boxOverlaySpec, handleOverlaySpec } from "./overlay";

const VIEW_H = 600;
const turned: BoxModel = { ...defaultBox([1, -2, 3]), dimensions: [2, 3, 4], quat: rpyToQuat([20, 30, 40]) };
const persp: Camera = { ...defaultCamera(), distance: 12 };
const ortho: Camera = { ...applyPreset({ ...defaultCamera(), distance: 12 }, "front"), ortho: true };
const E: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** The ring maths exactly as boxHandles wrote it inline before the extraction (an independent copy, so UI-1060 is not a tautology). */
function legacyRing(base: Vec3, ld: Vec3, sign: 1 | -1, len: number, radius: number, cam: Camera, look: Vec3) {
  const add3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const helper: Vec3 = Math.abs(ld[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(helper, ld));
  const w = cross(ld, u);
  const centre = add3(base, ld, sign * RING_AT * len);
  const ring: Vec3[] = [];
  for (let s = 0; s < 32; s++) {
    const t = (s / 32) * 2 * Math.PI;
    ring.push(add3(add3(centre, u, Math.cos(t) * radius), w, Math.sin(t) * radius));
  }
  let side = cross(look, ld);
  side = Math.hypot(side[0], side[1], side[2]) < 1e-6 ? rightVector(cam) : normalize(side);
  return { ring, centre, anchor: add3(centre, side, radius) };
}

describe("shared box handle helpers (22-3 step 1, no Box behaviour change)", () => {
  it("UI-1060 shaftRing reproduces boxHandles' ring, centre and widest point exactly for all six arrows of a turned box, in perspective and ortho", () => {
    for (const cam of [persp, ortho]) {
      const hs = boxHandles(turned, cam, VIEW_H);
      const ppu = pxPerUnit(cam, VIEW_H);
      const len = HANDLE_ARROW_PX / ppu;
      const radius = RING_RADIUS_PX / ppu;
      const look = lookDirection(cam);
      expect(hs.filter((h) => h.cls === "rotate")).toHaveLength(6);
      for (const h of hs.filter((x) => x.cls === "rotate")) {
        const arrow = hs.find((x) => x.id === h.id.replace("rotate", "resize"))!;
        const got = shaftRing(arrow.base!, h.dir, h.sign, len, radius, cam, look);
        expect(got.ring, h.id).toEqual(h.ring);
        expect(got.centre, h.id).toEqual(h.centre);
        expect(got.anchor, h.id).toEqual(h.anchor);
        const old = legacyRing(arrow.base!, rotate(turned.quat, E[h.axis]), h.sign, len, radius, cam, look);
        expect(got, h.id).toEqual(old);
      }
    }
  });

  it("UI-1061 handleOverlaySpec over boxHandles equals boxOverlaySpec with no hover, an arrow hovered and a ring hovered", () => {
    for (const hover of [null, "resize-1+", "rotate-2-"]) {
      const viaHandles = handleOverlaySpec(boxHandles(turned, persp, VIEW_H), persp, hover, VIEW_H);
      expect(viaHandles, String(hover)).toEqual(boxOverlaySpec(turned, persp, hover, VIEW_H));
      expect(viaHandles.arrows).toHaveLength(6);
      expect(viaHandles.rings).toHaveLength(6);
    }
  });

  it("UI-1062 advanceRing holds in the dead zone, on a parallel ray and behind the eye, keeps adding past 180 degrees, and matches dragBox for one ring sweep", () => {
    const c: Vec3 = [0, 0, 0];
    const axis: Vec3 = [0, 0, 1];
    const down = (x: number, y: number): Ray => ({ origin: [x, y, 10], dir: [0, 0, -1] });
    const start = { prev: 0.5, total: 0.25 };
    // dead zone: the hit is 0.1 from the centre, the zone is 0.2
    expect(advanceRing(start, down(0.1, 0), c, axis, 0.2, false)).toBe(start);
    // outside the zone it advances by the shortest delta
    expect(advanceRing(start, down(0, 1), c, axis, 0.2, false)).toEqual(advanceTurn(start, ringAngle(down(0, 1), c, axis, false)));
    // a parallel ray holds
    expect(advanceRing(start, { origin: [1, 1, 10], dir: [1, 0, 0] }, c, axis, 0.2, false)).toBe(start);
    // the plane behind the eye holds in perspective and not in ortho
    const behind: Ray = { origin: [0, 1, -8], dir: [0, 0, -1] };
    expect(ringPlaneHit(behind, c, axis, false)).toBeNull();
    expect(advanceRing(start, behind, c, axis, 0.2, false)).toBe(start);
    expect(advanceRing(start, behind, c, axis, 0.2, true)).not.toBe(start);
    // no turn yet: the first valid angle starts one at zero, a held ray leaves null
    expect(advanceRing(null, down(0, 1), c, axis, 0.2, false)).toEqual({ prev: ringAngle(down(0, 1), c, axis, false), total: 0 });
    expect(advanceRing(null, down(0.1, 0), c, axis, 0.2, false)).toBeNull();
    // a sweep of 1.5 turns in 30 degree steps keeps adding (no wrap back)
    let t = advanceRing(null, down(1, 0), c, axis, 0.2, false);
    for (let k = 1; k <= 18; k++) t = advanceRing(t, down(Math.cos((k * Math.PI) / 6), Math.sin((k * Math.PI) / 6)), c, axis, 0.2, false);
    expect(t!.total).toBeCloseTo(3 * Math.PI, 9);
    // dragBox with the same sweep turns the box by the same running total
    const box0: BoxModel = { ...defaultBox([0, 0, 0]), dimensions: [2, 2, 2] };
    const h = boxHandles(box0, persp, VIEW_H).find((x) => x.id === "rotate-2+")!;
    const cen = h.centre!;
    const dz = 0.05;
    const d = beginDrag(h, box0, down(cen[0] + 1, cen[1]), dz, false);
    let mine = d.turn;
    for (let k = 1; k <= 6; k++) {
      const r = down(cen[0] + Math.cos((k * Math.PI) / 6), cen[1] + Math.sin((k * Math.PI) / 6));
      mine = advanceRing(mine, r, cen, h.dir, dz, false);
      dragBox(d, r, { symmetric: false, fine: false, snap: { on: false, step: 0.1, angleStep: 5 } });
    }
    expect(d.turn).toEqual(mine);
    expect(RING_DEADZONE_PX).toBe(2);
  });
});
