import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../files/errors";
import { historyRows } from "../inspector/history";
import { setGlobal, setLocal, setOperationMode, acknowledge, toProtectionBody } from "../inspector/protection";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { setSeed } from "../tools/cluster/model";
import { addVertex, closePolygon, emptyPolygon, startDrawing } from "../tools/polygon/model";
import { createEditor, keyAction } from "./edit";

const hist = (n: number, cursor = n) => ({
  entries: Array.from({ length: n }, (_, i) => ({ index: i, kind: "delete", description: `Delete ${i + 1}0 points (box)`, count: (i + 1) * 10 })),
  cursor,
  can_undo: cursor > 0,
  can_redo: cursor < n,
});

function setup(session = sessionFixture()) {
  const store = createAppStore();
  store.set({ session, tool: "box" });
  const api = {
    apply: vi.fn(async (_r: number, _c: string, _d: string) => sessionFixture({ revision: { cloud: 4, params: 5 }, history: hist(1) })),
    undo: vi.fn(async (_r: number) => sessionFixture({ revision: { cloud: 5, params: 6 }, history: hist(1, 0) })),
    redo: vi.fn(async (_r: number) => sessionFixture({ history: hist(1, 1) })),
    removeInvalid: vi.fn(async (_r: number) => sessionFixture()),
    clearSelection: vi.fn(async (_r: number) => sessionFixture()),
    refreshState: vi.fn(async () => undefined),
    refreshRender: vi.fn(async () => true),
    supersedePreview: vi.fn(() => undefined),
  };
  const confirm = vi.fn(() => true);
  const ed = createEditor(store, api, confirm);
  return { store, api, confirm, ed };
}

describe("editor actions", () => {
  it("UI-75 undo/redo send the cloud revision then refresh state and render", async () => {
    const t = setup(sessionFixture({ history: hist(1, 1) }));
    await t.ed.undo();
    expect(t.api.undo).toHaveBeenCalledWith(3);
    expect(t.api.refreshRender).toHaveBeenCalled();
    expect(t.store.get().session?.history.can_redo).toBe(true);
    expect(t.store.get().candidate).toBeNull();
    await t.ed.redo();
    expect(t.api.redo).toHaveBeenCalledWith(5);
    // nothing to undo / redo: no request
    const none = setup();
    await none.ed.undo();
    await none.ed.redo();
    expect(none.api.undo).not.toHaveBeenCalled();
    expect(none.api.redo).not.toHaveBeenCalled();
  });

  it("UI-76 apply sends the candidate id and a description, then clears the candidate", async () => {
    const t = setup();
    t.store.set({ candidate: candidateFixture({ candidates: 42 }) });
    await t.ed.apply();
    expect(t.api.apply).toHaveBeenCalledWith(3, "c1", "Delete 42 points (box)");
    expect(t.store.get().candidate).toBeNull();
    expect(t.store.get().session?.history.entries).toHaveLength(1);
    expect(historyRows(t.store.get().session!)).toEqual([{ label: "Delete 10 points (box)", count: 10, current: true, undone: false }]);
    expect(t.api.refreshRender).toHaveBeenCalled();
    // a new apply after undo clears the redo branch (server state shows fewer entries)
    expect(historyRows(sessionFixture({ history: hist(3, 1) })).map((r) => r.undone)).toEqual([false, true, true]);
  });

  it("UI-702 apply while a preview job runs supersedes the preview once before the request and deletes the committed candidate only; a dismissed confirm does not", async () => {
    const t = setup();
    const order: string[] = [];
    t.api.supersedePreview.mockImplementation(() => void order.push("supersede"));
    t.api.apply.mockImplementation(async () => {
      order.push("apply");
      return sessionFixture({ revision: { cloud: 4, params: 5 }, history: hist(1) });
    });
    t.store.set({
      candidate: candidateFixture({ candidates: 42 }),
      draft: true,
      preview: { id: "p", op: "add", selected_after: 12, base_selected: 10, added: 2, removed: 0 },
      job: { busy: true, preview: true, progress: null, message: "Computing preview..." },
    });
    await t.ed.apply();
    expect(order).toEqual(["supersede", "apply"]);
    expect(t.api.apply).toHaveBeenCalledWith(3, "c1", "Delete 42 points (box)");
    expect(t.store.get().draft).toBe(false);
    expect(t.store.get().preview).toBeNull();
    const d = setup();
    d.confirm.mockReturnValue(false);
    d.store.set({ candidate: candidateFixture({ candidates: 600 }), job: { busy: true, preview: true, progress: null, message: null } });
    await d.ed.apply();
    expect(d.api.supersedePreview).not.toHaveBeenCalled();
    expect(d.api.apply).not.toHaveBeenCalled();
  });

  it("UI-76 apply without a current candidate sends nothing", async () => {
    const t = setup();
    await t.ed.apply();
    t.store.set({ candidate: candidateFixture({ params_revision: 1 }) });
    await t.ed.apply();
    expect(t.api.apply).not.toHaveBeenCalled();
  });

  it("UI-73 apply 409 refetches state, shows a notice and clears the candidate", async () => {
    const t = setup();
    t.store.set({ candidate: candidateFixture() });
    t.api.apply.mockRejectedValueOnce(new ApiError(409, "stale_revision", "stale"));
    await t.ed.apply();
    expect(t.api.refreshState).toHaveBeenCalled();
    expect(t.store.get().candidate).toBeNull();
    expect(t.store.get().notices.map((n) => n.text).join(" ")).toMatch(/cloud changed; preview again/);
  });

  it("UI-58 after an override apply the next request body is inherit again (global stays)", async () => {
    const t = setup();
    let p = setGlobal(t.store.get().tools.protection, { enabled: true, min: 0, max: 1 }).model;
    p = acknowledge(setLocal(setOperationMode(p, "override"), { min: 5, max: 6 }).model, true);
    t.store.update((s) => ({ ...s, tools: { ...s.tools, protection: p }, candidate: candidateFixture() }));
    await t.ed.apply();
    const r = toProtectionBody(t.store.get().tools.protection);
    expect(r.ok && r.body.operation.mode).toBe("inherit");
    expect(r.ok && r.body.global.enabled).toBe(true);
  });

  it("UI-77 camera moves never touch history", () => {
    const t = setup(sessionFixture({ history: hist(2) }));
    const before = t.store.get().session?.history;
    t.store.set({ camera: { ...t.store.get().camera, distance: 99 } });
    expect(t.store.get().session?.history).toBe(before);
    for (const f of Object.values(t.api)) expect(f).not.toHaveBeenCalled();
  });

  it("UI-78 remove-invalid only with invalid points, with a confirm", async () => {
    const none = setup();
    expect(none.ed.removeInvalidVisible()).toBe(false);
    const t = setup(sessionFixture({ counts: { ...sessionFixture().counts, invalid_active: 7, invalid_total: 7 } }));
    expect(t.ed.removeInvalidVisible()).toBe(true);
    expect(t.ed.removeInvalidLabel()).toMatch(/7/);
    t.confirm.mockReturnValueOnce(false);
    await t.ed.removeInvalid();
    expect(t.api.removeInvalid).not.toHaveBeenCalled();
    await t.ed.removeInvalid();
    expect(t.api.removeInvalid).toHaveBeenCalledWith(3);
  });

  it("UI-79 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z map to undo/redo unless a text field has focus", () => {
    expect(keyAction({ key: "z", ctrlKey: true, shiftKey: false, target: "BODY" })).toBe("undo");
    expect(keyAction({ key: "y", ctrlKey: true, shiftKey: false, target: "BODY" })).toBe("redo");
    expect(keyAction({ key: "Z", ctrlKey: true, shiftKey: true, target: "BODY" })).toBe("redo");
    expect(keyAction({ key: "z", ctrlKey: true, shiftKey: false, target: "INPUT" })).toBeNull();
    expect(keyAction({ key: "z", ctrlKey: false, shiftKey: false, target: "BODY" })).toBeNull();
  });

  it("clear selection sends the revision, resets candidate and refreshes the render", async () => {
    const t = setup(sessionFixture({ selection: { count: 4, ops: [] } }));
    t.store.set({ candidate: candidateFixture() });
    await t.ed.clearSelection();
    expect(t.api.clearSelection).toHaveBeenCalledWith(3);
    expect(t.store.get().candidate).toBeNull();
    expect(t.api.refreshRender).toHaveBeenCalled();
  });

  it("UI-106 apply asks for confirmation when the candidates are half of the active points or more (F-03)", async () => {
    const t = setup();
    t.store.set({ candidate: candidateFixture({ candidates: 450 }) }); // 450 of 900 active
    t.confirm.mockReturnValueOnce(false);
    await t.ed.apply();
    expect(t.confirm).toHaveBeenCalledTimes(1);
    expect((t.confirm.mock.calls as unknown as string[][])[0][0]).toMatch(/450 of 900 points \(50 %\)/);
    expect(t.api.apply).not.toHaveBeenCalled();
    await t.ed.apply(); // the stub confirms the second time
    expect(t.api.apply).toHaveBeenCalledTimes(1);
    const small = setup();
    small.store.set({ candidate: candidateFixture({ candidates: 449 }) });
    await small.ed.apply();
    expect(small.confirm).not.toHaveBeenCalled();
    expect(small.api.apply).toHaveBeenCalledTimes(1);
  });
  it("UI-180 the session is checked before the bulk-delete confirm: a replaced session never asks about the old one (m-1)", async () => {
    const t = setup();
    const checkSession = vi.fn(async () => false); // another tab replaced the session; the sync already reloaded
    const ed = createEditor(t.store, { ...t.api, checkSession }, t.confirm);
    t.store.set({ candidate: candidateFixture({ candidates: 450 }) });
    await ed.apply();
    expect(checkSession).toHaveBeenCalledTimes(1);
    expect(t.confirm).not.toHaveBeenCalled();
    expect(t.api.apply).not.toHaveBeenCalled();
    checkSession.mockResolvedValueOnce(true);
    await ed.apply();
    expect(t.confirm).toHaveBeenCalledTimes(1);
    expect(t.api.apply).toHaveBeenCalledTimes(1);
    // small deletes ask for nothing and do not pay for the check
    const small = setup();
    const check2 = vi.fn(async () => true);
    const ed2 = createEditor(small.store, { ...small.api, checkSession: check2 }, small.confirm);
    small.store.set({ candidate: candidateFixture({ candidates: 10 }) });
    await ed2.apply();
    expect(check2).not.toHaveBeenCalled();
  });

  it("UI-181 a double click on Apply sends one delete and no stale-preview notice (m-6)", async () => {
    const t = setup();
    let release: (s: ReturnType<typeof sessionFixture>) => void = () => undefined;
    t.api.apply.mockImplementationOnce(() => new Promise((res) => (release = res)));
    t.store.set({ candidate: candidateFixture({ candidates: 42 }) });
    const first = t.ed.apply();
    await t.ed.apply(); // the second click while the first is in flight
    release(sessionFixture({ revision: { cloud: 4, params: 5 } }));
    await first;
    expect(t.api.apply).toHaveBeenCalledTimes(1);
    expect(t.store.get().notices).toEqual([]);
    // a later apply works again
    t.store.set({ candidate: candidateFixture({ candidates: 42, cloud_revision: 4, params_revision: 5 }) });
    await t.ed.apply();
    expect(t.api.apply).toHaveBeenCalledTimes(2);
  });
});

describe("Apply with the Polygon tool (13-7, owner request a)", () => {
  const closedSquare = () => {
    let p = startDrawing(emptyPolygon());
    for (const v of [[0, 0], [4, 0], [4, 4], [0, 4]] as [number, number][]) p = addVertex(p, v);
    return { ...closePolygon(p).state, editing: true };
  };
  it("UI-667 a polygon delete disarms the tool and blanks the polygon, out of edit mode (R22-1)", async () => {
    const t = setup();
    t.store.update((s) => ({ ...s, tool: "polygon", tools: { ...s.tools, polygon: closedSquare() } }));
    t.store.set({ candidate: candidateFixture({ candidates: 42 }) });
    await t.ed.apply();
    expect(t.store.get().tool).toBe("none");
    expect(t.store.get().tools.polygon).toEqual(emptyPolygon());
  });
  it("UI-667 other tools and a refused Apply keep their shapes", async () => {
    const t = setup();
    const box = t.store.get().tools.box;
    t.store.set({ candidate: candidateFixture({ candidates: 42 }) });
    await t.ed.apply();
    expect(t.store.get().tools.box).toEqual(box);
    const stale = setup();
    stale.store.update((s) => ({ ...s, tool: "polygon", tools: { ...s.tools, polygon: closedSquare() } }));
    stale.store.set({ candidate: candidateFixture({ candidates: 42 }) });
    stale.api.apply.mockRejectedValueOnce(new ApiError(409, "stale_revision", "stale"));
    await stale.ed.apply();
    expect(stale.store.get().tools.polygon.phase).toBe("closed");
  });
});

describe("Apply disarms the tool (22-1, R22-1)", () => {
  const closedSquare = () => {
    let p = startDrawing(emptyPolygon());
    for (const v of [[0, 0], [4, 0], [4, 4], [0, 4]] as [number, number][]) p = addVertex(p, v);
    return closePolygon(p).state;
  };
  it("UI-993 a successful Delete leaves no tool armed and orbit on; the box model is unchanged", async () => {
    const t = setup();
    const box = t.store.get().tools.box;
    t.store.update((s) => ({ ...s, interaction: "pick-seed" as const }));
    t.store.set({ candidate: candidateFixture({ candidates: 42 }) });
    await t.ed.apply();
    expect(t.store.get().tool).toBe("none");
    expect(t.store.get().interaction).toBe("orbit");
    expect(t.store.get().tools.box).toEqual(box);
    expect(t.store.get().liveFirst).toBe(true);
  });
  it("UI-993 cluster drops its seed, plane drops its chosen row, polygon is blank", async () => {
    const c = setup();
    c.store.update((s) => ({ ...s, tool: "cluster" as const, tools: { ...s.tools, cluster: setSeed(s.tools.cluster, { id: 4, point: [1, 2, 3] }) } }));
    c.store.set({ candidate: candidateFixture({ candidates: 42 }) });
    await c.ed.apply();
    expect(c.store.get().tool).toBe("none");
    expect(c.store.get().tools.cluster.seed).toBeNull();
    const p = setup();
    p.store.update((s) => ({ ...s, tool: "plane" as const, planes: { ...s.planes, chosen: { normal: [0, 0, 1], d: 1, thickness: 0.03 }, chosenRow: 2 } }));
    p.store.set({ candidate: candidateFixture({ candidates: 42 }) });
    await p.ed.apply();
    expect(p.store.get().tool).toBe("none");
    expect(p.store.get().planes.chosen).toBeNull();
    expect(p.store.get().planes.chosenRow).toBeNull();
    const g = setup();
    g.store.update((s) => ({ ...s, tool: "polygon" as const, tools: { ...s.tools, polygon: closedSquare() } }));
    g.store.set({ candidate: candidateFixture({ candidates: 42 }) });
    await g.ed.apply();
    expect(g.store.get().tool).toBe("none");
    expect(g.store.get().tools.polygon).toEqual(emptyPolygon());
  });
  it("UI-993 with no tool armed Apply still runs and leaves the tool none", async () => {
    const t = setup();
    t.store.set({ tool: "none", candidate: candidateFixture({ candidates: 42 }) });
    await t.ed.apply();
    expect(t.api.apply).toHaveBeenCalledTimes(1);
    expect(t.store.get().tool).toBe("none");
  });
  const armedWithShape = (candidates = 42) => {
    const t = setup(sessionFixture({ history: hist(3, 3) }));
    t.store.update((s) => ({ ...s, tool: "polygon" as const, tools: { ...s.tools, polygon: closedSquare() } }));
    t.store.set({ candidate: candidateFixture({ candidates }) });
    return t;
  };
  const keepsTool = (t: ReturnType<typeof armedWithShape>) => {
    expect(t.store.get().tool).toBe("polygon");
    expect(t.store.get().tools.polygon.phase).toBe("closed");
  };
  it("UI-993 a refused Delete (bulk confirm No, discard confirm No, no candidate) keeps the tool and its shape", async () => {
    const bulk = armedWithShape(500);
    bulk.confirm.mockReturnValueOnce(false);
    await bulk.ed.apply();
    expect(bulk.api.apply).not.toHaveBeenCalled();
    keepsTool(bulk);
    const rolled = setup(sessionFixture({ history: hist(3, 1) }));
    rolled.store.update((s) => ({ ...s, tool: "polygon" as const, tools: { ...s.tools, polygon: closedSquare() } }));
    rolled.store.set({ candidate: candidateFixture({ candidates: 42 }) });
    rolled.confirm.mockReturnValueOnce(false);
    await rolled.ed.apply();
    expect(rolled.api.apply).not.toHaveBeenCalled();
    keepsTool(rolled);
    const none = armedWithShape();
    none.store.set({ candidate: null });
    await none.ed.apply();
    expect(none.api.apply).not.toHaveBeenCalled();
    keepsTool(none);
  });
  it("UI-993 a failed Delete (409, 413, 422 layer_locked, 500) keeps the tool and its shape", async () => {
    for (const err of [
      new ApiError(409, "stale_revision", "stale"),
      new ApiError(413, "memory_budget_exceeded", "too big"),
      new ApiError(422, "layer_locked", "locked"),
      new ApiError(500, "internal", "boom"),
    ]) {
      const t = armedWithShape();
      t.api.apply.mockRejectedValueOnce(err);
      await t.ed.apply();
      keepsTool(t);
    }
  });
});
