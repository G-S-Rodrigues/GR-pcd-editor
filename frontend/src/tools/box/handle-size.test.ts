import { expect, test } from "vitest";
import { project } from "../../pick/ray";
import type { Vec3 } from "../../state/types";
import { defaultCamera } from "../../view/camera";
import { applyPreset } from "../../view/presets";
import { HANDLE_ARROW_PX, HANDLE_HIT_PX, HANDLE_RING_HIT_PX, RING_MAX_PX, boxHandles, handleLength, hitHandle } from "./handles";
import { defaultBox } from "./model";

const box = { ...defaultBox([0, 0, 0]), dimensions: [2, 2, 2] as Vec3 };
const zero: Vec3 = [0, 0, 0];

test("UI-142 an arrow handle is a fixed number of pixels long at any zoom and viewport height", () => {
  for (const distance of [0.5, 10, 4000]) {
    for (const h of [400, 720, 1080]) {
      const cam = applyPreset({ ...defaultCamera(), distance }, "top");
      const vp = { w: h * 1.5, h };
      const arrow = boxHandles(box, cam, true, h).find((x) => x.cls === "translate" && x.axis === 0)!;
      const face: Vec3 = [1, 0, 0];
      const a = project(cam, arrow.anchor, zero, vp)!;
      const b = project(cam, face, zero, vp)!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(HANDLE_ARROW_PX, 3);
    }
  }
  expect(handleLength(applyPreset({ ...defaultCamera(), distance: 10 }, "top"), 720)).toBeGreaterThan(0);
  expect(HANDLE_HIT_PX).toBeGreaterThanOrEqual(14);
});

test("UI-169 the rotation ring never exceeds min(90 px, 0.3 x the shorter viewport side) on screen", () => {
  const big = { ...defaultBox([0, 0, 0]), dimensions: [400, 300, 200] as Vec3 };
  for (const distance of [0.5, 10, 4000]) {
    for (const [w, h] of [[1280, 720], [1920, 1080], [300, 200]] as const) {
      const cam = applyPreset({ ...defaultCamera(), distance }, "top");
      const cap = Math.min(RING_MAX_PX, 0.3 * Math.min(w, h));
      const c = project(cam, [0, 0, 0], zero, { w, h })!;
      for (const b of [big, box]) {
        const ring = boxHandles(b, cam, true, h, w).find((x) => x.cls === "rotate" && x.axis === 2)!.ring!;
        const far = Math.max(...ring.map((p) => { const q = project(cam, p, zero, { w, h })!; return Math.hypot(q.x - c.x, q.y - c.y); }));
        expect(far, `${distance} ${w}x${h}`).toBeLessThanOrEqual(cap + 1e-6);
      }
    }
  }
});

test("UI-169 a small box keeps its natural ring (no inflation) and the hit band is 8 px; a miss is not a hit", () => {
  expect(HANDLE_RING_HIT_PX).toBe(8);
  const cam = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
  const vp = { w: 1280, h: 720 };
  const handles = boxHandles(box, cam, true, vp.h, vp.w);
  const ring = handles.find((x) => x.cls === "rotate" && x.axis === 2)!.ring!;
  const p = project(cam, ring[12], zero, vp)!; // a ring sample away from every arrow and face handle
  const c = project(cam, [0, 0, 0], zero, vp)!;
  const out = { x: (p.x - c.x) / Math.hypot(p.x - c.x, p.y - c.y), y: (p.y - c.y) / Math.hypot(p.x - c.x, p.y - c.y) };
  expect(hitHandle(handles, cam, vp, p.x + out.x * 7, p.y + out.y * 7)?.cls).toBe("rotate");
  expect(hitHandle(handles, cam, vp, p.x + out.x * 9.5, p.y + out.y * 9.5)).toBeNull();
});
