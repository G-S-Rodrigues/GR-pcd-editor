import { describe, expect, it } from "vitest";
import { dot } from "../math/vec";
import { defaultCamera, lookDirection, upVector } from "./camera";
import { EDGE_BAND, axisTriad, cubeTransform, faceForDirection, hitFace, snapCamera } from "./cube";
import { PRESETS, PRESET_ORDER, applyPreset } from "./presets";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("ViewCube maths", () => {
  it("UI-130 each preset turns its own face to the viewer, upright and centred; the other five are edge-on", () => {
    for (const name of PRESET_ORDER) {
      const o = applyPreset(defaultCamera(), name).orientation;
      const faces = cubeTransform(o);
      expect(faces.map((f) => f.face)).toEqual(PRESET_ORDER);
      for (const f of faces) {
        if (f.face === name) {
          expect(f.facing).toBe(true);
          expect(f.normal.map((v) => -v)).toEqual([...PRESETS[name].look]);
          [1, 0, 0, 1, 0, 0].forEach((v, i) => close(f.m[i], v));
          close(f.depth, 1);
        } else {
          expect(f.facing, `${name}: ${f.face}`).toBe(false);
        }
      }
    }
  });

  it("UI-130 the default isometric camera shows top, front and right and tracks orbiting", () => {
    const faces = cubeTransform(defaultCamera().orientation);
    expect(faces.filter((f) => f.facing).map((f) => f.face)).toEqual(["top", "front", "right"]);
    const turned = cubeTransform(applyPreset(defaultCamera(), "left").orientation).map((f) => f.m.join());
    expect(turned).not.toEqual(faces.map((f) => f.m.join()));
  });

  it("UI-131 hitFace: face centres, edges and corners from the top view", () => {
    const o = applyPreset(defaultCamera(), "top").orientation;
    expect(hitFace(o, 0, 0)).toEqual({ faces: ["top"] });
    expect(hitFace(o, 0.5 - EDGE_BAND / 2, 0)).toEqual({ faces: ["top", "right"] });
    expect(hitFace(o, -(0.5 - EDGE_BAND / 2), 0)).toEqual({ faces: ["top", "left"] });
    expect(hitFace(o, 0, 0.5 - EDGE_BAND / 2)).toEqual({ faces: ["top", "front"] }); // screen down is -Y
    expect(hitFace(o, 0, -(0.5 - EDGE_BAND / 2))).toEqual({ faces: ["top", "back"] });
    expect(hitFace(o, 0.45, 0.45)).toEqual({ faces: ["top", "right", "front"] });
    expect(hitFace(o, 0.6, 0)).toBeNull();
    expect(hitFace(o, 0, -0.51)).toBeNull();
  });

  it("UI-131 hitFace picks the face drawn on top at each projected face centre of the isometric view", () => {
    const o = defaultCamera().orientation;
    for (const f of cubeTransform(o).filter((x) => x.facing)) {
      expect(hitFace(o, f.m[4], f.m[5])).toEqual({ faces: [f.face] });
    }
  });

  it("UI-131 faceForDirection accepts only the six axis normals", () => {
    expect(faceForDirection([0, 0, 1])).toBe("top");
    expect(faceForDirection([0, 0, -1])).toBe("bottom");
    expect(faceForDirection([0, -1, 0])).toBe("front");
    expect(faceForDirection([0, 1, 0])).toBe("back");
    expect(faceForDirection([-1, 0, 0])).toBe("left");
    expect(faceForDirection([1, 0, 0])).toBe("right");
    expect(faceForDirection([0.6, 0.8, 0])).toBeNull();
  });

  it("UI-131 a face click is exactly the preset; an edge or corner click looks at the cube diagonally with Z up", () => {
    const cam = defaultCamera();
    for (const name of PRESET_ORDER) expect(snapCamera(cam, { faces: [name] })).toEqual(applyPreset(cam, name));
    const edge = snapCamera(cam, { faces: ["top", "right"] });
    const look = lookDirection(edge);
    close(look[0], -Math.SQRT1_2);
    close(look[1], 0);
    close(look[2], -Math.SQRT1_2);
    expect(edge.ortho).toBe(true);
    expect(edge.target).toEqual(cam.target);
    const corner = lookDirection(snapCamera(cam, { faces: ["top", "right", "front"] }));
    close(dot(corner, [-1, 1, -1]), Math.sqrt(3));
    expect(dot(upVector(edge), [0, 0, 1])).toBeGreaterThan(0);
  });

  it("UI-130 axis triad: X right and Y up-screen in the top view, Z toward the viewer", () => {
    const t = Object.fromEntries(axisTriad(applyPreset(defaultCamera(), "top").orientation).map((a) => [a.axis, a]));
    close(t.x.x, 1);
    close(t.x.y, 0);
    close(t.y.x, 0);
    close(t.y.y, -1); // screen y grows downward, so +Y (screen up) is negative
    close(t.z.depth, 1);
  });
});
