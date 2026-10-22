import { describe, expect, it } from "vitest";
import { createAppStore, type AppState } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import type { Vec3 } from "../state/types";
import { AXIS_COLOUR } from "../filterboxes/plane";
import { ARROW_HEAD_HALF_PX, ARROW_HEAD_LEN_PX, ARROW_WIDTH_PX, RING_TINT, RING_WIDTH_PX, dim } from "../tools/box/overlay";
import { HANDLE_ARROW_PX, RING_AT, RING_RADIUS_PX, handleLength } from "../tools/box/handles";
import { defaultCamera } from "../view/camera";
import { pxPerUnit } from "../view/pointsize";
import { applyPreset } from "../view/presets";
import { colourRegion, planeAnchors, protectionIntervals } from "./band";
import { bandGizmo, bandOverlaySpec } from "./bandgizmo";
import { toProtectionBody } from "./protection";
import { ringAxes } from "./rings";
import { normalOf, slabCoordinate } from "./tilt";

const VIEW_H = 600;
const frontCam = applyPreset({ ...defaultCamera(), distance: 30, target: [5, 5, 5] as Vec3 }, "front");
const cornerCam = { ...defaultCamera(), distance: 30, target: [5, 5, 5] as Vec3 };

function state(over: { rx?: number; ry?: number; local?: boolean; open?: boolean; cam?: typeof frontCam; visible?: boolean } = {}): AppState {
  const store = createAppStore();
  store.set({ session: sessionFixture(), camera: over.cam ?? frontCam });
  store.update((s) => ({
    ...s,
    floorPanelOpen: over.open ?? true,
    ...(over.visible === undefined ? {} : { bandVisible: over.visible }),
    tools: {
      ...s.tools,
      protection: {
        ...s.tools.protection,
        global: { enabled: true, min: 2, max: 4 },
        ...(over.local ? { mode: "add_local" as const, local: { min: 6, max: 7 } } : {}),
        tilt: { rx: over.rx ?? 0, ry: over.ry ?? 0, pivot: [5, 5] as [number, number] },
      },
    },
  }));
  return store.get();
}

describe("band gizmo (22-3): the protection band drawn and picked with the 14b handles", () => {
  it("UI-1063 one z arrow per shown plane: base at the plane anchor, tip handleLength along the normal, filled 14b head, z colour, 3 px", () => {
    for (const [rx, ry] of [[0, 0], [20, 30]] as const) {
      for (const local of [false, true]) {
        const s = state({ rx, ry, local, cam: cornerCam });
        const g = bandGizmo(s, VIEW_H);
        const planes = planeAnchors(s, VIEW_H);
        expect(planes).toHaveLength(local ? 4 : 2);
        expect(g.arrows.map((a) => a.id)).toEqual(planes.map((p) => `band-${p.key.which}-${p.key.edge}`));
        const n = normalOf(s.tools.protection.tilt);
        const len = handleLength(s.camera, VIEW_H);
        expect(len * pxPerUnit(s.camera, VIEW_H)).toBeCloseTo(HANDLE_ARROW_PX, 9);
        const spec = bandOverlaySpec(s, VIEW_H);
        g.arrows.forEach((a, i) => {
          const p = planes[i];
          const k = p.key.edge === "max" ? 1 : -1;
          expect(a.handle.base).toEqual(p.anchor);
          expect(a.handle.cls).toBe("resize");
          expect(a.handle.axis).toBe(2);
          expect(a.handle.sign).toBe(k);
          for (let c = 0; c < 3; c++) expect(a.handle.anchor[c]).toBeCloseTo(p.anchor[c] + k * len * n[c], 9);
          expect(p.tip).toEqual(a.handle.anchor);
          const o = spec.arrows[i];
          expect(o.id).toBe(a.id);
          expect(o.colour).toBe(AXIS_COLOUR.z);
          expect(o.width).toBe(ARROW_WIDTH_PX);
          const head = ARROW_HEAD_LEN_PX / pxPerUnit(s.camera, VIEW_H);
          const half = ARROW_HEAD_HALF_PX / pxPerUnit(s.camera, VIEW_H);
          for (let c = 0; c < 3; c++) expect(o.headBase[c]).toBeCloseTo(o.tip[c] - k * n[c] * head, 9);
          const w = [o.barbs[0][0] - o.barbs[1][0], o.barbs[0][1] - o.barbs[1][1], o.barbs[0][2] - o.barbs[1][2]];
          expect(Math.hypot(...w)).toBeCloseTo(2 * half, 9);
        });
      }
    }
  });

  it("UI-1064 four tilt rings on headless +-X and +-Y shafts at the side faces of the slab mid-plane, with the 14b ring look", () => {
    for (const [rx, ry] of [[0, 0], [20, 30]] as const) {
      const s = state({ rx, ry, cam: cornerCam });
      const g = bandGizmo(s, VIEW_H);
      const spec = bandOverlaySpec(s, VIEW_H);
      expect(g.rings.map((r) => r.id)).toEqual(["tilt-x+", "tilt-x-", "tilt-y+", "tilt-y-"]);
      const t = s.tools.protection.tilt;
      const len = handleLength(s.camera, VIEW_H);
      const radius = RING_RADIUS_PX / pxPerUnit(s.camera, VIEW_H);
      const b = s.session!.active_bounds!;
      const iv = protectionIntervals(s.tools.protection)[0];
      const mid = (iv.min + iv.max) / 2;
      for (const r of g.rings) {
        const h = r.handle;
        const x = r.which === "x";
        const dir = x ? ringAxes(t).x : ([0, 1, 0] as Vec3);
        expect(h.cls).toBe("rotate");
        expect(h.axis).toBe(x ? 0 : 1);
        expect(h.dir).toEqual(dir);
        expect(h.radius).toBeCloseTo(radius, 12);
        expect(h.ring).toHaveLength(32);
        const base = spec.shafts.find((q) => q.id === `shaft-${h.id.slice(5)}`)!;
        expect(base).toBeDefined();
        expect(base.colour).toBe(AXIS_COLOUR[x ? "x" : "y"]);
        expect(base.width).toBe(ARROW_WIDTH_PX);
        // the shaft is as long as an arrow, runs from the side face along sign * dir, and has no head
        const shaft = [base.tip[0] - base.base[0], base.tip[1] - base.base[1], base.tip[2] - base.base[2]];
        expect(Math.hypot(...shaft)).toBeCloseTo(len, 9);
        for (let c = 0; c < 3; c++) expect(shaft[c]).toBeCloseTo(h.sign * len * dir[c], 9);
        // the base is on the slab mid-plane at the face centre
        expect(slabCoordinate(base.base, t)).toBeCloseTo(mid, 9);
        const cx = (b.min[0] + b.max[0]) / 2;
        const cy = (b.min[1] + b.max[1]) / 2;
        if (x) {
          expect(base.base[0]).toBe(h.sign > 0 ? b.max[0] : b.min[0]);
          expect(base.base[1]).toBe(cy);
        } else {
          expect(base.base[1]).toBe(h.sign > 0 ? b.max[1] : b.min[1]);
          expect(base.base[0]).toBe(cx);
        }
        for (let c = 0; c < 3; c++) expect(h.centre![c]).toBeCloseTo(base.base[c] + h.sign * RING_AT * len * dir[c], 9);
        const o = spec.rings.find((q) => q.id === h.id)!;
        expect(o.colour).toBe(dim(AXIS_COLOUR[x ? "x" : "y"], RING_TINT));
        expect(o.width).toBe(RING_WIDTH_PX);
        expect(o.pts).toEqual(h.ring);
      }
      expect(spec.shafts).toHaveLength(4);
      expect(spec.arrows.map((a) => a.id)).toEqual(["band-global-min", "band-global-max"]);
    }
  });

  it("UI-1065 rings and shafts only while the section is open, arrows fill and outline also folded, nothing without an interval, a session or the Edited view", () => {
    const open = bandOverlaySpec(state(), VIEW_H);
    expect(open.fills).toHaveLength(1);
    expect(open.outlines).toHaveLength(2);
    expect(open.arrows).toHaveLength(2);
    expect(open.rings).toHaveLength(4);
    expect(open.shafts).toHaveLength(4);
    const folded = state({ open: false });
    const f = bandOverlaySpec(folded, VIEW_H);
    expect(f.fills).toEqual(open.fills);
    expect(f.outlines).toEqual(open.outlines);
    expect(f.arrows).toEqual(open.arrows);
    expect(f.rings).toEqual([]);
    expect(f.shafts).toEqual([]);
    expect(bandGizmo(folded, VIEW_H).rings).toEqual([]);
    expect(bandGizmo(folded, VIEW_H).arrows).toHaveLength(2);
    const none = (s: AppState) => {
      expect(bandOverlaySpec(s, VIEW_H)).toEqual({ fills: [], outlines: [], arrows: [], rings: [], shafts: [] });
      expect(bandGizmo(s, VIEW_H)).toEqual({ arrows: [], rings: [], shafts: [], handles: [] });
    };
    const s0 = state();
    none({ ...s0, session: null });
    none({ ...s0, compare: "original" });
    none({ ...s0, tools: { ...s0.tools, protection: { ...s0.tools.protection, global: { enabled: false, min: 2, max: 4 } } } });
    none({ ...s0, session: sessionFixture({ active_bounds: null as never }) });
  });

  it("UI-1066 Show band off empties the whole band while protection (model, request body, intervals and colour region) is exactly the shown state", () => {
    const shown = state({ rx: 15, ry: 10, local: true });
    const hidden = { ...shown, bandVisible: false };
    expect(bandGizmo(shown, VIEW_H).handles.length).toBeGreaterThan(0);
    expect(bandOverlaySpec(hidden, VIEW_H)).toEqual({ fills: [], outlines: [], arrows: [], rings: [], shafts: [] });
    expect(bandGizmo(hidden, VIEW_H)).toEqual({ arrows: [], rings: [], shafts: [], handles: [] });
    expect(hidden.tools.protection).toEqual(shown.tools.protection);
    expect(toProtectionBody(hidden.tools.protection)).toEqual(toProtectionBody(shown.tools.protection));
    expect(protectionIntervals(hidden.tools.protection)).toEqual(protectionIntervals(shown.tools.protection));
    expect(colourRegion(hidden)).toEqual(colourRegion(shown));
    expect(colourRegion(hidden)).not.toBeNull();
  });
});
