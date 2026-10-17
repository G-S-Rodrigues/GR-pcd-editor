import { describe, expect, it } from "vitest";
import { pickPoint } from "../pick/ray";
import { defaultBox } from "../tools/box/model";
import { defaultCamera } from "./camera";
import { applyPreset } from "./presets";
import { defaultSlice, isClipped, sliceFromBox, sliceFromPick, slicePlanes, stepSlice } from "./slice";

const on = (axis: "x" | "y" | "z", centre: number, thickness: number) => ({ enabled: true, axis, centre, thickness });

describe("slice view (7b-1)", () => {
  it("UI-134 planes keep exactly the slab, in origin-relative coordinates; off gives no planes", () => {
    expect(slicePlanes(defaultSlice(), [0, 0, 0])).toEqual([]);
    const planes = slicePlanes(on("y", 12, 4), [0, 10, 0]);
    expect(planes).toHaveLength(2);
    const keep = (yWorld: number) => planes.every((p) => p.normal[1] * (yWorld - 10) + p.constant >= 0);
    expect(keep(10)).toBe(true);
    expect(keep(14)).toBe(true); // edges are inclusive
    expect(keep(9.99)).toBe(false);
    expect(keep(14.01)).toBe(false);
    for (const p of planes) expect(p.normal[0] === 0 && p.normal[2] === 0).toBe(true);
  });

  it("UI-134 clipPoint, from box, from pick and stepping", () => {
    const s = on("z", 2, 2);
    expect(isClipped(s, [9, 9, 3])).toBe(false);
    expect(isClipped(s, [9, 9, 3.1])).toBe(true);
    expect(isClipped({ ...s, enabled: false }, [9, 9, 99])).toBe(false);
    const box = { ...defaultBox([5, 12, 2]), dimensions: [4, 3, 2] as [number, number, number] };
    expect(sliceFromBox(box, "y", defaultSlice())).toEqual(on("y", 12, 3));
    expect(sliceFromPick("z", 0.5, 0.2)).toEqual(on("z", 0.5, 0.2));
    expect(stepSlice(on("y", 12, 4), 1)).toEqual(on("y", 16, 4));
    expect(stepSlice(on("y", 12, 4), -1)).toEqual(on("y", 8, 4));
    expect(stepSlice(defaultSlice(), 1)).toEqual(defaultSlice()); // off: nothing to step
  });

  it("UI-135 picking skips samples outside the slab", () => {
    // two points on the same pixel in top view; the higher one is clipped, so the lower one is picked
    const cam = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
    const cloud = { coords: new Float32Array([0, 0, 3, 0, 0, 1]), count: 2, origin: [0, 0, 0] as [number, number, number] };
    const vp = { w: 800, h: 600 };
    const s = on("z", 1, 1);
    expect(pickPoint(cloud, cam, vp, 400, 300)?.index).toBe(0);
    const accept = (p: [number, number, number]) => !isClipped(s, p);
    expect(pickPoint(cloud, cam, vp, 400, 300, 8, accept)?.index).toBe(1);
  });
});
