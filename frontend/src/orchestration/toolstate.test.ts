import { expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { clusterPickState, pickText, pressPick } from "../tools/cluster/pick";
import { setSeed } from "../tools/cluster/model";
import { selectionDisabledReason } from "./selection";
import { addVertex, closePolygon, emptyPolygon, setEditing, startDrawing } from "../tools/polygon/model";
import { armTool, disarmed } from "./toolstate";

const base = () => createAppStore().get();
const seeded = () => {
  const s = base();
  return { ...s, tool: "cluster" as const, tools: { ...s.tools, cluster: setSeed(s.tools.cluster, { id: 4, point: [1, 2, 3] }) } };
};

test("UI-631 arming Cluster waits for the seed click at once; the other tools and disarming are orbit", () => {
  const a = armTool(base(), "cluster");
  expect(a.tool).toBe("cluster");
  expect(a.interaction).toBe("pick-seed");
  expect(clusterPickState(a)).toBe("waiting");
  expect(armTool(base(), "box").interaction).toBe("orbit");
  expect(armTool(a, "none").interaction).toBe("orbit");
});

test("UI-632 the three states: waiting (no seed, pick mode), set (a seed), paused (armed, no seed, pick mode left)", () => {
  const w = armTool(base(), "cluster");
  expect(clusterPickState(w)).toBe("waiting");
  expect(clusterPickState({ ...w, interaction: "orbit" })).toBe("paused");
  expect(clusterPickState({ ...w, tools: seeded().tools })).toBe("set");
  expect(clusterPickState({ ...w, interaction: "orbit", tools: seeded().tools })).toBe("set");
});

test("UI-633 pressing the toggle: waiting stays waiting, set clears the seed and waits, paused waits", () => {
  const w = armTool(base(), "cluster");
  for (const from of [w, { ...w, interaction: "orbit" as const }, { ...w, interaction: "orbit" as const, tools: seeded().tools }]) {
    const next = { ...from, ...pressPick(from) };
    expect(clusterPickState(next)).toBe("waiting");
    expect(next.tools.cluster.seed).toBeNull();
    expect(next.tool).toBe("cluster");
  }
});

test("UI-634 each state has its own text, naming the seed when set", () => {
  const w = armTool(base(), "cluster");
  expect(pickText(w)).toMatch(/Waiting/);
  expect(pickText({ ...w, interaction: "orbit" })).toMatch(/Paused/);
  expect(pickText({ ...w, tools: seeded().tools })).toMatch(/point 4 at 1, 2, 3/);
});

test("UI-635 switching or disarming a tool drops the old seed", () => {
  const s = seeded();
  expect(armTool(s, "box").tools.cluster.seed).toBeNull();
  expect(armTool(s, "none").tools.cluster.seed).toBeNull();
});

test("UI-636 Clear selection disarms: no tool, no seed, empty polygon, orbit, next shape is a first selection", () => {
  const s0 = seeded();
  const s = { ...s0, interaction: "pick-seed" as const, liveFirst: false, tools: { ...s0.tools, polygon: { ...s0.tools.polygon, phase: "closed" as const, vertices: [[0, 0], [1, 0], [1, 1]] as [number, number][] } } };
  const d = disarmed(s);
  expect(d.tool).toBe("none");
  expect(d.interaction).toBe("orbit");
  expect(d.tools.cluster.seed).toBeNull();
  expect(d.tools.polygon.phase).toBe("idle");
  expect(d.liveFirst).toBe(true);
});

test("UI-637 arming with a selection present is not a first selection; with an empty one it is", () => {
  const withSel = { ...base(), session: sessionFixture({ selection: { count: 3, ops: [] } }) };
  expect(armTool(withSel, "box").liveFirst).toBe(false);
  expect(armTool({ ...base(), session: sessionFixture() }, "box").liveFirst).toBe(true);
});

test("UI-638 selectionDisabledReason: Select displayed and Invert are refused with the reason while any tool is armed", () => {
  expect(selectionDisabledReason(base())).toBeNull();
  for (const t of ["box", "polygon", "cluster"] as const) {
    expect(selectionDisabledReason({ ...base(), tool: t })).toMatch(/Disarm the tool first/);
  }
  expect(selectionDisabledReason(disarmed({ ...base(), tool: "box" }))).toBeNull();
});

test("UI-657 changing or disarming the tool leaves the polygon edit mode and keeps the shape", () => {
  let p = startDrawing(emptyPolygon());
  for (const v of [[0, 0], [4, 0], [4, 4]] as [number, number][]) p = addVertex(p, v);
  const s0 = base();
  const editing = { ...s0, tool: "polygon" as const, tools: { ...s0.tools, polygon: setEditing(closePolygon(p).state, true) } };
  expect(editing.tools.polygon.editing).toBe(true);
  for (const t of ["none", "box", "polygon"] as const) {
    const next = armTool(editing, t);
    expect(next.tools.polygon.editing).toBe(false);
    expect(next.tools.polygon.vertices).toHaveLength(3);
  }
});
