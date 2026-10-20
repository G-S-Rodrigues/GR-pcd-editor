import { expect, test, vi } from "vitest";
import type { LayerReply } from "../api/layers";
import { MIN_EXTENT } from "../tools/box/model";
import { createAppStore } from "../state/app";
import type { Layer, LayerOp } from "../state/types";
import { sessionFixture } from "../testing/fixtures";
import { createEditShape } from "./editshape";
import { createLayers } from "./layers";
import { editEnded } from "../layers/model";

const layer = (over: Partial<Layer> = {}): Layer => ({
  id: 1,
  name: "Floor",
  colour: 0,
  visible: true,
  count: 30,
  bounds: { min: [0, 2, 4], max: [4, 6, 4] },
  ...over,
});
const OP: LayerOp = { moved: 5, from_other_layers: 0, released: 0 };

function setup(layers: Layer[] = [layer(), layer({ id: 2, name: "Wall", visible: false })], op: LayerOp = OP, confirmAnswer = true) {
  const store = createAppStore();
  store.set({ session: sessionFixture({ revision: { cloud: 7, params: 4 }, selection: { count: 9, ops: [] }, layers }) } as never);
  const calls: string[] = [];
  const shape = createEditShape(store, {
    resetRunner: () => void calls.push("reset"),
    clearSelection: async () => {
      calls.push("clear");
      store.set({ session: { ...store.get().session!, selection: { count: 0, ops: [] } }, liveFirst: true });
    },
    toolChanged: () => void calls.push("changed"),
  });
  const reply = (o: LayerOp): LayerReply => ({ session: store.get().session!, op: o });
  const api = {
    createLayer: vi.fn(),
    assignLayer: vi.fn(),
    deleteLayer: vi.fn(),
    patchLayer: vi.fn(),
    setVisibility: vi.fn(),
    setMembers: vi.fn(async (_r: number, _i: number, o?: { dry_run?: boolean }) => reply(o?.dry_run ? op : OP)),
    refreshState: vi.fn(async () => undefined),
  };
  const confirm = vi.fn(() => confirmAnswer);
  const paramsHook = vi.fn();
  const ctl = createLayers(store, api as never, { paramsHook, confirm, selectLayer: () => undefined, openShape: shape.openShape });
  return { store, api, confirm, paramsHook, calls, ctl };
}

test("UI-858 openShape arms the tool of a shape without a history step, in the order reset, clear, changed", async () => {
  const t = setup();
  const r = await createEditShape(t.store, { resetRunner: () => t.calls.push("r"), clearSelection: async () => void t.calls.push("c"), toolChanged: () => t.calls.push("t") }).openShape(
    { type: "box", center: [1, 2, 3], dimensions: [2, 2, 2], rpy_deg: [0, 0, 0], mode: "inside" },
    null,
  );
  expect(r.ok).toBe(true);
  expect(t.calls).toEqual(["r", "c", "t"]);
  expect(t.store.get().tool).toBe("box");
  expect(t.store.get().tools.box.center).toEqual([1, 2, 3]);
});

test("UI-859 Edit layer clears the selection, seeds a box at the member bounds (every side at least the minimum extent), and enters edit mode", async () => {
  const t = setup();
  await t.ctl.editLayer(1);
  expect(t.calls).toEqual(["reset", "clear", "changed"]);
  const s = t.store.get();
  expect(s.tool).toBe("box");
  expect(s.tools.box.center).toEqual([2, 4, 4]);
  expect(s.tools.box.dimensions).toEqual([4, 4, MIN_EXTENT]); // a flat layer keeps a thin box
  expect(s.layerUi.editing).toBe(1);
  expect(s.layerUi.active).toBe(1);
  expect(s.liveFirst).toBe(true);
});

test("UI-860 a hidden layer or one without points is refused with its reason and nothing changes", async () => {
  const t = setup([layer({ visible: false }), layer({ id: 2, count: 0, bounds: null })]);
  await t.ctl.editLayer(1);
  await t.ctl.editLayer(2);
  expect(t.calls).toEqual([]);
  expect(t.store.get().layerUi.editing).toBeNull();
  expect(t.store.get().notices.map((n) => n.text)).toContain("The layer has no points");
});

test("UI-861 Set layer to selection: dry run, confirm when it takes points from other layers, real call, then leave edit mode and keep the selection", async () => {
  const steal: LayerOp = { moved: 9, from_other_layers: 4, released: 2 };
  const no = setup(undefined, steal, false);
  no.store.update((s) => ({ ...s, layerUi: { editing: 1, active: 1 } }));
  await no.ctl.setMembers();
  expect(no.confirm).toHaveBeenCalledWith("Move 4 points out of other layers into Floor?");
  expect(no.api.setMembers).toHaveBeenCalledTimes(1); // the dry run only
  expect(no.store.get().layerUi.editing).toBe(1); // still editing after No
  const yes = setup(undefined, steal, true);
  yes.store.update((s) => ({ ...s, layerUi: { editing: 1, active: 1 } }));
  await yes.ctl.setMembers();
  expect(yes.api.setMembers.mock.calls).toEqual([
    [7, 1, { dry_run: true }],
    [7, 1],
  ]);
  expect(yes.store.get().layerUi.editing).toBeNull();
  expect(yes.store.get().session?.selection.count).toBe(9); // D3: the selection is kept
  expect(yes.paramsHook).toHaveBeenCalledWith("layers");
});

test("UI-862 leaving edit mode (Esc, Clear selection) sends nothing; editEnded says when edit mode is stale", () => {
  const t = setup();
  t.store.update((s) => ({ ...s, layerUi: { editing: 1, active: 1 }, tool: "box" }));
  t.ctl.leaveEdit();
  expect(t.store.get().layerUi.editing).toBeNull();
  expect(t.store.get().layerUi.active).toBe(1);
  expect(t.api.setMembers).not.toHaveBeenCalled();
  const base = { ...t.store.get(), layerUi: { editing: 1, active: 1 }, tool: "box" as const };
  expect(editEnded(base)).toBe(false);
  expect(editEnded({ ...base, tool: "none" })).toBe(true); // Clear selection disarms the tool
  expect(editEnded({ ...base, session: null })).toBe(true);
  expect(editEnded({ ...base, session: sessionFixture({ layers: [] }) })).toBe(true); // the layer is gone
  expect(editEnded({ ...base, layerUi: { editing: null, active: 1 } })).toBe(false);
});
