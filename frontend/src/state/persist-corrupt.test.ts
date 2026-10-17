import { expect, test } from "vitest";
import { createAppStore } from "./app";
import { applyClientPatch, restoreClientState, serialiseClientState } from "./persist";

const good = () => JSON.parse(JSON.stringify(serialiseClientState(createAppStore().get()))) as Record<string, any>;

test("UI-157 garbage never throws and unusable fields are dropped one by one", () => {
  for (const raw of [null, undefined, 3, "x", [], [1], { v: 2 }, { v: 1, tools: 5, ui: null, camera: [] }]) {
    expect(() => restoreClientState(raw)).not.toThrow();
  }
  const cases: [string, (s: Record<string, any>) => void, (p: NonNullable<ReturnType<typeof restoreClientState>>) => unknown][] = [
    ["budget Infinity", (s) => (s.ui.budget = JSON.parse("1e999")), (p) => p.budget],
    ["budget fraction below 1", (s) => (s.ui.budget = 0.5), (p) => p.budget],
    ["box with a zero dimension", (s) => (s.tools.box.dimensions = [0, 1, 1]), (p) => p.tools?.box],
    ["box with a negative dimension", (s) => (s.tools.box.dimensions = [1, -1, 1]), (p) => p.tools?.box],
    ["box with a zero quaternion", (s) => (s.tools.box.quat = [0, 0, 0, 0]), (p) => p.tools?.box],
    ["camera with a zero quaternion", (s) => (s.camera.orientation = [0, 0, 0, 0]), (p) => p.camera],
    ["cluster radius Infinity", (s) => (s.tools.cluster.radius = JSON.parse("1e999")), (p) => p.tools?.cluster],
    ["polygon z range reversed", (s) => Object.assign(s.tools.polygon, { phase: "closed", vertices: [[0, 0], [1, 0], [1, 1]], zMin: 5, zMax: 1, mode: "inside" }), (p) => p.tools?.polygon],
    ["pointSize 0", (s) => (s.pointSize = 0), (p) => p.colour],
  ];
  for (const [name, mutate, field] of cases) {
    const s = good();
    mutate(s);
    const p = restoreClientState(s);
    expect(p, name).not.toBeNull();
    expect(field(p as NonNullable<typeof p>), name).toBeUndefined();
    expect(() => applyClientPatch(createAppStore().get(), p as NonNullable<typeof p>), name).not.toThrow();
  }
});
