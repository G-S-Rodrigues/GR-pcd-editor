import { afterEach, expect, test, vi } from "vitest";
import { stubFetch } from "../files/testing/fetch";
import type { Vec3 } from "../state/types";
import { type Camera, defaultCamera } from "../view/camera";
import { applyPreset } from "../view/presets";
import { pickAllowed, resolveSeed, spacingEstimate } from "./resolve";
import { pickPoint } from "./ray";

afterEach(() => vi.unstubAllGlobals());

const VP = { w: 800, h: 600 };
// top view, ortho, target at origin, distance 10 -> halfHeight = 10*tan(25deg)
function top(distance = 10): Camera {
  return { ...applyPreset(defaultCamera(), "top"), distance };
}
const cloud = (pts: Vec3[], origin: Vec3 = [0, 0, 0]) => ({
  coords: new Float32Array(pts.flat()),
  count: pts.length,
  origin,
});

function pixelOf(cam: Camera, x: number, y: number) {
  const hh = cam.distance * Math.tan((50 * Math.PI) / 360);
  const ppu = VP.h / 2 / hh;
  return { px: VP.w / 2 + x * ppu, py: VP.h / 2 - y * ppu, ppu };
}

test("UI-14 ortho pick: nearest within 8 px, none beyond", () => {
  const cam = top();
  const c = cloud([[0, 0, 0], [3, 3, 0]]);
  const { px, py, ppu } = pixelOf(cam, 0, 0);
  expect(pickPoint(c, cam, VP, px + 5, py)?.index).toBe(0);
  expect(pickPoint(c, cam, VP, px + 9, py)).toBeNull();
  expect(ppu).toBeGreaterThan(1);
});

test("UI-14 ties on screen resolve to the point nearest the camera (ortho and persp)", () => {
  for (const ortho of [true, false]) {
    const cam = { ...top(), ortho };
    // same x,y, different z: top view looks -Z so larger z is nearer the eye
    const c = cloud([[0, 0, -2], [0, 0, 2], [0, 0, 0]]);
    const { px, py } = pixelOf(cam, 0, 0);
    expect(pickPoint(c, cam, VP, px, py)?.index).toBe(1);
  }
});

test("UI-14 prefers the closer pixel over a nearer-to-camera point further away", () => {
  const cam = top();
  const { px, py, ppu } = pixelOf(cam, 0, 0);
  const c = cloud([[0, 0, -5], [5 / ppu, 0, 5]]);
  expect(pickPoint(c, cam, VP, px, py)?.index).toBe(0);
});

test("UI-14 points behind a perspective eye are ignored", () => {
  const cam = { ...top(), ortho: false };
  expect(pickPoint(cloud([[0, 0, 50]]), cam, VP, VP.w / 2, VP.h / 2)).toBeNull();
});

test("UI-15 resolveSeed asks nearest with world point and 2x spacing, at origin 1e6", async () => {
  const origin: Vec3 = [1e6, -1e6, 5];
  const calls = stubFetch(() => ({ body: { id: 7, distance: 0.01, point: [1e6 + 0.25, -1e6, 5] } }));
  const r = await resolveSeed({ local: [0.25, 0, 0], origin, spacing: 0.5 });
  expect(calls[0].body).toEqual({ point: [1e6 + 0.25, -1e6, 5], radius: 1 });
  expect(r).toEqual({ ok: true, id: 7, point: [1e6 + 0.25, -1e6, 5] });
});

test("UI-15 no point found -> no_point; radius clamped", async () => {
  const calls = stubFetch(() => ({ body: { id: null } }));
  const r = await resolveSeed({ local: [0, 0, 0], origin: [0, 0, 0], spacing: 0 });
  expect(r).toEqual({ ok: false, code: "no_point" });
  expect((calls[0].body as { radius: number }).radius).toBeGreaterThanOrEqual(1e-6);
});

test("UI-15 spacingEstimate from bounds and count", () => {
  expect(spacingEstimate({ min: [0, 0, 0], max: [10, 10, 10] }, 1000)).toBeCloseTo(1, 9);
  expect(spacingEstimate({ min: [0, 0, 0], max: [10, 10, 0] }, 100)).toBeCloseTo(1, 9);
  expect(spacingEstimate(null, 5)).toBe(1);
  expect(spacingEstimate({ min: [0, 0, 0], max: [0, 0, 0] }, 5)).toBe(1);
});

test("UI-16 picking is refused outside the edited view", () => {
  expect(pickAllowed("edited")).toEqual({ ok: true });
  for (const m of ["original", "deleted"] as const) {
    const r = pickAllowed(m);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: expect.stringContaining("edited") });
  }
});
