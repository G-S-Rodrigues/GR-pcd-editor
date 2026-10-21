import { describe, expect, it } from "vitest";
import { bandFromPlane, bandReplaceText, emptyProtection } from "./protection";
import { type Tilt, isLevel, normalOf, slabCoordinate } from "./tilt";

// a small seeded generator (mulberry32): the planes and points are the same on every run
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("band from a detected plane (20-5)", () => {
  it("UI-960 200 seeded planes: band membership by slabCoordinate equals |n.p - d| <= t away from the boundary", () => {
    const r = rng(7);
    let checked = 0;
    for (let k = 0; k < 200; k++) {
      const tilt: Tilt = { rx: (r() * 2 - 1) * 59, ry: (r() * 2 - 1) * 59, pivot: [0, 0] };
      const normal = normalOf(tilt);
      const d = (r() * 2 - 1) * 5;
      const t = 0.01 + r() * 0.1;
      const centre: [number, number] = [(r() - 0.5) * 10, (r() - 0.5) * 10];
      const e = bandFromPlane(emptyProtection(), { normal, d, thickness: t }, centre);
      expect(e.ok).toBe(true);
      const m = e.model;
      expect(m.global.enabled).toBe(true);
      for (let i = 0; i < 40; i++) {
        const p: [number, number, number] = [(r() - 0.5) * 12, (r() - 0.5) * 12, (r() - 0.5) * 12];
        // half of the points are put near the slab so both sides of the boundary are tested
        if (i % 2 === 0) {
          const dist = normal[0] * p[0] + normal[1] * p[1] + normal[2] * p[2] - d;
          const off = (r() * 2 - 1) * 2 * t;
          p[0] -= normal[0] * (dist - off);
          p[1] -= normal[1] * (dist - off);
          p[2] -= normal[2] * (dist - off);
        }
        const dist = Math.abs(normal[0] * p[0] + normal[1] * p[1] + normal[2] * p[2] - d);
        if (Math.abs(dist - t) < 1e-6) continue;
        const s = slabCoordinate(p, m.tilt);
        const inBand = s >= m.global.min && s <= m.global.max;
        expect(inBand, `plane ${k} point ${i}`).toBe(dist <= t);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(7000);
  });

  it("UI-961 a tilt beyond 60 degrees on one axis is refused with the per-axis text; a steep total with both axes within 60 is accepted", () => {
    const m = emptyProtection();
    const steep = normalOf({ rx: 0, ry: 65, pivot: [0, 0] });
    const e = bandFromPlane(m, { normal: steep, d: 0, thickness: 0.05 }, [0, 0]);
    expect(e.ok).toBe(false);
    expect(e.model).toBe(m);
    expect(e.error).toBe("This plane needs a tilt of rx 0, ry 65 degrees; the protection band allows at most 60 on each");
    const rxBad = bandFromPlane(m, { normal: normalOf({ rx: -62.5, ry: 0, pivot: [0, 0] }), d: 0, thickness: 0.05 }, [0, 0]);
    expect(rxBad.error).toMatch(/rx -62\.5, ry 0 degrees/);
    // rx 55 and ry 55 together tilt the normal by about 66 degrees from vertical, and each axis is within 60
    const both = bandFromPlane(m, { normal: normalOf({ rx: 55, ry: 55, pivot: [0, 0] }), d: 1, thickness: 0.05 }, [1, 2]);
    expect(both.ok).toBe(true);
    expect(both.model.tilt.rx).toBeCloseTo(55, 9);
    expect(both.model.tilt.ry).toBeCloseTo(55, 9);
  });

  it("UI-962 a level plane keeps the level slab at its own height, a tilted one pivots at the given centre; the operation mode stays", () => {
    const m = { ...emptyProtection(), mode: "add_local" as const, local: { min: 1, max: 2 }, ack: false };
    const lvl = bandFromPlane(m, { normal: [0, 0, 1], d: 3, thickness: 0.25 }, [4, 5]);
    expect(lvl.model.global).toEqual({ enabled: true, min: 2.75, max: 3.25 });
    expect(isLevel(lvl.model.tilt)).toBe(true);
    expect(lvl.model.mode).toBe("add_local");
    expect(lvl.model.local).toEqual({ min: 1, max: 2 });
    const tilted = bandFromPlane(m, { normal: normalOf({ rx: 10, ry: -5, pivot: [0, 0] }), d: 3, thickness: 0.25 }, [4, 5]);
    expect(tilted.model.tilt.pivot).toEqual([4, 5]);
    expect(tilted.model.global.enabled).toBe(true);
    expect(tilted.model.mode).toBe("add_local");
  });

  it("UI-974a O11: an enabled band is replaced only after a confirm that names it; a disabled one needs none", () => {
    expect(bandReplaceText(emptyProtection())).toBeNull();
    const on = { ...emptyProtection(), global: { enabled: true, min: -0.1, max: 0.2 }, tilt: { rx: 3, ry: 0, pivot: [0, 0] as [number, number] } };
    expect(bandReplaceText(on)).toBe("Replace the protection band -0.1 to 0.2 (tilt rx 3, ry 0 degrees) with this Detected plane?");
    expect(bandReplaceText({ ...on, tilt: { rx: 0, ry: 0, pivot: [0, 0] } })).toMatch(/\(level\)/);
  });
});
