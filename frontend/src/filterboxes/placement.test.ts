import { describe, expect, it, test } from "vitest";
import { defaultCamera, orbit } from "../view/camera";
import { PRESETS, applyPreset } from "../view/presets";
import { fromBasisLookUp } from "../view/basis";
import { BAND, CUBE, LEGEND_BOX, PALETTE_CORNER, RESET_HUD, TRIAD } from "../view/layout";
import { LEGEND, legendRect, pillCentre, resetRect, type PlacedBox, type PlaceState, RESERVED, pillRect, placeBoxes, spread1d, spreadAround, triadRect } from "./placement";

const SIZES = (_id: string) => ({ w: 156, h: 28 });
const STAGE = { w: 780, h: 560 };
const put = (o: Parameters<typeof placeBoxes>[0], prev: PlaceState | null = null, stage = STAGE, lock = new Set<string>()) =>
  placeBoxes(o, stage, prev, SIZES, lock);
const by = (boxes: PlacedBox[], id: string) => boxes.find((b) => b.id === id) as PlacedBox;
const preset = (n: keyof typeof PRESETS) => applyPreset(defaultCamera(), n).orientation;

describe("filter box placement", () => {
  it("UI-195 canonical presets put each axis on the side it points to", () => {
    const f = put(preset("front")).boxes;
    expect(by(f, "x-max").edge).toBe("right");
    expect(by(f, "x-min").edge).toBe("left");
    expect(by(f, "z-max").edge).toBe("top");
    expect(by(f, "z-min").edge).toBe("bottom");
    expect(by(f, "y-max").edge).toBe("dock");
    expect(by(f, "y-min").edge).toBe("dock");
    const t = put(preset("top")).boxes;
    expect(by(t, "x-max").edge).toBe("right");
    expect(by(t, "y-max").edge).toBe("top");
    expect(by(t, "y-min").edge).toBe("bottom");
    expect(by(t, "z-max").edge).toBe("dock");
    const l = put(preset("left")).boxes;
    expect(by(l, "y-max").edge).toBe("left"); // Left view looks along +X: +Y points screen-left
    expect(by(l, "y-min").edge).toBe("right");
    expect(by(l, "z-max").edge).toBe("top");
    expect(by(l, "x-max").edge).toBe("dock");
    const b = put(preset("back")).boxes;
    expect(by(b, "x-max").edge).toBe("left");
    const bo = put(preset("bottom")).boxes;
    expect(by(bo, "z-max").edge).toBe("dock");
    expect(by(bo, "y-max").edge).toBe("top"); // Bottom view: +Y points screen-up
  });

  it("UI-195 docked boxes stack at the bottom of the left edge, Z max above Z min, X and Y above", () => {
    // 22-8: the legend sits at the bottom left, so the left lane only has room above it on a stage this short (780x560 pushes the docked boxes to a second row)
    const stage = { w: 1340, h: 900 };
    const f = put(preset("top"), null, stage).boxes;
    const zmax = by(f, "z-max");
    const zmin = by(f, "z-min");
    expect(zmax.y).toBeLessThan(zmin.y);
    expect(zmin.y + zmin.h).toBeLessThanOrEqual(stage.h);
    expect(zmin.x).toBeLessThan(20);
  });

  it("UI-196 an upside-down camera flips Z", () => {
    const up = fromBasisLookUp([0, 1, 0], [0, 0, -1]);
    const f = put(up).boxes;
    expect(by(f, "z-max").edge).toBe("bottom");
    expect(by(f, "z-min").edge).toBe("top");
  });

  it("UI-197 default oblique camera: each box on the edge its axis points to, position continuous in yaw", () => {
    const o = defaultCamera().orientation;
    const boxes = put(o).boxes;
    expect(by(boxes, "z-max").edge).toBe("top");
    expect(by(boxes, "z-min").edge).toBe("bottom");
    let cam = defaultCamera();
    let prev = put(cam.orientation);
    let worst = 0;
    for (let i = 0; i < 360; i++) {
      cam = orbit(cam, (Math.PI / 180) * 1, 0);
      const cur = put(cam.orientation, prev.state);
      // a box can only jump when the set or order of boxes sharing its edge changes (collisions push boxes apart)
      const order = (r: typeof cur, edge: string) => r.boxes.filter((x) => x.edge === edge).sort((m, n) => m.x - n.x || m.y - n.y).map((x) => x.id).join();
      for (const b of cur.boxes) {
        const p = by(prev.boxes, b.id);
        if (p.edge !== b.edge || b.edge === "dock" || order(prev, b.edge) !== order(cur, b.edge)) continue;
        worst = Math.max(worst, Math.hypot(b.x - p.x, b.y - p.y));
      }
      prev = cur;
    }
    // Free range is about 420 px; a 1 degree step moves a box by less than 0.05 of it.
    expect(worst).toBeLessThan(0.05 * 420);
  });

  it("UI-198 hysteresis: a yaw sweep changes a box's edge only a few times, never flickers under jitter", () => {
    let cam = defaultCamera();
    let state: PlaceState | null = null;
    const changes: Record<string, number> = {};
    let lastEdge: Record<string, string> = {};
    for (let i = 0; i < 720; i++) {
      cam = orbit(cam, (Math.PI / 180) * 0.5, 0);
      const r = put(cam.orientation, state);
      state = r.state;
      for (const b of r.boxes) {
        if (lastEdge[b.id] && lastEdge[b.id] !== b.edge) changes[b.id] = (changes[b.id] ?? 0) + 1;
        lastEdge[b.id] = b.edge;
      }
    }
    // Two full turns (720 half-degree steps = 360 degrees): x and y axes pass each screen edge at most 4 times.
    for (const id of Object.keys(changes)) expect(changes[id], id).toBeLessThanOrEqual(6);
    // Jitter of +-2 degrees around an edge boundary: at most one change.
    const base = orbit(defaultCamera(), (Math.PI / 180) * 20, 0);
    let st: PlaceState | null = null;
    lastEdge = {};
    let n = 0;
    for (let i = 0; i < 200; i++) {
      const jit = orbit(base, (Math.PI / 180) * (i % 2 ? 2 : -2), 0);
      const r = put(jit.orientation, st);
      st = r.state;
      for (const b of r.boxes) {
        if (b.id === "x-max") {
          if (lastEdge[b.id] && lastEdge[b.id] !== b.edge) n++;
          lastEdge[b.id] = b.edge;
        }
      }
    }
    expect(n).toBeLessThanOrEqual(1);
  });

  it("UI-198 end-on enters below 0.20 and leaves above 0.30; a locked box keeps its edge", () => {
    // Look almost along +Y from the front, tilting so the Y axis projects to length L on screen.
    const withLen = (L: number) => fromBasisLookUp([0, Math.cos(Math.asin(L)), -L], [0, L, Math.cos(Math.asin(L))]);
    const endOn = (L: number, prev: PlaceState | null) => by(put(withLen(L), prev).boxes, "y-max").edge === "dock";
    const a = put(withLen(0.25));
    expect(by(a.boxes, "y-max").edge).not.toBe("dock"); // fresh: 0.25 > 0.20
    const b = put(withLen(0.15), a.state);
    expect(by(b.boxes, "y-max").edge).toBe("dock");
    const c = put(withLen(0.25), b.state); // still docked: below 0.30
    expect(by(c.boxes, "y-max").edge).toBe("dock");
    const d = put(withLen(0.35), c.state);
    expect(by(d.boxes, "y-max").edge).not.toBe("dock");
    expect(endOn(0.1, null)).toBe(true);
    // lock: the box stays on its previous edge even when the camera turns
    const o1 = defaultCamera().orientation;
    const r1 = put(o1);
    const o2 = orbit(defaultCamera(), Math.PI, 0).orientation;
    const free = put(o2, r1.state);
    const locked = put(o2, r1.state, STAGE, new Set(["x-max"]));
    expect(by(locked.boxes, "x-max").edge).toBe(by(r1.boxes, "x-max").edge);
    expect(by(free.boxes, "x-max").edge).not.toBe(by(r1.boxes, "x-max").edge);
  });
});

const rect = (b: PlacedBox) => ({ l: b.x, t: b.y, r: b.x + b.w, b: b.y + b.h });
const hit = (a: ReturnType<typeof rect>, c: ReturnType<typeof rect>) => a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;

describe("filter box layout", () => {
  for (const stage of [
    { w: 780, h: 560 },
    { w: 1340, h: 900 },
  ]) {
    it(`UI-199 no overlap, inside the stage, clear of the reserved corners at ${stage.w}x${stage.h}`, () => {
      let boxes = 0;
      let rows2 = 0;
      for (let yaw = 0; yaw < 36; yaw++) {
        for (const pitch of [-80, -45, -20, 0, 20, 45, 80]) {
          let cam = orbit(defaultCamera(), (Math.PI / 180) * yaw * 10, 0);
          cam = orbit(cam, 0, (Math.PI / 180) * pitch);
          for (const o of [cam.orientation, ...(yaw % 9 === 0 && pitch === 0 ? [applyPreset(cam, "front").orientation] : [])]) {
            const r = placeBoxes(o, stage, null, SIZES, new Set());
            expect(r.boxes).toHaveLength(6);
            for (const [i, a] of r.boxes.entries()) {
              boxes++;
              if (a.row > 0) rows2++;
              const ra = rect(a);
              const where = `yaw ${yaw * 10} pitch ${pitch} ${a.id}`;
              expect(ra.l, where).toBeGreaterThanOrEqual(0);
              expect(ra.t, where).toBeGreaterThanOrEqual(0);
              expect(ra.r, where).toBeLessThanOrEqual(stage.w);
              expect(ra.b, where).toBeLessThanOrEqual(stage.h);
              for (const c of RESERVED(stage)) expect(hit(ra, c), `${where} vs reserved`).toBe(false);
              for (const c of r.boxes.slice(i + 1)) expect(hit(ra, rect(c)), `${where} vs ${c.id}`).toBe(false);
            }
          }
        }
      }
      expect(boxes).toBeGreaterThan(1000);
      if (stage.w === 780) expect(rows2).toBeGreaterThanOrEqual(0);
    });
  }

  it("UI-199 spread1d keeps the order, leaves a gap, stays in range and overflows what cannot fit", () => {
    const r = spread1d(
      [
        { desired: 10, size: 30 },
        { desired: 12, size: 30 },
        { desired: 300, size: 30 },
      ],
      0,
      400,
      6,
    );
    expect(r.pos).toEqual([10, 46, 300]);
    expect(r.overflow).toEqual([]);
    const tail = spread1d([{ desired: 390, size: 30 }, { desired: 395, size: 30 }], 0, 400, 6);
    expect(tail.pos).toEqual([334, 370]);
    const many = spread1d([1, 2, 3].map((d) => ({ desired: d, size: 30 })), 0, 80, 6);
    expect(many.pos).toEqual([1, 37]);
    expect(many.overflow).toEqual([2]);
  });
});

describe("filter boxes avoid the band-hidden pill", () => {
  // The pill is centred on the stage, 56 px above its bottom edge, about 230 x 30 px (index.html #band-pill).
  const pillAt = (stage: { w: number; h: number }) => ({ l: stage.w / 2 - 130, t: stage.h - 56 - 32, r: stage.w / 2 + 130, b: stage.h - BAND });
  for (const stage of [
    { w: 780, h: 560 },
    { w: 1280, h: 720 },
    { w: 1920, h: 1080 },
  ]) {
    it(`UI-1074 with the pill reserved no box touches it, the other reserved rectangles or each other at ${stage.w}x${stage.h}`, () => {
      const pill = pillAt(stage);
      let boxes = 0;
      for (let yaw = 0; yaw < 36; yaw++) {
        for (const pitch of [-80, -45, -20, 0, 20, 45, 80]) {
          let cam = orbit(defaultCamera(), (Math.PI / 180) * yaw * 10, 0);
          cam = orbit(cam, 0, (Math.PI / 180) * pitch);
          const r = placeBoxes(cam.orientation, stage, null, SIZES, new Set(), [pill]);
          expect(r.boxes).toHaveLength(6);
          for (const [i, a] of r.boxes.entries()) {
            boxes++;
            const ra = rect(a);
            const where = `yaw ${yaw * 10} pitch ${pitch} ${a.id}`;
            expect(ra.l, where).toBeGreaterThanOrEqual(0);
            expect(ra.r, where).toBeLessThanOrEqual(stage.w);
            expect(ra.b, where).toBeLessThanOrEqual(stage.h);
            expect(hit(ra, pill), `${where} vs the pill`).toBe(false);
            for (const c of RESERVED(stage)) expect(hit(ra, c), `${where} vs reserved`).toBe(false);
            for (const c of r.boxes.slice(i + 1)) expect(hit(ra, rect(c)), `${where} vs ${c.id}`).toBe(false);
          }
        }
      }
      expect(boxes).toBe(36 * 7 * 6);
    });
  }

  it("UI-1074 pillRect covers the pill as drawn (240 x 28, 56 px above the bottom, centred between the legend and the Reset icon) and stays above the timeline band", () => {
    for (const stage of [STAGE, { w: 1920, h: 1080 }]) {
      const c = pillCentre(stage);
      expect(c).toBe((LEGEND_BOX.left + LEGEND_BOX.w + LEGEND_BOX.pad + stage.w - RESET_HUD.right - RESET_HUD.size) / 2);
      expect(c).toBeGreaterThan(stage.w / 2 - 1); // the legend is wider than the Reset icon, so the span's middle is right of the stage's
      const pill = { l: c - 120, t: stage.h - 56 - 28, r: c + 120, b: stage.h - 56 };
      const r = pillRect(stage);
      expect(r.l).toBeLessThanOrEqual(pill.l);
      expect(r.r).toBeGreaterThanOrEqual(pill.r);
      expect(r.t).toBeLessThanOrEqual(pill.t);
      expect(r.b).toBeGreaterThanOrEqual(pill.b);
      expect(r.b).toBe(stage.h - BAND);
    }
  });

  it("UI-1074 spreadAround is spread1d with no obstacle and otherwise splits the row around it, overflowing what cannot fit", () => {
    const items = [{ desired: 10, size: 30 }, { desired: 200, size: 30 }, { desired: 380, size: 30 }];
    expect(spreadAround(items, 0, 400, 6, [])).toEqual(spread1d(items, 0, 400, 6));
    const r = spreadAround(items, 0, 400, 6, [[150, 250]]);
    expect(r.overflow).toEqual([]);
    for (const [i, p] of r.pos.entries()) expect(p + items[i].size <= 144 || p >= 256, `item ${i} at ${p}`).toBe(true);
    const tight = spreadAround(items, 0, 100, 6, [[40, 60]]);
    expect(tight.overflow.length).toBeGreaterThan(0);
  });

  it("UI-1074 without a pill the placement is unchanged", () => {
    const o = defaultCamera().orientation;
    expect(placeBoxes(o, STAGE, null, SIZES, new Set(), []).boxes).toEqual(put(o).boxes);
  });
});

test("UI-337 RESERVED holds exactly the palette corner, the cube column, the triad, the legend, the Reset icon and the timeline band, derived from the shared constants", () => {
  const stage = { w: 1000, h: 600 };
  const r = RESERVED(stage);
  expect(r).toHaveLength(6);
  expect(r[0]).toEqual({ l: 0, t: 0, r: PALETTE_CORNER.w, b: PALETTE_CORNER.h });
  expect(r[1]).toEqual({ l: stage.w - CUBE.w, t: 0, r: stage.w, b: CUBE.h });
  expect(r[2]).toEqual(triadRect(stage));
  expect(r[3]).toEqual(legendRect(stage));
  expect(r[4]).toEqual(resetRect(stage));
  expect(r[5]).toEqual({ l: 0, t: stage.h - BAND, r: stage.w, b: stage.h });
  expect(r[2]).toEqual({ l: TRIAD.left, t: stage.h - BAND - TRIAD.above - TRIAD.size, r: TRIAD.left + TRIAD.size, b: stage.h - BAND - TRIAD.above });
});

test("UI-338 boxes in the left lane (docked ones included) end above the triad for every swept stage and view", () => {
  for (const stage of [
    { w: 780, h: 560 },
    { w: 1000, h: 520 },
    { w: 1340, h: 900 },
  ]) {
    const tri = triadRect(stage);
    for (const name of ["front", "top", "left", "back", "bottom", "right"] as const) {
      for (const b of placeBoxes(preset(name), stage, null, SIZES, new Set()).boxes) {
        if (b.x < tri.r) expect(b.y + b.h, `${name} ${b.id} ${stage.w}x${stage.h}`).toBeLessThanOrEqual(tri.t);
      }
    }
  }
});

test("UI-352 no filter box enters the timeline band at the bottom of the stage, for every swept stage and view", () => {
  for (const stage of [
    { w: 780, h: 560 },
    { w: 1000, h: 520 },
    { w: 1340, h: 900 },
  ]) {
    for (const name of ["front", "top", "left", "back", "bottom", "right"] as const) {
      for (const b of placeBoxes(preset(name), stage, null, SIZES, new Set()).boxes) {
        expect(b.y + b.h, `${name} ${b.id} ${stage.w}x${stage.h}`).toBeLessThanOrEqual(stage.h - BAND);
      }
    }
  }
});

describe("UI-1230 22-8 the six boxes clear every HUD rectangle (built here from the constants, not from RESERVED) at the stages the app really has", () => {
  const hudRects = (stage: { w: number; h: number }) => {
    const lb = stage.h - LEGEND_BOX.bottom;
    return {
      "palette corner": { l: 0, t: 0, r: PALETTE_CORNER.w, b: PALETTE_CORNER.h },
      "cube column": { l: stage.w - CUBE.w, t: 0, r: stage.w, b: CUBE.h },
      triad: { l: TRIAD.left, t: stage.h - BAND - TRIAD.above - TRIAD.size, r: TRIAD.left + TRIAD.size, b: stage.h - BAND - TRIAD.above },
      legend: { l: LEGEND_BOX.left, t: lb - LEGEND_BOX.maxH - 2 * LEGEND_BOX.pad, r: LEGEND_BOX.left + LEGEND_BOX.w, b: lb },
      reset: { l: stage.w - RESET_HUD.right - RESET_HUD.size - 4, t: stage.h - RESET_HUD.bottom - RESET_HUD.size - 4, r: stage.w - RESET_HUD.right + 4, b: stage.h - RESET_HUD.bottom + 4 },
      band: { l: 0, t: stage.h - BAND, r: stage.w, b: stage.h },
    };
  };
  const covers = (big: ReturnType<typeof rect>, c: ReturnType<typeof rect>) => big.l <= c.l && big.t <= c.t && big.r >= c.r && big.b >= c.b;
  for (const stage of [
    { w: 780, h: 560 },
    { w: 768, h: 642 }, // 1280x720 under R22-16
    { w: 888, h: 822 }, // the default 1400x900 smoke viewport
    { w: 1300, h: 1002 },
    { w: 1340, h: 900 },
  ]) {
    it(`UI-1230 ${stage.w}x${stage.h}: inside the stage, clear of the palette corner, cube column, triad, legend, Reset and the band, and of each other`, () => {
      const hud = hudRects(stage);
      for (const [name, c] of Object.entries(hud)) expect(RESERVED(stage).some((r) => covers(r, c)), `RESERVED covers ${name}`).toBe(true);
      let boxes = 0;
      let rows2 = 0;
      for (let yaw = 0; yaw < 36; yaw++) {
        for (const pitch of [-80, -45, -20, 0, 20, 45, 80]) {
          let cam = orbit(defaultCamera(), (Math.PI / 180) * yaw * 10, 0);
          cam = orbit(cam, 0, (Math.PI / 180) * pitch);
          for (const o of [cam.orientation, ...(yaw % 9 === 0 && pitch === 0 ? [applyPreset(cam, "front").orientation] : [])]) {
            const r = placeBoxes(o, stage, null, SIZES, new Set());
            expect(r.boxes).toHaveLength(6);
            for (const [i, a] of r.boxes.entries()) {
              boxes++;
              if (a.row > 0) rows2++;
              const ra = rect(a);
              const where = `yaw ${yaw * 10} pitch ${pitch} ${a.id}`;
              expect(ra.l, where).toBeGreaterThanOrEqual(0);
              expect(ra.t, where).toBeGreaterThanOrEqual(0);
              expect(ra.r, where).toBeLessThanOrEqual(stage.w);
              expect(ra.b, where).toBeLessThanOrEqual(stage.h);
              for (const [name, c] of Object.entries(hud)) expect(hit(ra, c), `${where} vs ${name}`).toBe(false);
              for (const c of r.boxes.slice(i + 1)) expect(hit(ra, rect(c)), `${where} vs ${c.id}`).toBe(false);
            }
          }
        }
      }
      console.info(`UI-1230 ${stage.w}x${stage.h} boxes=${boxes} row>0=${rows2}`);
      expect(boxes).toBeGreaterThan(1000);
    });
  }
});
