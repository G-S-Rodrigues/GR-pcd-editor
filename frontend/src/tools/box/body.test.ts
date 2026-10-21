import { describe, expect, it } from "vitest";
import { rotate } from "../../math/quat";
import { screenRay } from "../../pick/screenray";
import type { Vec3 } from "../../state/types";
import { defaultCamera } from "../../view/camera";
import { applyPreset } from "../../view/presets";
import { moveOnPlane, rayBoxHit } from "./body";
import type { Ray } from "./gizmo-math";
import { type BoxModel, defaultBox, rpyToQuat } from "./model";

const vp = { w: 800, h: 600 };
const box: BoxModel = { ...defaultBox([0, 0, 0]), dimensions: [2, 2, 2] };
const topCam = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
const look: Vec3 = [0, 0, -1];
const down = (x: number, y: number): Ray => ({ origin: [x, y, 10], dir: [0, 0, -1] });
const close = (a: number, b: number, d = 12) => expect(a).toBeCloseTo(b, d);

describe("box body (Part 14)", () => {
  it("UI-553 a ray hits the front face of an axis-aligned and of a rotated box and misses beside it", () => {
    const hit = rayBoxHit(down(0.3, -0.4), box)!;
    expect(hit.point).toEqual([0.3, -0.4, 1]); // the +Z face towards the eye
    close(hit.t, 9);
    expect(rayBoxHit(down(1.5, 0), box)).toBeNull();
    const rot: BoxModel = { ...box, quat: rpyToQuat([0, 0, 45]) };
    expect(rayBoxHit(down(1.2, 0), rot)).not.toBeNull(); // the rotated corner reaches x = 1.41
    expect(rayBoxHit(down(1.2, 1.2), rot)).toBeNull(); // the corner of the unrotated box is empty now
    const tilted: BoxModel = { ...box, quat: rpyToQuat([0, 90, 0]), dimensions: [1, 2, 6] };
    const th = rayBoxHit(down(0, 0), tilted)!;
    close(th.point[2], 0.5); // after the pitch the 1 m side is along Z
  });

  it("UI-556 an eye inside the box gets no hit in perspective; an orthographic ray starting inside still hits the front face", () => {
    const inside: Ray = { origin: [0.1, 0.1, 0.2], dir: [0, 0, -1] };
    expect(rayBoxHit(inside, box)).toBeNull();
    const o = rayBoxHit(inside, box, true)!;
    close(o.point[2], 1);
    expect(rayBoxHit({ origin: [0, 0, 10], dir: [0, 0, 1] }, box)).toBeNull(); // pointing away
  });

  it("UI-554 moving on the view plane keeps the grab offset, never changes the depth in a face view and snaps per world axis", () => {
    const start = rayBoxHit(down(0.5, 0.5), box)!;
    const m = moveOnPlane(box, start.point, down(2.5, -0.5), look, { on: false, step: 0.1 });
    close(m.center[0], 2);
    close(m.center[1], -1);
    close(m.center[2], 0);
    // perspective camera looking down: the plane through the grab point is horizontal
    const cam = { ...topCam, ortho: false };
    const g = rayBoxHit(screenRay(cam, vp, 400, 300), box)!;
    const m2 = moveOnPlane(box, g.point, screenRay(cam, vp, 500, 250), look, { on: false, step: 0.1 });
    close(m2.center[2], 0);
    expect(m2.center[0]).not.toBe(0);
    const sn = moveOnPlane(box, start.point, down(0.5 + 0.26, 0.5 - 0.74), look, { on: true, step: 0.5 });
    close(sn.center[0], 0.5);
    close(sn.center[1], -0.5);
    // a ray parallel to the plane leaves the box where it was
    expect(moveOnPlane(box, start.point, { origin: [0, 0, 5], dir: [1, 0, 0] }, look, { on: false, step: 0.1 })).toEqual(box);
  });

  it("UI-555 moving a rotated box keeps its orientation and size bit-identical", () => {
    const rot: BoxModel = { center: [1, 2, 3], dimensions: [2, 3, 4], quat: rpyToQuat([20, 30, 40]), mode: "outside" };
    const g = rayBoxHit({ origin: [1, 2, 20], dir: [0, 0, -1] }, rot)!;
    const m = moveOnPlane(rot, g.point, { origin: [4, 1, 20], dir: [0, 0, -1] }, look, { on: false, step: 0.1 });
    expect(m.quat).toBe(rot.quat);
    expect(m.dimensions).toBe(rot.dimensions);
    expect(m.mode).toBe("outside");
    close(m.center[0], 4);
    close(m.center[1], 1);
    close(m.center[2], 3);
    expect(rotate(m.quat, [1, 0, 0])).toEqual(rotate(rot.quat, [1, 0, 0]));
  });
});
