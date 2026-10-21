import { describe, expect, it } from "vitest";
import { colourize } from "../colour/modes";
import { PALETTE } from "../colour/palette";
import { layerColourKey } from "../colour/key";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import type { Vec3 } from "../state/types";
import { ringAngle, rotationDelta } from "../tools/box/gizmo-math";
import { colourRegion } from "./band";
import {
  type ProtectionModel,
  dragPlane,
  emptyProtection,
  floorFromPick,
  levelled,
  protectionFromState,
  rotateSlab,
  setGlobal,
  setTilt,
  toProtectionBody,
} from "./protection";
import { ringAxes } from "./rings";
import { type Tilt, isLevel, levelTilt, normalOf, slabCoordinate } from "./tilt";

// Shared with tests/unit/test_protection_tilt.py (TLT-00): (rx, ry, pivot, p, s)
const GOLDEN: [number, number, [number, number], Vec3, number][] = [
  [0, 0, [0, 0], [1, 2, 3], 3.0],
  [0, 30, [0, 0], [2, 0, 1], 1.8660254037844386],
  [30, 0, [0, 0], [0, 2, 1], -0.13397459621556118],
  [20, -40, [1, -2], [3, 1, 0.5], -1.8741828218906362],
  [-60, 60, [5, 5], [0, 0, 0], -6.49519052838329],
];
const on = (min: number, max: number) => ({ enabled: true, min, max });
const model = (over: Partial<ProtectionModel> = {}): ProtectionModel => ({ ...emptyProtection(), ...over });

describe("tilted slab model (10-6)", () => {
  it("UI-220 slabCoordinate matches the backend golden table; level is exactly z", () => {
    for (const [rx, ry, pivot, p, s] of GOLDEN) {
      expect(slabCoordinate(p, { rx, ry, pivot })).toBeCloseTo(s, 12);
    }
    expect(slabCoordinate([1, 2, 3.25], levelTilt())).toBe(3.25);
    expect(slabCoordinate([1, 2, 3.25], { rx: 0, ry: 0, pivot: [9, 9] })).toBe(3.25);
    const n = normalOf({ rx: 20, ry: -40, pivot: [0, 0] });
    expect(Math.hypot(...n)).toBeCloseTo(1, 12);
  });

  it("UI-221 setTilt limits the angles, captures the pivot on the first tilt and keeps it; levelled clears", () => {
    const m = model();
    expect(setTilt(m, { rx: 61 }, [3, 4]).ok).toBe(false);
    expect(setTilt(m, { ry: Number.NaN }, [3, 4]).ok).toBe(false);
    const a = setTilt(m, { rx: 10 }, [3, 4]);
    expect(a.ok && a.model.tilt).toEqual({ rx: 10, ry: 0, pivot: [3, 4] });
    const b = a.ok ? setTilt(a.model, { ry: -5 }, [99, 99]) : a; // pivot kept, not recaptured
    expect(b.ok && b.model.tilt).toEqual({ rx: 10, ry: -5, pivot: [3, 4] });
    const back = b.ok ? setTilt(b.model, { rx: 0, ry: 0 }, [99, 99]) : b;
    expect(back.ok && isLevel(back.model.tilt)).toBe(true);
    const c = b.ok ? levelled(b.model) : m;
    expect(c.tilt).toEqual(levelTilt());
    expect(setTilt(m, { rx: 60, ry: -60 }, [0, 0]).ok).toBe(true);
  });

  it("UI-222 toProtectionBody omits tilt when level and includes it when tilted; missing wire tilt loads level", () => {
    const lvl = toProtectionBody(model({ global: on(0, 1) }));
    expect(lvl.ok && "tilt" in lvl.body).toBe(false);
    const t = toProtectionBody(model({ global: on(0, 1), tilt: { rx: 5, ry: -10, pivot: [1.5, 2.5] } }));
    expect(t.ok && t.body.tilt).toEqual({ rx_deg: 5, ry_deg: -10, pivot: [1.5, 2.5] });
    const wire = { global: { enabled: true, min: 0, max: 1 }, operation: { mode: "inherit" as const, local: null, acknowledge_override: false } };
    expect(isLevel(protectionFromState(wire).tilt)).toBe(true);
    const back = protectionFromState({ ...wire, tilt: { rx_deg: 5, ry_deg: -10, pivot: [1.5, 2.5] } });
    expect(back.tilt).toEqual({ rx: 5, ry: -10, pivot: [1.5, 2.5] });
  });

  it("UI-223 dragPlane is the old result at tilt 0 and a distance along the normal when tilted", () => {
    const m = model({ global: on(2, 4) });
    expect(dragPlane(m, "global", "max", 1.5).global).toEqual({ enabled: true, min: 2, max: 5.5 });
    const t = model({ global: on(2, 4), tilt: { rx: 20, ry: 10, pivot: [0, 0] } });
    const d = dragPlane(t, "global", "min", -0.5).global;
    expect(d).toEqual({ enabled: true, min: 1.5, max: 4 });
    // a point moved by 0.5 along the normal has a slab coordinate 0.5 higher
    const n = normalOf(t.tilt);
    const p: Vec3 = [1, 2, 3];
    const q: Vec3 = [p[0] + 0.5 * n[0], p[1] + 0.5 * n[1], p[2] + 0.5 * n[2]];
    expect(slabCoordinate(q, t.tilt) - slabCoordinate(p, t.tilt)).toBeCloseTo(0.5, 12);
  });

  it("UI-224 ring drag: the X ring turns about X' = Ry.x, the Y ring about world Y, a ten degree sweep adds ten degrees, clamped, level clears the pivot", () => {
    const t0: Tilt = { rx: 0, ry: 30, pivot: [0, 0] };
    const ax = ringAxes(t0);
    expect(ax.x[0]).toBeCloseTo(Math.cos((30 * Math.PI) / 180), 12);
    expect(ax.x[2]).toBeCloseTo(-Math.sin((30 * Math.PI) / 180), 12);
    expect(ax.y).toEqual([0, 1, 0]);
    // rays looking along -Y onto the ring plane y=0; the hit point turns from +Z toward +X, which is a
    // right-handed (positive) rotation about +Y
    const c: Vec3 = [0, 0, 0];
    const rayAt = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return { origin: [Math.sin(r), 10, Math.cos(r)] as Vec3, dir: [0, -1, 0] as Vec3 };
    };
    const a0 = ringAngle(rayAt(0), c, [0, 1, 0])!;
    const a1 = ringAngle(rayAt(10), c, [0, 1, 0])!;
    const delta = (rotationDelta(a0, a1) * 180) / Math.PI;
    expect(delta).toBeCloseTo(10, 9);
    // the sign convention: a positive sweep about the axis (right-handed) adds degrees
    const up = rotateSlab(model({ global: on(0, 1) }), "y", 10, [3, 4]);
    expect(up.tilt).toEqual({ rx: 0, ry: 10, pivot: [3, 4] });
    expect(rotateSlab(up, "x", -15, [9, 9]).tilt).toEqual({ rx: -15, ry: 10, pivot: [3, 4] });
    expect(rotateSlab(model(), "x", 500, [0, 0]).tilt.rx).toBe(60);
    expect(rotateSlab(model(), "x", -500, [0, 0]).tilt.rx).toBe(-60);
    expect(isLevel(rotateSlab(up, "y", -10, [9, 9]).tilt)).toBe(true);
    expect(rotateSlab(up, "y", -10, [9, 9]).tilt.pivot).toEqual([0, 0]);
  });

  it("UI-225 floorFromPick on a tilted slab uses the slab coordinate of the picked point", () => {
    const tilt: Tilt = { rx: 10, ry: -20, pivot: [1, 1] };
    const p: Vec3 = [4, 3, 2.5];
    const s = slabCoordinate(p, tilt);
    const r = floorFromPick("edited", s, 0.05);
    expect(r.ok && r.min).toBeCloseTo(s - 0.05, 6);
    expect(r.ok && r.max).toBeCloseTo(s + 0.05, 6);
    // level: the pick is exactly its z, as before
    expect(slabCoordinate(p, levelTilt())).toBe(2.5);
  });

  it("UI-226 strong colour on a tilted slab follows slabCoordinate; the colour key and region change with the tilt", () => {
    const tilt: Tilt = { rx: 0, ry: 30, pivot: [0, 0] };
    const inside: Vec3 = [2, 0, 1]; // s = 1.866
    const outside: Vec3 = [2, 0, 3]; // s = 3.866
    const coords = new Float32Array([...inside, ...outside]);
    const out = colourize(
      { coords, flags: new Uint8Array(2), count: 2, origin: [0, 0, 0] },
      { mode: "flat", bounds: null, markDeleted: false, region: { intervals: [{ min: 1.5, max: 2.5 }], tilt } },
    );
    PALETTE.protectedStrong.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
    PALETTE.base.forEach((v, i) => expect(out[3 + i]).toBeCloseTo(v, 6));
    const st = createAppStore();
    st.set({ session: sessionFixture() });
    const withT = (tl: Tilt) => {
      st.update((s) => ({ ...s, tools: { ...s.tools, protection: model({ global: on(1, 2), tilt: tl }) } }));
      return st.get();
    };
    const lvl = withT(levelTilt());
    expect(colourRegion(lvl)).toEqual({ intervals: [{ min: 1, max: 2 }] });
    const tl = withT(tilt);
    expect(colourRegion(tl)?.tilt).toEqual(tilt);
    expect(layerColourKey(tl, true)).not.toBe(layerColourKey(lvl, true));
    expect(layerColourKey(tl, false)).toBe(layerColourKey(lvl, false));
    void setGlobal;
  });
});
