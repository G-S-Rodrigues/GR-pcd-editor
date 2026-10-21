import { describe, expect, it, vi } from "vitest";
import { project } from "../pick/ray";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { closePolygon, emptyPolygon, setEditing, startDrawing } from "../tools/polygon/model";
import type { Vec2 } from "../tools/polygon/validate";
import { defaultCamera } from "../view/camera";
import { applyPreset } from "../view/presets";
import { createToolInteraction } from "./interact";

const vp = { w: 800, h: 600 };
const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as HTMLCanvasElement;
const sq: Vec2[] = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
const slot: Vec2[] = [[-5, -5], [5, -5], [5, 5], [1, 5], [1, -3], [-1, -3], [-1, 5], [-5, 5]];

function setup(vertices: Vec2[] = sq, editing = true) {
  const store = createAppStore();
  const camera = applyPreset({ ...defaultCamera(), distance: 20 }, "top");
  let poly = closePolygon({ ...startDrawing(emptyPolygon()), vertices }).state;
  poly = setEditing(poly, editing);
  store.set({ session: sessionFixture(), tool: "polygon", camera });
  store.update((s) => ({ ...s, tools: { ...s.tools, polygon: poly } }));
  const changed = vi.fn();
  const notify = vi.fn();
  const tools = createToolInteraction(canvas, store, () => vp, { onToolChanged: changed, protectionEdit: (() => undefined) as never, notify });
  const at = (x: number, y: number) => project(camera, [x, y, camera.target[2]], [0, 0, 0], vp)!;
  const ev = (p: { x: number; y: number }, t = 0) => ({ button: 0, clientX: p.x, clientY: p.y, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, timeStamp: t }) as unknown as PointerEvent;
  const verts = () => store.get().tools.polygon.vertices;
  return { store, tools, at, ev, changed, notify, verts };
}

describe("polygon edit mode pointer handling (13-7)", () => {
  it("UI-658 in edit mode a click on an edge inserts a vertex there and goes through the tool-changed path; elsewhere it does nothing", () => {
    const t = setup();
    const m = t.at(0, -2);
    expect(t.tools.click(t.ev({ x: m.x, y: m.y + 4 }))).toBe(true); // 4 px off the edge
    expect(t.verts()).toHaveLength(5);
    expect(t.verts()[1][0]).toBeCloseTo(0, 1);
    expect(t.verts()[1][1]).toBeCloseTo(-2, 1);
    expect(t.verts().slice(2)).toEqual([[2, -2], [2, 2], [-2, 2]]);
    expect(t.changed).toHaveBeenCalledTimes(1);
    const far = t.at(0, 0); // inside the shape, away from every edge
    expect(t.tools.click(t.ev(far))).toBe(false);
    expect(t.verts()).toHaveLength(5);
  });

  it("UI-658 the inserted vertex lies on the edge, not under the pointer", () => {
    const t = setup();
    const m = t.at(1, 2);
    t.tools.click(t.ev({ x: m.x + 3, y: m.y - 3 }));
    const added = t.verts()[3];
    expect(added[1]).toBeCloseTo(2, 6); // exactly on the horizontal edge y = 2
    expect(added[0]).toBeGreaterThan(0.5);
    expect(added[0]).toBeLessThan(1.5);
  });

  it("UI-659 outside edit mode a click on an edge changes nothing, and only a closed polygon has edges to click", () => {
    const t = setup(sq, false);
    const m = t.at(0, -2);
    expect(t.tools.click(t.ev(m))).toBe(false);
    expect(t.verts()).toHaveLength(4);
    expect(t.changed).not.toHaveBeenCalled();
  });

  it("UI-660 a press on a vertex wins over the edge next to it: it drags, so no click and no insert follow", () => {
    const t = setup();
    const v = t.at(2, -2);
    expect(t.tools.pointerDown(t.ev({ x: v.x + 3, y: v.y }))).toBe(true);
    expect(t.tools.dragging()).toBe(true);
    t.tools.pointerMove(t.ev({ x: v.x + 40, y: v.y }));
    t.tools.pointerUp();
    expect(t.verts()).toHaveLength(4);
    expect(t.verts()[1][0]).toBeGreaterThan(2);
  });

  it("UI-661 a double tap on a vertex removes it in edit mode; a slow second tap or another vertex does not", () => {
    const tap = (t: ReturnType<typeof setup>, p: { x: number; y: number }, at: number) => {
      const down = t.tools.pointerDown(t.ev(p, at));
      t.tools.pointerUp();
      return down;
    };
    const t = setup();
    const v = t.at(2, 2);
    tap(t, v, 1000);
    tap(t, v, 1200);
    expect(t.verts()).toEqual([[-2, -2], [2, -2], [-2, 2]]);
    expect(t.changed).toHaveBeenCalled();

    const slow = setup();
    tap(slow, slow.at(2, 2), 1000);
    tap(slow, slow.at(2, 2), 1700);
    expect(slow.verts()).toHaveLength(4);

    const other = setup();
    tap(other, other.at(2, 2), 1000);
    tap(other, other.at(-2, 2), 1100);
    expect(other.verts()).toHaveLength(4);

    const off = setup(sq, false); // not in edit mode: a double tap is two plain presses
    tap(off, off.at(2, 2), 1000);
    tap(off, off.at(2, 2), 1100);
    expect(off.verts()).toHaveLength(4);

    const moved = setup(); // a press that dragged the vertex is not the first half of a double tap
    const p = moved.at(2, 2);
    moved.tools.pointerDown(moved.ev(p, 1000));
    moved.tools.pointerMove(moved.ev({ x: p.x + 30, y: p.y }, 1050));
    moved.tools.pointerUp();
    const q = moved.at(moved.verts()[2][0], moved.verts()[2][1]);
    tap(moved, q, 1100);
    expect(moved.verts()).toHaveLength(4);
  });

  it("UI-662 removeHovered follows the pointer: it removes the vertex under it in edit mode only, never below three", () => {
    const t = setup();
    expect(t.tools.removeHovered()).toBe(false); // no pointer move yet
    const v = t.at(-2, 2);
    t.tools.pointerMove(t.ev({ x: v.x + 2, y: v.y - 2 }));
    expect(t.tools.hoveredVertex()).toBe(3);
    expect(t.tools.removeHovered()).toBe(true);
    expect(t.verts()).toEqual([[-2, -2], [2, -2], [2, 2]]);
    expect(t.tools.hoveredVertex()).toBeNull(); // the index is gone with the vertex
    const w = t.at(2, 2);
    t.tools.pointerMove(t.ev(w));
    expect(t.tools.removeHovered()).toBe(false);
    expect(t.verts()).toHaveLength(3);
    expect(t.notify).toHaveBeenCalledWith(expect.stringMatching(/at least 3/));

    const off = setup(sq, false);
    off.tools.pointerMove(off.ev(off.at(2, 2)));
    expect(off.tools.removeHovered()).toBe(false);
    expect(off.verts()).toHaveLength(4);
  });

  it("UI-663 a removal that would make the shape cross itself is refused with the reason", () => {
    const t = setup(slot);
    const v = t.at(5, -5);
    t.tools.pointerMove(t.ev(v));
    expect(t.tools.hoveredVertex()).toBe(1);
    expect(t.tools.removeHovered()).toBe(false);
    expect(t.verts()).toHaveLength(8);
    expect(t.notify).toHaveBeenCalledWith(expect.stringMatching(/self-intersect/));
  });

  it("UI-668 dragging a vertex works in and out of edit mode", () => {
    for (const editing of [true, false]) {
      const t = setup(sq, editing);
      const v = t.at(-2, -2);
      expect(t.tools.pointerDown(t.ev(v))).toBe(true);
      t.tools.pointerMove(t.ev({ x: v.x - 25, y: v.y + 10 }));
      t.tools.pointerUp();
      expect(t.verts()[0][0]).toBeLessThan(-2);
      expect(t.changed).toHaveBeenCalled();
    }
  });
});
