import { project } from "../pick/ray";
import { boxHandles, HANDLE_HIT_PX } from "../tools/box/handles";
import type { BoxModel } from "../tools/box/model";
import type { Camera } from "../view/camera";
import type { Rect } from "./placement";

/**
 * The Box tool's six resize arrow tips as stage rectangles (the tip's hit radius around each, only those on the stage): a filter
 * chip on a tip would take the press, so `placeBoxes` treats them like the band-hidden pill (22-8 regression, E2E-100 at 1280x720).
 */
export function boxTipRects(box: BoxModel, cam: Camera, stage: { w: number; h: number }): Rect[] {
  return boxHandles(box, cam, stage.h)
    .filter((h) => h.cls === "resize")
    .flatMap((h) => {
      const p = project(cam, h.anchor, [0, 0, 0], stage);
      if (!p || p.x < 0 || p.x > stage.w || p.y < 0 || p.y > stage.h) return [];
      return [{ l: p.x - HANDLE_HIT_PX, t: p.y - HANDLE_HIT_PX, r: p.x + HANDLE_HIT_PX, b: p.y + HANDLE_HIT_PX }];
    });
}
