import { expect, test, vi } from "vitest";
import { ApiError } from "../files/errors";
import type { LayerReply } from "../api/layers";
import { createAppStore } from "../state/app";
import type { Layer, LayerOp } from "../state/types";
import { sessionFixture } from "../testing/fixtures";
import { createLayers } from "./layers";

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
  const layers_ = createLayers(store, api as never, { paramsHook, confirm: () => true });
  return { store, api, paramsHook, calls, layers: layers_ };
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

test("UI-816 showAll sends visibility for every layer (ids null) and then the params hook", async () => {
  const t = setup([layer({ visible: false })]);
  await t.layers.showAll();
  expect(t.api.setVisibility).toHaveBeenCalledWith(null, true);
  expect(t.calls).toEqual(["layers"]);
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
