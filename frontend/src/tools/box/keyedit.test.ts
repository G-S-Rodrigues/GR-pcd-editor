import { describe, expect, it } from "vitest";
import type { Vec3 } from "../../state/types";
import { defaultCamera } from "../../view/camera";
import { applyPreset } from "../../view/presets";
import { keyEditBox } from "./keyedit";
import { type BoxModel, MIN_EXTENT, defaultBox, quatToRpy, rpyToQuat } from "./model";

const steps = { step: 0.5, angleStep: 5 };
const none = { shift: false, alt: false, ctrl: false };
const box: BoxModel = { ...defaultBox([1, 2, 3]), dimensions: [2, 4, 6] };
const top = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
const front = applyPreset({ ...defaultCamera(), distance: 10 }, "front");
const edit = (key: string, mods = {}, cam = top, b = box) => keyEditBox(b, key, { ...none, ...mods }, cam, steps);
const close = (a: readonly number[], b: readonly number[], d = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));

describe("keyboard box edit (Part 14)", () => {
  it("UI-572 arrows move the box by Step along the world axes nearest the screen directions; PageUp/PageDown along the view; Shift is a tenth", () => {
    close(edit("ArrowRight")!.center, [1.5, 2, 3]);
    close(edit("ArrowLeft")!.center, [0.5, 2, 3]);
    close(edit("ArrowUp")!.center, [1, 2.5, 3]); // top view: screen up is +Y
    close(edit("ArrowDown")!.center, [1, 1.5, 3]);
    close(edit("PageUp")!.center, [1, 2, 3.5]); // towards the eye, which is above
    close(edit("PageDown")!.center, [1, 2, 2.5]);
    close(edit("ArrowUp", {}, front)!.center, [1, 2, 3.5]); // front view: screen up is +Z
    close(edit("ArrowRight", {}, front)!.center, [1.5, 2, 3]);
    close(edit("PageUp", {}, front)!.center, [1, 1.5, 3]); // the eye is on the -Y side
    close(edit("ArrowRight", { shift: true })!.center, [1.05, 2, 3]);
    expect(edit("ArrowRight")!.dimensions).toEqual(box.dimensions);
    expect(edit("ArrowRight")!.quat).toBe(box.quat);
    expect(edit("a")).toBeNull();
  });

  it("UI-573 Alt+arrow grows (Right/Up) or shrinks (Left/Down) both faces of the box axis nearest that screen direction, clamps, and keeps the centre", () => {
    close(edit("ArrowRight", { alt: true })!.dimensions, [3, 4, 6]);
    close(edit("ArrowLeft", { alt: true })!.dimensions, [1, 4, 6]);
    close(edit("ArrowUp", { alt: true })!.dimensions, [2, 5, 6]);
    close(edit("ArrowDown", { alt: true })!.dimensions, [2, 3, 6]);
    close(edit("ArrowRight", { alt: true, shift: true })!.dimensions, [2.1, 4, 6]);
    expect(edit("ArrowRight", { alt: true })!.center).toEqual(box.center);
    const small = { ...box, dimensions: [0.5, 4, 6] as Vec3 };
    expect(edit("ArrowLeft", { alt: true }, top, small)!.dimensions[0]).toBe(MIN_EXTENT);
    // a box turned 90 degrees about Z: screen-right is now its Y axis
    const turned = { ...box, quat: rpyToQuat([0, 0, 90]) };
    close(edit("ArrowRight", { alt: true }, top, turned)!.dimensions, [2, 5, 6]);
  });

  it("UI-574 . and , turn the box by the angle step about its Z axis (only the orientation changes), back returns exact zeros; Shift and Ctrl+Shift pick other axes", () => {
    const a = edit(".")!;
    close(quatToRpy(a.quat), [0, 0, 5], 6);
    expect(a.center).toEqual(box.center);
    expect(a.dimensions).toEqual(box.dimensions);
    close(quatToRpy(edit(",")!.quat), [0, 0, -5], 6);
    expect(quatToRpy(edit(",", {}, top, a)!.quat)).toEqual([0, 0, 0]);
    expect(quatToRpy(edit(">", { shift: true })!.quat)[0]).toBeCloseTo(5, 6); // top view: screen-right is X, so roll
    expect(quatToRpy(edit("<", { shift: true })!.quat)[0]).toBeCloseTo(-5, 6);
    close(quatToRpy(edit(".", { ctrl: true, shift: true })!.quat), [0, 0, 5], 6); // top view: the view axis is Z (counter-clockwise on screen)
    close(quatToRpy(edit(".", { ctrl: true, shift: true }, front)!.quat), [0, 5, 0].map((v, i) => (i === 1 ? -5 : v)), 6);
    // turning twice in opposite directions about X, Y and Z leaves the exact level box
    let b = box;
    for (const [k, m] of [[".", {}], [">", { shift: true }], [".", { ctrl: true, shift: true }]] as const) b = edit(k, m, top, b)!;
    for (const [k, m] of [[",", { ctrl: true, shift: true }], ["<", { shift: true }], [",", {}]] as const) b = edit(k, m, top, b)!;
    expect(quatToRpy(b.quat)).toEqual([0, 0, 0]);
  });
});
