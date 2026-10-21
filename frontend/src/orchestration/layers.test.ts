import { expect, test, vi } from "vitest";
import { ApiError } from "../files/errors";
import type { LayerReply } from "../api/layers";
import { createAppStore } from "../state/app";
import type { Layer, LayerOp } from "../state/types";
import { sessionFixture } from "../testing/fixtures";
import { createLayers, layerAddBody, layerOpBody, layerSelectBody } from "./layers";

const layer = (over: Partial<Layer> = {}): Layer => ({ id: 1, name: "Hidden", colour: 0, visible: true, count: 5, bounds: null, ...over });
const OP: LayerOp = { moved: 5, from_other_layers: 0, released: 0 };

function setup(layers: Layer[] = []) {
  const store = createAppStore();
  store.set({
    session: sessionFixture({ revision: { cloud: 7, params: 4 }, selection: { count: 5, ops: [] }, layers }),
    draft: true,
    candidate: null,
  } as never);
  const reply = (hidden: number): LayerReply => ({ session: sessionFixture({ revision: { cloud: 7, params: 5 }, layers: [layer({ visible: false })], counts: { ...sessionFixture().counts, hidden } }), op: OP });
  const api = {
    createLayer: vi.fn(async () => reply(5)),
    assignLayer: vi.fn(async () => reply(9)),
    setVisibility: vi.fn(async () => reply(0)),
    refreshState: vi.fn(async () => undefined),
  };
  const calls: string[] = [];
  const paramsHook = vi.fn((k: string) => void calls.push(k));
  const selectLayerAdd = vi.fn(async (id: number) => {
    calls.push(`add:${id}:vis=${store.get().session?.layers.every((l) => l.visible)}`);
    return true;
  });
  const discardDraft = vi.fn(() => void calls.push("discard"));
  const layers_ = createLayers(store, api as never, { paramsHook, confirm: () => true, selectLayer: () => undefined, selectLayerAdd, discardDraft, openShape: async () => ({ ok: true }), selectLayerOp: async () => true, apply: async () => undefined });
  return { store, api, paramsHook, calls, selectLayerAdd, discardDraft, layers: layers_ };
}

test("UI-813 hideSelected makes the layer Hidden, hidden from the start, in one call with the cloud revision", async () => {
  const t = setup();
  await t.layers.hideSelected();
  expect(t.api.createLayer).toHaveBeenCalledWith(7, { name: "Hidden", visible: false });
  expect(t.api.assignLayer).not.toHaveBeenCalled();
  expect(t.store.get().session?.counts.hidden).toBe(5);
});

test("UI-814 with a layer named exactly Hidden the selection is assigned to it and the layer is hidden", async () => {
  const t = setup([layer(), layer({ id: 2, name: "hidden" })]);
  await t.layers.hideSelected();
  expect(t.api.assignLayer).toHaveBeenCalledWith(7, 1, { visible: false });
  expect(t.api.createLayer).not.toHaveBeenCalled();
});

test("UI-815 a layer call replaces the session, runs the params hook once, and keeps the draft flag alone", async () => {
  const t = setup();
  await t.layers.hideSelected();
  expect(t.store.get().session?.revision.params).toBe(5);
  expect(t.calls).toEqual(["layers"]);
  expect(t.store.get().draft).toBe(true); // not afterChange: the draft and the preview are not reset here
});

test("UI-816 showHidden sends visibility for every layer (ids null), then the params hook, then reselects the layer Hidden", async () => {
  const t = setup([layer({ visible: false })]);
  t.api.setVisibility.mockImplementationOnce(async () => ({ session: sessionFixture({ revision: { cloud: 7, params: 5 }, layers: [layer({ visible: true })] }), op: OP }));
  await t.layers.showHidden();
  expect(t.api.setVisibility).toHaveBeenCalledWith(null, true);
  expect(t.calls).toEqual(["discard", "layers", "add:1:vis=true"]);
  expect(t.selectLayerAdd).toHaveBeenCalledTimes(1);
});

test("UI-882 only the layer named Hidden with points is reselected (a user layer hidden by its eye comes back visible, not selected; an empty Hidden is skipped)", async () => {
  const t = setup([layer({ id: 2, name: "Mine", visible: false }), layer({ id: 1, visible: false })]);
  await t.layers.showHidden();
  expect(t.selectLayerAdd.mock.calls).toEqual([[1]]);
  const u = setup([layer({ visible: false, count: 0 })]);
  await u.layers.showHidden();
  expect(u.selectLayerAdd).not.toHaveBeenCalled();
  const v = setup([layer({ id: 2, name: "Mine", visible: false })]);
  await v.layers.showHidden();
  expect(v.selectLayerAdd).not.toHaveBeenCalled();
});

test("UI-883 showHidden discards a draft first, keeps the tool armed, sets liveFirst false and never replaces the selection", async () => {
  const t = setup([layer({ visible: false })]);
  t.store.set({ tool: "box", liveFirst: true, draft: true });
  await t.layers.showHidden();
  expect(t.discardDraft).toHaveBeenCalledTimes(1);
  expect(t.store.get().tool).toBe("box");
  expect(t.store.get().liveFirst).toBe(false);
  expect(layerAddBody(7, 1)).toMatchObject({ op: "add", scope: "active", tool: { type: "layer", layer_id: 1 } });
  const u = setup([layer({ visible: false })]);
  u.store.set({ draft: false });
  await u.layers.showHidden();
  expect(u.discardDraft).not.toHaveBeenCalled();
});

test("UI-817 a 409 reloads the state with a stale notice and does not run the params hook", async () => {
  const t = setup();
  t.api.createLayer.mockRejectedValueOnce(new ApiError(409, "stale_revision", "old"));
  await t.layers.hideSelected();
  expect(t.api.refreshState).toHaveBeenCalledTimes(1);
  expect(t.store.get().notices.some((n) => n.code === "stale_revision")).toBe(true);
  expect(t.paramsHook).not.toHaveBeenCalled();
});

test("UI-818 any other failure is an error notice with the server text and the session is unchanged", async () => {
  const t = setup();
  const before = t.store.get().session;
  t.api.createLayer.mockRejectedValueOnce(new ApiError(422, "empty_selection", "select some points first"));
  await t.layers.hideSelected();
  expect(t.store.get().notices.find((n) => n.code === "edit_failed")?.text).toBe("select some points first");
  expect(t.store.get().session).toBe(before);
  expect(t.paramsHook).not.toHaveBeenCalled();
});

// ---- the layers panel calls (15b-8)
function panel(over: { confirm?: boolean; op?: LayerOp; layers?: Layer[]; active?: number | null; compare?: string } = {}) {
  const layers = over.layers ?? [layer({ id: 1, name: "Floor", visible: true }), layer({ id: 2, name: "Wall", visible: false })];
  const store = createAppStore();
  store.set({
    session: sessionFixture({ revision: { cloud: 7, params: 4 }, selection: { count: 5, ops: [] }, layers }),
    layerUi: { editing: null, active: over.active ?? null },
    ...(over.compare ? { compare: over.compare } : {}),
  } as never);
  const next = sessionFixture({ revision: { cloud: 7, params: 5 }, layers: [...layers, layer({ id: 3, name: "New", colour: 2 })] });
  const reply = (op = over.op ?? OP): LayerReply => ({ session: next, op });
  const api = {
    createLayer: vi.fn(async (_r: number, o?: { dry_run?: boolean }) => reply(o?.dry_run ? (over.op ?? OP) : OP)),
    assignLayer: vi.fn(async (_r: number, _i: number, o?: { dry_run?: boolean }) => reply(o?.dry_run ? (over.op ?? OP) : OP)),
    deleteLayer: vi.fn(async () => reply()),
    patchLayer: vi.fn(async () => reply()),
    setVisibility: vi.fn(async () => reply()),
    mergeLayer: vi.fn(async () => reply()),
    setOrder: vi.fn(async () => reply()),
    layerFromProtection: vi.fn(async () => reply()),
    refreshState: vi.fn(async () => undefined),
  };
  const confirm = vi.fn(() => over.confirm ?? true);
  const selectLayer = vi.fn();
  const paramsHook = vi.fn();
  const selectLayerOp = vi.fn(async () => true);
  const apply = vi.fn(async () => undefined);
  const layersCtl = createLayers(store, api as never, { paramsHook, confirm, selectLayer, selectLayerAdd: async () => true, discardDraft: () => undefined, openShape: async () => ({ ok: true }), selectLayerOp, apply });
  return { store, api, confirm, selectLayer, paramsHook, selectLayerOp, apply, layers: layersCtl };
}

test("UI-825 create runs a dry run first, then the real call with the name, then the params hook once, and chooses the new layer", async () => {
  const t = panel();
  await t.layers.create("  Pipes ");
  expect(t.api.createLayer.mock.calls).toEqual([
    [7, { name: "Pipes", dry_run: true }],
    [7, { name: "Pipes" }],
  ]);
  expect(t.paramsHook.mock.calls).toEqual([["layers"]]);
  expect(t.store.get().layerUi.active).toBe(3);
  expect(t.confirm).not.toHaveBeenCalled();
  t.store.update((st) => ({ ...st, session: { ...st.session!, selection: { count: 5, ops: [] } } }));
  await t.layers.create("");
  expect(t.api.createLayer.mock.calls.at(-1)).toEqual([7, {}]); // a blank name lets the server name it
});

test("UI-826 a dry run that would take points from other layers asks first; No sends nothing real", async () => {
  const steal: LayerOp = { moved: 5, from_other_layers: 3, released: 0 };
  const no = panel({ op: steal, confirm: false });
  await no.layers.create("Pipes");
  expect(no.confirm).toHaveBeenCalledWith("Move 3 points out of other layers into Pipes?");
  expect(no.api.createLayer).toHaveBeenCalledTimes(1); // the dry run only
  expect(no.paramsHook).not.toHaveBeenCalled();
  const yes = panel({ op: steal, confirm: true, active: 1 });
  await yes.layers.assign();
  expect(yes.confirm).toHaveBeenCalledWith("Move 3 points out of other layers into Floor?");
  expect(yes.api.assignLayer.mock.calls).toEqual([
    [7, 1, { dry_run: true }],
    [7, 1],
  ]);
});

test("UI-827 release sends layer 0 without a dry run or a confirm; assign with no chosen layer says why and sends nothing", async () => {
  const t = panel();
  await t.layers.release();
  expect(t.api.assignLayer.mock.calls).toEqual([[7, 0]]);
  expect(t.confirm).not.toHaveBeenCalled();
  t.store.update((st) => ({ ...st, session: { ...st.session!, selection: { count: 5, ops: [] } } }));
  await t.layers.assign();
  expect(t.api.assignLayer).toHaveBeenCalledTimes(1);
  expect(t.store.get().notices.some((n) => n.text === "Click a layer row to choose it first")).toBe(true);
});

test("UI-828 the eye flips visibility with a patch; To main deletes the layer and forgets it as the chosen one", async () => {
  const t = panel({ active: 2 });
  await t.layers.toggle(1);
  expect(t.api.patchLayer).toHaveBeenCalledWith(1, { visible: false });
  await t.layers.toggle(2);
  expect(t.api.patchLayer).toHaveBeenLastCalledWith(2, { visible: true });
  await t.layers.toMain(2);
  expect(t.api.deleteLayer).toHaveBeenCalledWith(7, 2);
  expect(t.store.get().layerUi.active).toBeNull();
  expect(t.paramsHook).toHaveBeenCalledTimes(3);
});

test("UI-829 Select sends the layer tool through the one-shot hook; a hidden layer is refused with the reason", () => {
  const t = panel();
  t.layers.select(1);
  expect(t.selectLayer).toHaveBeenCalledWith(1);
  t.layers.select(2);
  expect(t.selectLayer).toHaveBeenCalledTimes(1);
  expect(t.store.get().notices.some((n) => n.text === "Show the layer first")).toBe(true);
  expect(layerSelectBody(7, 1, "active")).toEqual({
    cloud_revision: 7,
    op: "replace",
    scope: "active",
    tool: { type: "layer", layer_id: 1 },
    evaluate_candidate: true,
  });
});

test("UI-830 the buttons are refused with their reason while a draft is pending, and nothing is sent", async () => {
  const t = panel({ active: 1 });
  t.store.set({ draft: true });
  await t.layers.create("X");
  await t.layers.assign();
  await t.layers.release();
  expect(t.api.createLayer).not.toHaveBeenCalled();
  expect(t.api.assignLayer).not.toHaveBeenCalled();
  expect(t.store.get().notices.filter((n) => n.text === "Commit or discard the draft first")).toHaveLength(1); // one code, one notice
});

// ---- Part 18: floor from the band, merge, order, one-shot ops, delete points, menu edits
const bandOn = (t: { store: ReturnType<typeof createAppStore> }) =>
  t.store.update((st) => ({ ...st, session: { ...st.session!, protection: { ...st.session!.protection, global: { enabled: true, min: -0.1, max: 0.1 } } } }));

test("UI-914 fromBand: dry run, steal confirm when needed, the real call, the new layer becomes active; refused with the reason when the band is off", async () => {
  const off = panel();
  await off.layers.fromBand();
  expect(off.api.layerFromProtection).not.toHaveBeenCalled();
  expect(off.store.get().notices.some((n) => n.text === "Turn on height protection first")).toBe(true);
  const steal: LayerOp = { moved: 5, from_other_layers: 2, released: 0 };
  const no = panel({ op: steal, confirm: false });
  bandOn(no);
  await no.layers.fromBand();
  expect(no.confirm).toHaveBeenCalledWith("Move 2 points out of other layers into Floor?");
  expect(no.api.layerFromProtection.mock.calls).toEqual([[7, { dry_run: true }]]);
  const yes = panel();
  bandOn(yes);
  await yes.layers.fromBand();
  expect(yes.api.layerFromProtection.mock.calls).toEqual([[7, { dry_run: true }], [7]]);
  expect(yes.confirm).not.toHaveBeenCalled();
  expect(yes.paramsHook.mock.calls).toEqual([["layers"]]);
  expect(yes.store.get().layerUi.active).toBe(3);
});

test("UI-915 merge confirms always, adds the lose-protection sentence, sends nothing on No and chooses the target", async () => {
  const layers = [layer({ id: 1, name: "Floor", count: 30 }), layer({ id: 2, name: "Wall", count: 8, protected: true })];
  const t = panel({ layers });
  await t.layers.merge(1, 2);
  expect(t.confirm).toHaveBeenLastCalledWith("Merge Floor (30 points) into Wall?");
  expect(t.api.mergeLayer.mock.calls).toEqual([[7, 1, { into: 2 }]]);
  expect(t.store.get().layerUi.active).toBe(2);
  await t.layers.merge(2, 1);
  expect(t.confirm).toHaveBeenLastCalledWith("Merge Wall (8 points) into Floor? Wall's points lose protection.");
  const no = panel({ layers, confirm: false });
  await no.layers.merge(1, 2);
  expect(no.api.mergeLayer).not.toHaveBeenCalled();
  expect(no.paramsHook).not.toHaveBeenCalled();
});

test("UI-916 toMain on a protected layer confirms first; on an unprotected layer it does not", async () => {
  const t = panel({ layers: [layer({ id: 1, name: "Floor", count: 30, protected: true })], confirm: false });
  await t.layers.toMain(1);
  expect(t.confirm).toHaveBeenCalledWith("Floor is protected: its 30 points go back to main and lose protection. Continue?");
  expect(t.api.deleteLayer).not.toHaveBeenCalled();
  const u = panel({ layers: [layer({ id: 1, name: "Floor", count: 30 })] });
  await u.layers.toMain(1);
  expect(u.confirm).not.toHaveBeenCalled();
  expect(u.api.deleteLayer).toHaveBeenCalledTimes(1);
});

test("UI-917 move sends the swapped permutation; first up and last down send nothing", async () => {
  const layers = [layer({ id: 1 }), layer({ id: 2, name: "B" }), layer({ id: 5, name: "C" })];
  const up = panel({ layers });
  await up.layers.move(2, -1);
  expect(up.api.setOrder.mock.calls).toEqual([[[2, 1, 5]]]);
  const down = panel({ layers });
  await down.layers.move(2, 1);
  expect(down.api.setOrder.mock.calls).toEqual([[[1, 5, 2]]]);
  const edge = panel({ layers });
  await edge.layers.move(1, -1);
  await edge.layers.move(5, 1);
  expect(edge.api.setOrder).not.toHaveBeenCalled();
});

test("UI-918 layerOp sends the one-shot add/subtract/intersect body aimed at the layer and chooses it; refusals say why", async () => {
  expect(layerAddBody(7, 1)).toEqual(layerOpBody(7, 1, "add"));
  expect(layerOpBody(7, 2, "subtract")).toEqual({ cloud_revision: 7, op: "subtract", scope: "active", tool: { type: "layer", layer_id: 2 }, evaluate_candidate: true });
  const t = panel();
  await t.layers.layerOp(1, "subtract");
  expect(t.selectLayerOp.mock.calls).toEqual([[1, "subtract"]]);
  expect(t.store.get().layerUi.active).toBe(1);
  const last = () => t.store.get().notices.filter((n) => n.code === "layer_disabled").at(-1)?.text;
  await t.layers.layerOp(2, "add"); // hidden layer
  expect(last()).toBe("Show the layer first");
  t.store.set({ draft: true });
  await t.layers.layerOp(1, "add"); // draft pending
  expect(last()).toBe("Commit or discard the draft first");
  t.store.set({ draft: false, session: sessionFixture({ revision: { cloud: 7, params: 4 }, selection: { count: 0, ops: [] }, layers: [layer({ id: 1 })] }) });
  await t.layers.layerOp(1, "intersect"); // empty selection
  expect(last()).toBe("Select some points first");
  expect(t.selectLayerOp).toHaveBeenCalledTimes(1);
  await t.layers.layerOp(1, "add"); // add works with an empty selection
  expect(t.selectLayerOp).toHaveBeenCalledTimes(2);
  t.store.set({ session: sessionFixture({ selection: { count: 5, ops: [] }, layers: [layer({ id: 1, count: 0 })] }) });
  await t.layers.layerOp(1, "add"); // empty layer
  expect(t.selectLayerOp).toHaveBeenCalledTimes(2);
});

test("UI-919 deletePoints confirms, selects the layer (replace), then applies only when the selection landed; a protected layer is refused", async () => {
  const t = panel({ layers: [layer({ id: 1, name: "Floor", count: 30 })] });
  await t.layers.deletePoints(1);
  expect(t.confirm).toHaveBeenCalledWith("Delete the 30 points of Floor? It is a timeline step; Undo brings them back.");
  expect(t.selectLayerOp.mock.calls).toEqual([[1, "replace"]]);
  expect(t.apply).toHaveBeenCalledTimes(1);
  t.selectLayerOp.mockResolvedValueOnce(false);
  await t.layers.deletePoints(1);
  expect(t.apply).toHaveBeenCalledTimes(1);
  const no = panel({ layers: [layer({ id: 1, count: 30 })], confirm: false });
  await no.layers.deletePoints(1);
  expect(no.selectLayerOp).not.toHaveBeenCalled();
  const prot = panel({ layers: [layer({ id: 1, count: 30, protected: true })] });
  await prot.layers.deletePoints(1);
  expect(prot.confirm).not.toHaveBeenCalled();
  expect(prot.selectLayerOp).not.toHaveBeenCalled();
  expect(prot.store.get().notices.some((n) => n.text === "The layer is protected")).toBe(true);
});

test("UI-920 rename trims and refuses empty; colour, flags and visibility send the matching patch key", async () => {
  const t = panel();
  await t.layers.rename(1, "  Ground ");
  await t.layers.rename(1, "   ");
  await t.layers.setColour(1, 4);
  await t.layers.setFlag(1, "protected", true);
  await t.layers.setFlag(1, "locked", false);
  await t.layers.setVisible(1, false);
  expect(t.api.patchLayer.mock.calls).toEqual([[1, { name: "Ground" }], [1, { colour: 4 }], [1, { protected: true }], [1, { locked: false }], [1, { visible: false }]]);
  expect(t.store.get().notices.some((n) => n.code === "layer_disabled")).toBe(true);
  expect(t.paramsHook).toHaveBeenCalledTimes(5);
});
