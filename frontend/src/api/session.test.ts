import { afterEach, expect, test, vi } from "vitest";
import { stubFetch } from "../files/testing/fetch";
import {
  apply,
  clearSelection,
  getState,
  nearest,
  normaliseState,
  putClientState,
  putFilter,
  putProtection,
  redo,
  removeInvalid,
  submitCandidate,
  submitSelection,
  undo,
} from "./session";

afterEach(() => vi.unstubAllGlobals());

// shape copied from SessionEngine.state()
const RAW = {
  session_id: "s1",
  filename: "a.pcd",
  encoding: "binary",
  schema: [{ name: "x", type: "F", size: 4, count: 1 }],
  width: 3,
  height: 1,
  viewpoint: [0, 0, 0, 1, 0, 0, 0],
  counts: {
    original: 3,
    active: 3,
    deleted: 0,
    invalid_total: 0,
    invalid_active: 0,
    displayed: 3,
    selected: 0,
    protected: 0,
  },
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  active_bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  revision: { cloud: 2, params: 3 },
  display_filter: {
    x: { enabled: false, min: 0, max: 1 },
    y: { enabled: false, min: 0, max: 1 },
    z: { enabled: false, min: 0, max: 1 },
  },
  protection: {
    global: { enabled: false, min: 0, max: 1 },
    operation: { mode: "inherit", local: null, acknowledge_override: false },
  },
  selection: { count: 0, ops: [] },
  history: { entries: [], cursor: 0, can_undo: false, can_redo: false },
  unit: "m",
  unsaved: false,
  client_state: {},
};

test("UI-02 normaliseState maps a real-shaped body", () => {
  const s = normaliseState(RAW);
  expect(s.counts.original).toBe(3);
  expect(s.revision).toEqual({ cloud: 2, params: 3 });
  expect(s.bounds).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
  expect(s.history.can_undo).toBe(false);
  expect(s.schema[0].name).toBe("x");
});

test("UI-02 missing bounds (all-invalid cloud) and client_state handled", () => {
  const s = normaliseState({ ...RAW, bounds: null, active_bounds: null, client_state: undefined });
  expect(s.bounds).toBeNull();
  expect(s.active_bounds).toBeNull();
  expect(s.client_state).toEqual({});
});

test("UI-03 each api call builds the exact URL, method and body", async () => {
  const calls = stubFetch((m, u) => (u.includes("/selection") && m === "POST" && !u.endsWith("clear") ? { status: 202, body: { id: "j1" } } : { body: RAW }));
  await getState();
  const f = { x: { enabled: true, min: 0, max: 1 }, y: { enabled: false, min: 0, max: 1 }, z: { enabled: false, min: 0, max: 1 } };
  await putFilter(f);
  const p = {
    global: { enabled: true, min: 0, max: 0.1 },
    operation: { mode: "override" as const, local: { min: 0, max: 1 }, acknowledge_override: true },
  };
  await putProtection(p);
  await putClientState({ v: 1 });
  await clearSelection(2);
  await undo(2);
  await redo(2);
  await apply(2, "c1", "Delete 5 points (box)");
  await removeInvalid(2);
  const body = { cloud_revision: 2, op: "replace" as const, scope: "active" as const, tool: null, evaluate_candidate: true };
  expect(await submitSelection(body)).toEqual({ id: "j1" });
  await submitCandidate(2);
  await nearest([1, 2, 3], 0.5);
  expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
    ["GET", "/api/session", undefined],
    ["PUT", "/api/session/display-filter", f],
    ["PUT", "/api/session/protection", p],
    ["PUT", "/api/session/client-state", { v: 1 }],
    ["POST", "/api/session/selection/clear", { cloud_revision: 2 }],
    ["POST", "/api/session/undo", { cloud_revision: 2 }],
    ["POST", "/api/session/redo", { cloud_revision: 2 }],
    ["POST", "/api/session/apply", { cloud_revision: 2, candidate_id: "c1", description: "Delete 5 points (box)" }],
    ["POST", "/api/session/remove-invalid", { cloud_revision: 2 }],
    ["POST", "/api/session/selection", body],
    ["POST", "/api/session/candidate", { cloud_revision: 2 }],
    ["POST", "/api/session/nearest", { point: [1, 2, 3], radius: 0.5 }],
  ]);
});

test("UI-03 getState returns null when there is no session", async () => {
  stubFetch(() => ({ status: 404, body: { error: { code: "no_session", message: "none" } } }));
  expect(await getState()).toBeNull();
});

test("UI-114 getState maps the 200 no_session reply to null", async () => {
  stubFetch(() => ({ status: 200, body: { no_session: true } }));
  expect(await getState()).toBeNull();
});

test("UI-04 a 409 keeps its code", async () => {
  stubFetch(() => ({ status: 409, body: { error: { code: "stale_revision", message: "old" } } }));
  await expect(apply(1, "c", "d")).rejects.toMatchObject({ status: 409, code: "stale_revision" });
});
