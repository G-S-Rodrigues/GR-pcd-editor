import { expect, test } from "vitest";
import { project } from "../../pick/ray";
import type { Vec3 } from "../../state/types";
import { defaultCamera } from "../../view/camera";
import { applyPreset } from "../../view/presets";
import { HANDLE_ARROW_PX, HANDLE_HIT_PX, boxHandles, handleLength } from "./handles";
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
