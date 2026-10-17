import { describe, expect, it } from "vitest";
import { dot, normalize, sub } from "../math/vec";
import { project } from "../pick/ray";
import { screenRay } from "../pick/screenray";
import type { Bounds, Vec3 } from "../state/types";
import { type Camera, defaultCamera, lookDirection, orbit } from "../view/camera";
import { applyPreset } from "../view/presets";
import { beginFilterDrag, cancelFilterDrag, moveFilterDrag, rayValue } from "./drag";

const VP = { w: 800, h: 600 };
const B: Bounds = { min: [0, -5, 2], max: [10, 5, 12] };
const AX: Record<"x" | "y" | "z", Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

const cams = (): [string, Camera][] => {
  const base = { ...defaultCamera(), target: [5, 0, 7] as Vec3 };
  return [
    ["perspective oblique", base],
    ["ortho oblique", { ...base, ortho: true }],
    ["ortho front", applyPreset(base, "front")],
    ["perspective orbited", orbit(base, 0.7, 0.2)],
  ];
};

describe("filter drag math", () => {
  it("UI-200 a ray through a point on the axis gives that point's coordinate (ortho, perspective, oblique)", () => {
    for (const [name, cam] of cams()) {
      for (const axis of ["x", "y", "z"] as const) {
        const origin = cam.target;
        const i = "xyz".indexOf(axis);
        for (const v of [origin[i] - 2, origin[i], origin[i] + 3.5]) {
          const p: Vec3 = [...origin];
          p[i] = v;
          const s = project(cam, p, [0, 0, 0], VP);
          if (!s) continue;
          const val = rayValue(screenRay(cam, VP, s.x, s.y), origin, axis);
          if (val === null) continue; // end-on for this camera
          close(val, v, 1e-5);
        }
      }
    }
  });

  it("UI-200 off the axis it equals intersecting the ray with the plane that holds the axis and faces the ray", () => {
    for (const [name, cam] of cams()) {
      const origin = cam.target;
      for (const axis of ["x", "z"] as const) {
        const a = AX[axis];
        const i = "xyz".indexOf(axis);
        for (const [px, py] of [[300, 200], [550, 420], [400, 300]]) {
          const ray = screenRay(cam, VP, px, py);
          const val = rayValue(ray, origin, axis);
          if (val === null) continue;
          const d = normalize(ray.dir);
          const n = normalize(sub(d, a.map((c) => c * dot(d, a)) as Vec3)); // plane normal: ray direction without its axis part
          const t = dot(n, sub(origin, ray.origin)) / dot(n, d);
          const hit: Vec3 = [ray.origin[0] + t * d[0], ray.origin[1] + t * d[1], ray.origin[2] + t * d[2]];
          close(val, hit[i], 1e-6);
        }
      }
    }
  });

  it("UI-200 looking along the axis (end-on) gives null", () => {
    const top = applyPreset({ ...defaultCamera(), target: [5, 0, 7] }, "top");
    const ray = screenRay(top, VP, 400, 300);
    expect(rayValue(ray, top.target, "z")).toBeNull();
    expect(rayValue(ray, top.target, "x")).not.toBeNull();
    expect(Math.abs(dot(normalize(ray.dir), lookDirection(top)))).toBeGreaterThan(0.99);
  });
});

describe("filter drag state", () => {
  const cam = applyPreset({ ...defaultCamera(), target: [5, 0, 7] }, "front");
  const at = (x: number, y: number) => screenRay(cam, VP, x, y);
  const px = (v: number) => project(cam, [5, 0, v], [0, 0, 0], VP)!;

  it("UI-201 begin grabs where the pointer is; move follows the pointer; clamps to the cloud and the other side", () => {
    const from = px(6);
    const d = beginFilterDrag({ axis: "z", side: "min", value: 6, ray: at(from.x, from.y), origin: cam.target })!;
    expect(d).not.toBeNull();
    const to = px(8);
    close(moveFilterDrag(d, at(to.x, to.y), B, 10, false)!, 8, 1e-5);
    const above = px(11);
    close(moveFilterDrag(d, at(above.x, above.y), B, 10, false)!, 10, 1e-5); // min never passes max
    const below = px(-3);
    close(moveFilterDrag(d, at(below.x, below.y), B, 10, false)!, 2, 1e-5); // never below the cloud
    const hi = beginFilterDrag({ axis: "z", side: "max", value: 6, ray: at(from.x, from.y), origin: cam.target })!;
    close(moveFilterDrag(hi, at(below.x, below.y), B, 4, false)!, 4, 1e-5); // max never passes min
  });

  it("UI-201 Shift moves a tenth as far; Esc (cancel) returns the start value", () => {
    const from = px(6);
    const d = beginFilterDrag({ axis: "z", side: "min", value: 6, ray: at(from.x, from.y), origin: cam.target })!;
    const to = px(8);
    close(moveFilterDrag(d, at(to.x, to.y), B, 12, true)!, 6.2, 1e-5);
    expect(cancelFilterDrag(d)).toBe(6);
  });

  it("UI-201 no drag can begin end-on", () => {
    const top = applyPreset({ ...defaultCamera(), target: [5, 0, 7] }, "top");
    expect(beginFilterDrag({ axis: "z", side: "min", value: 6, ray: screenRay(top, VP, 400, 300), origin: top.target })).toBeNull();
  });
});
