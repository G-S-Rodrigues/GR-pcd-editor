import { expect, test } from "vitest";
import { type Quat } from "../math/quat";
import { CUBE_NAV, CUBE_SIDE } from "./layout";
import { cubeTransform } from "./cube";
import { type Camera, defaultCamera, orbit } from "./camera";
import { CORNER_IDS, arrowLayout, cornerZones } from "./cubenav";
import { PRESET_ORDER, applyPreset } from "./presets";

/** 36 yaws x 7 pitches of oblique cameras, plus the six presets. */
function views(): Quat[] {
  const out: Quat[] = [];
  for (let yaw = 0; yaw < 36; yaw++) {
    for (const pitch of [-80, -45, -20, 0, 20, 45, 80]) {
      let cam: Camera = orbit(defaultCamera(), (Math.PI / 180) * yaw * 10, 0);
      cam = orbit(cam, 0, (Math.PI / 180) * pitch);
      out.push(cam.orientation);
    }
  }
  for (const p of PRESET_ORDER) out.push(applyPreset(defaultCamera(), p).orientation);
  return out;
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test("UI-330 arrowLayout: six distinct faces on distinct ring slots, pairwise at least the arrow size apart, in every swept view", () => {
  for (const o of views()) {
    const a = arrowLayout(o);
    expect(a.map((x) => x.face).sort()).toEqual([...PRESET_ORDER].sort());
    expect(new Set(a.map((x) => x.slot)).size).toBe(6);
    for (const [i, p] of a.entries()) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(CUBE_NAV.ring, 6);
      for (const q of a.slice(i + 1)) expect(dist(p, q)).toBeGreaterThanOrEqual(CUBE_NAV.arrow);
    }
  }
});

test("UI-331 Top view: the four side arrows point up, down, left and right on screen and the end-on faces take diagonals", () => {
  const a = Object.fromEntries(arrowLayout(applyPreset(defaultCamera(), "top").orientation).map((x) => [x.face, x]));
  // looking down Z with +Y up on screen: back is up, front down, right is right, left is left
  expect([a.back.angle, a.front.angle, a.right.angle, a.left.angle]).toEqual([0, 180, 90, 270]);
  for (const f of ["top", "bottom"]) expect(a[f].angle % 90, f).toBe(45);
  expect(Math.abs(a.top.angle - a.bottom.angle)).toBe(180);
  // Front view: top is up, bottom down, and the end-on pair back/front take diagonals
  const f = Object.fromEntries(arrowLayout(applyPreset(defaultCamera(), "front").orientation).map((x) => [x.face, x]));
  expect([f.top.angle, f.bottom.angle, f.right.angle, f.left.angle]).toEqual([0, 180, 90, 270]);
  expect(f.front.angle % 90).toBe(45);
  expect(f.back.angle % 90).toBe(45);
});

test("UI-332 cornerZones: at most eight, three distinct faces each, outside the cube outline, pairwise zone size apart, ids registered", () => {
  let most = 0;
  for (const o of views()) {
    const z = cornerZones(o);
    most = Math.max(most, z.length);
    expect(z.length).toBeGreaterThanOrEqual(4);
    expect(z.length).toBeLessThanOrEqual(8);
    const faces = cubeTransform(o);
    for (const [i, c] of z.entries()) {
      expect(new Set(c.faces).size).toBe(3);
      expect(CORNER_IDS).toContain(c.id);
      // outside every face quad: the corner itself is on the outline, the zone centre lies further out
      for (const f of faces) {
        const [a, b, cc, d, e, g] = f.m;
        const det = a * d - b * cc;
        if (Math.abs(det) < 1e-9) continue;
        const x = c.x / CUBE_SIDE;
        const y = c.y / CUBE_SIDE;
        const u = (d * (x - e) - cc * (y - g)) / det;
        const v = (-b * (x - e) + a * (y - g)) / det;
        expect(Math.abs(u) > 0.5 || Math.abs(v) > 0.5, `${c.id} inside ${f.face}`).toBe(true);
      }
      for (const q of z.slice(i + 1)) expect(dist(c, q)).toBeGreaterThanOrEqual(CUBE_NAV.zone);
    }
  }
  expect(most).toBe(6); // an oblique view shows a hexagon outline
  expect(new Set(CORNER_IDS).size).toBe(8);
});

test("UI-332 a corner zone never overlaps an arrow in any swept view", () => {
  const half = (s: number) => s / 2;
  for (const o of views()) {
    const arrows = arrowLayout(o);
    for (const z of cornerZones(o)) {
      for (const a of arrows) {
        const ox = Math.abs(a.x - z.x) < half(CUBE_NAV.arrow) + half(CUBE_NAV.zone);
        const oy = Math.abs(a.y - z.y) < half(CUBE_NAV.arrow) + half(CUBE_NAV.zone);
        expect(ox && oy, `${z.id} vs ${a.face}`).toBe(false);
      }
    }
  }
});
