import { expect, test } from "vitest";
import { project } from "../../pick/ray";
import type { Vec3 } from "../../state/types";
import { defaultCamera, halfHeight } from "../../view/camera";
import { applyPreset } from "../../view/presets";
import { HANDLE_ARROW_PX, HANDLE_HIT_PX, HANDLE_RING_HIT_PX, RING_AT, RING_RADIUS_PX, boxHandles, handleLength, hitHandle } from "./handles";
import { defaultBox, rpyToQuat } from "./model";

const box = { ...defaultBox([0, 0, 0]), dimensions: [2, 2, 2] as Vec3 };
const zero: Vec3 = [0, 0, 0];

test("UI-142 an arrow handle is a fixed number of pixels long at any zoom and viewport height", () => {
  for (const distance of [0.5, 10, 4000]) {
    for (const h of [400, 720, 1080]) {
      const cam = applyPreset({ ...defaultCamera(), distance }, "top");
      const vp = { w: h * 1.5, h };
      const arrow = boxHandles(box, cam, h).find((x) => x.id === "resize-0+")!;
      const face: Vec3 = [1, 0, 0];
      const a = project(cam, arrow.anchor, zero, vp)!;
      const b = project(cam, face, zero, vp)!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(HANDLE_ARROW_PX, 3);
    }
  }
  expect(handleLength(applyPreset({ ...defaultCamera(), distance: 10 }, "top"), 720)).toBeGreaterThan(0);
  expect(HANDLE_HIT_PX).toBeGreaterThanOrEqual(14);
});

test("UI-894 a rotation ring is 8 px in radius at every zoom and viewport, centred on its arrow's shaft a third of the way out", () => {
  const big = { ...defaultBox([0, 0, 0]), dimensions: [400, 300, 200] as Vec3 };
  for (const distance of [0.5, 10, 4000]) {
    for (const [w, h] of [[1280, 720], [1920, 1080], [300, 200]] as const) {
      const cam = applyPreset({ ...defaultCamera(), distance }, "top");
      const vp = { w, h };
      for (const b of [big, box]) {
        const c = project(cam, [0, 0, 0], zero, vp)!;
        for (const sign of ["+", "-"]) {
          const ring = boxHandles(b, cam, h).find((x) => x.id === `rotate-2${sign}`)!;
          // face-on from the top: every sample is exactly 8 px from the projected ring centre
          const cen = project(cam, ring.centre!, zero, vp)!;
          for (const p of ring.ring!) {
            const q = project(cam, p, zero, vp)!;
            expect(Math.hypot(q.x - cen.x, q.y - cen.y), `${distance} ${w}x${h}`).toBeCloseTo(RING_RADIUS_PX, 3);
          }
          expect(Math.hypot(cen.x - c.x, cen.y - c.y)).toBeLessThan(1e-6); // the Z arrows point at the eye: ring centre over the box centre
        }
        // an in-plane arrow's ring sits RING_AT x 72 px = 24 px from its face centre, on the shaft
        const ringX = boxHandles(b, cam, h).find((x) => x.id === "rotate-0+")!;
        const arrowX = boxHandles(b, cam, h).find((x) => x.id === "resize-0+")!;
        const face = project(cam, arrowX.base!, zero, vp)!;
        const cen = project(cam, ringX.centre!, zero, vp)!;
        expect(Math.hypot(cen.x - face.x, cen.y - face.y)).toBeCloseTo(HANDLE_ARROW_PX * RING_AT, 3);
      }
    }
  }
  expect(RING_RADIUS_PX).toBe(8);
});

test("UI-895 a ring lies in the plane normal to its arrow's box axis, centred on the shaft, at a gap of at least 4 px from the shaft edge (measured in the ring's plane)", () => {
  const rot = { ...defaultBox([1, 2, 3]), dimensions: [2, 4, 6] as Vec3, quat: rpyToQuat([10, 20, 30]) };
  const cam = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
  const ppu = 720 / (2 * halfHeight(cam));
  for (const h of boxHandles(rot, cam, 720).filter((x) => x.cls === "rotate")) {
    const arrow = boxHandles(rot, cam, 720).find((x) => x.id === `resize-${h.axis}${h.sign > 0 ? "+" : "-"}`)!;
    expect(h.dir).toEqual(arrow.dir);
    for (let i = 0; i < 3; i++) expect(h.centre![i]).toBeCloseTo(arrow.base![i] + h.sign * arrow.dir[i] * ((RING_AT * HANDLE_ARROW_PX) / ppu), 12);
    for (const p of h.ring!) {
      const rel = [p[0] - h.centre![0], p[1] - h.centre![1], p[2] - h.centre![2]];
      expect(Math.abs(rel[0] * h.dir[0] + rel[1] * h.dir[1] + rel[2] * h.dir[2])).toBeLessThan(1e-12);
      expect(Math.hypot(rel[0], rel[1], rel[2])).toBeCloseTo(RING_RADIUS_PX / ppu, 12);
    }
  }
  expect(RING_RADIUS_PX - 3 / 2).toBeGreaterThanOrEqual(4); // ring radius minus the half of the 3 px shaft
});

test("UI-896 a ring is grabbed within 6 px of its outline, not inside it: 5.5 px out hits, 7.5 px out misses, the centre of a face-on ring is the box body", () => {
  expect(HANDLE_RING_HIT_PX).toBe(6);
  const cam = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
  const vp = { w: 1280, h: 720 };
  const handles = boxHandles(box, cam, vp.h);
  const ring = handles.find((x) => x.id === "rotate-2+")!;
  const cen = project(cam, ring.centre!, zero, vp)!;
  const out = (r: number) => ({ x: cen.x + r, y: cen.y });
  expect(hitHandle(handles, cam, vp, out(RING_RADIUS_PX + 5.5).x, cen.y)?.id).toBe("rotate-2+");
  expect(hitHandle(handles, cam, vp, out(RING_RADIUS_PX - 5.5).x, cen.y)?.id).toBe("rotate-2+"); // inside, but within the band of the outline
  expect(hitHandle(handles, cam, vp, out(RING_RADIUS_PX + 7.5).x, cen.y)).toBeNull();
  expect(hitHandle(handles, cam, vp, cen.x, cen.y)).toBeNull(); // the centre falls through to the body (a press there moves the box)
});
