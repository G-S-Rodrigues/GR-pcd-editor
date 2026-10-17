import { expect, it } from "vitest";
import { cross, dot, length, sub } from "../math/vec";
import type { Vec3 } from "../state/types";
import { defaultCamera } from "../view/camera";
import { applyPreset } from "../view/presets";
import { project } from "./ray";
import { intersectZPlane, screenRay } from "./screenray";

const vp = { w: 800, h: 600 };
const distToRay = (p: Vec3, r: { origin: Vec3; dir: Vec3 }) => length(cross(sub(p, r.origin), r.dir)) / length(r.dir);

it("UI-14 screenRay passes through the world point that projects to the pixel (persp and ortho)", () => {
  const origin: Vec3 = [1000000, 2000000, 5];
  const world: Vec3 = [1000001.5, 2000000.25, 6.5];
  for (const cam of [
    { ...defaultCamera(), target: [1000000, 2000000, 5] as Vec3, distance: 8 },
    applyPreset({ ...defaultCamera(), target: [1000000, 2000000, 5] as Vec3, distance: 8 }, "top"),
  ]) {
    const local: Vec3 = [world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]];
    const s = project(cam, local, origin, vp)!;
    const r = screenRay(cam, vp, s.x, s.y);
    expect(distToRay(world, r)).toBeLessThan(1e-6);
    expect(dot(r.dir, r.dir)).toBeCloseTo(1, 9);
  }
});

it("UI-44 intersectZPlane gives the exact XY on a Z plane; parallel rays give null", () => {
  const r = { origin: [10, 20, 30] as Vec3, dir: [0, 0, -1] as Vec3 };
  expect(intersectZPlane(r, 5)).toEqual([10, 20]);
  const tilted = { origin: [0, 0, 10] as Vec3, dir: [1, 0, -1] as Vec3 };
  expect(intersectZPlane(tilted, 0)).toEqual([10, 0]);
  expect(intersectZPlane({ origin: [0, 0, 1], dir: [1, 0, 0] }, 0)).toBeNull();
});
