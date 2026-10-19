import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../files/errors";
import { historyRows } from "../inspector/history";
import { setGlobal, setLocal, setOperationMode, acknowledge, toProtectionBody } from "../inspector/protection";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
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
  it("UI-667 a polygon delete leaves the tool armed with an empty polygon, out of edit mode, ready for the next shape", async () => {
    const t = setup();
    t.store.update((s) => ({ ...s, tool: "polygon", tools: { ...s.tools, polygon: closedSquare() } }));
    t.store.set({ candidate: candidateFixture({ candidates: 42 }) });
    await t.ed.apply();
    expect(t.store.get().tool).toBe("polygon");
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
