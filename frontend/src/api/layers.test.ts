import { afterEach, expect, test, vi } from "vitest";
import { setSessionId } from "../files/http";
import { stubFetch } from "../files/testing/fetch";
import { assignLayer, createLayer, deleteLayer, layerFromProtection, mergeLayer, patchLayer, setMembers, setOrder, setVisibility } from "./layers";
import { normaliseState } from "./session";

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionId(null);
});

const RAW = { session_id: "s1", filename: "a.pcd", schema: [], counts: { active: 5 }, bounds: null, active_bounds: null, history: { entries: [], cursor: 0, can_undo: false, can_redo: false }, client_state: {} };

test("UI-800 normaliseState defaults layers to [] and the layer counts to 0, and keeps what the server sends", () => {
  const plain = normaliseState(RAW);
  expect(plain.layers).toEqual([]);
  expect(plain.counts).toMatchObject({ active: 5, main: 0, hidden: 0 });
  const withLayers = normaliseState({ ...RAW, counts: { active: 5, main: 3, hidden: 2 }, layers: [{ id: 1, name: "A", colour: 0, visible: false, count: 2, bounds: null }] });
  expect(withLayers.layers).toHaveLength(1);
  expect(withLayers.counts).toMatchObject({ main: 3, hidden: 2 });
});

test("UI-810 every layer call builds the exact method, URL, body and session header and returns the op", async () => {
  setSessionId("s1");
  const calls = stubFetch(() => ({ body: { ...RAW, layer_op: { moved: 3, from_other_layers: 1, released: 0 } } }));
  const f = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } };
  const r = await createLayer(7, { name: "Floor", visible: false });
  expect(r.op).toEqual({ moved: 3, from_other_layers: 1, released: 0 });
  expect(r.session.session_id).toBe("s1");
  await createLayer(7, { dry_run: true });
  await assignLayer(7, 2, { visible: true });
  await assignLayer(7, 0, { dry_run: true });
  await setMembers(7, 2, { dry_run: true });
  await patchLayer(2, { name: "B", colour: 4 });
  await deleteLayer(7, 2);
  await setVisibility(null, true);
  await setVisibility([1, 2], false);
  const L = "/api/session/layers";
  expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
    ["POST", L, { cloud_revision: 7, name: "Floor", visible: false }],
    ["POST", L, { cloud_revision: 7, dry_run: true }],
    ["POST", `${L}/2/assign`, { cloud_revision: 7, visible: true }],
    ["POST", `${L}/0/assign`, { cloud_revision: 7, dry_run: true }],
    ["POST", `${L}/2/set-members`, { cloud_revision: 7, dry_run: true }],
    ["PATCH", `${L}/2`, { name: "B", colour: 4 }],
    ["DELETE", `${L}/2`, { cloud_revision: 7 }],
    ["PUT", `${L}/visibility`, { ids: null, visible: true }],
    ["PUT", `${L}/visibility`, { ids: [1, 2], visible: false }],
  ]);
  for (const c of f.mock.calls) expect(c[1].headers).toMatchObject({ "X-Session-Id": "s1" });
});

test("UI-810 a 409 stale_revision and a 422 layer_hidden keep their code", async () => {
  stubFetch(() => ({ status: 409, body: { error: { code: "stale_revision", message: "old" } } }));
  await expect(createLayer(1)).rejects.toMatchObject({ status: 409, code: "stale_revision" });
  stubFetch(() => ({ status: 422, body: { error: { code: "layer_hidden", message: "hidden" } } }));
  await expect(setMembers(1, 2)).rejects.toMatchObject({ status: 422, code: "layer_hidden" });
});

test("UI-913 flags, order, merge and Floor-from-band calls build the exact method, URL and body", async () => {
  setSessionId("s1");
  const calls = stubFetch(() => ({ body: { ...RAW, layer_op: { moved: 3, from_other_layers: 0, released: 0 } } }));
  await patchLayer(1, { protected: true, locked: false });
  await setOrder([2, 1]);
  await mergeLayer(7, 2, { into: 1, dry_run: true });
  await layerFromProtection(7, { dry_run: true });
  await layerFromProtection(7, { name: "Ground" });
  const L = "/api/session/layers";
  expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
    ["PATCH", `${L}/1`, { protected: true, locked: false }],
    ["PUT", `${L}/order`, { ids: [2, 1] }],
    ["POST", `${L}/2/merge`, { cloud_revision: 7, into: 1, dry_run: true }],
    ["POST", `${L}/from-protection`, { cloud_revision: 7, dry_run: true }],
    ["POST", `${L}/from-protection`, { cloud_revision: 7, name: "Ground" }],
  ]);
});
