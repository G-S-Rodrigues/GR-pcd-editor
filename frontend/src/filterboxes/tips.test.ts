import { describe, expect, it } from "vitest";
import { boxHandles, HANDLE_HIT_PX } from "../tools/box/handles";
import { defaultBox } from "../tools/box/model";
import { project } from "../pick/ray";
import { applyPreset } from "../view/presets";
import { defaultCamera } from "../view/camera";
import { boxTipRects } from "./tips";
import { placeBoxes, type Rect } from "./placement";

const STAGE = { w: 768, h: 642 }; // the 1280x720 stage
const hit = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const COLLAPSED = () => ({ w: 76, h: 24 });

describe("filter boxes keep off the Box tool's arrow tips (22-8 regression, E2E-100 at 1280x720)", () => {
  it("UI-1260 boxTipRects is one square per resize arrow tip that is on the stage, as wide as the tip's hit radius, and nothing for the other handles", () => {
    const cam = applyPreset(defaultCamera(), "top");
    const box = defaultBox([0, 0, 0]);
    const rects = boxTipRects(box, cam, STAGE);
    const tips = boxHandles(box, cam, STAGE.h).filter((h) => h.cls === "resize");
    const onStage = tips.flatMap((h) => {
      const p = project(cam, h.anchor, [0, 0, 0], STAGE);
      return p && p.x >= 0 && p.x <= STAGE.w && p.y >= 0 && p.y <= STAGE.h ? [p] : [];
    });
    expect(rects).toHaveLength(onStage.length);
    expect(rects.length).toBeGreaterThanOrEqual(4);
    for (const p of onStage) {
      expect(rects.some((r) => r.l === p.x - HANDLE_HIT_PX && r.r === p.x + HANDLE_HIT_PX && r.t === p.y - HANDLE_HIT_PX && r.b === p.y + HANDLE_HIT_PX)).toBe(true);
    }
  });

  it("UI-1261 with a tip rect reserved, a docked box row no longer covers it (top view, 1280x720 stage, collapsed chips)", () => {
    const o = applyPreset(defaultCamera(), "top").orientation;
    // the tip E2E-100 measured: resize-0- at page (335, 373) = stage (103, 321)
    const tip: Rect = { l: 103 - HANDLE_HIT_PX, t: 321 - HANDLE_HIT_PX, r: 103 + HANDLE_HIT_PX, b: 321 + HANDLE_HIT_PX };
    const covered = (reserved: Rect[]) =>
      placeBoxes(o, STAGE, null, COLLAPSED, new Set(), reserved).boxes.filter((b) => hit({ l: b.x, t: b.y, r: b.x + b.w, b: b.y + b.h }, tip));
    expect(covered([]).length).toBeGreaterThan(0); // the regression
    expect(covered([tip])).toEqual([]);
  });
});
