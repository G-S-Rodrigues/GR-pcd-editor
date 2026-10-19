import { describe, expect, it, vi } from "vitest";
import { createAppStore } from "../state/app";
import type { HistoryEntry, StepBox } from "../state/types";
import { sessionFixture } from "../testing/fixtures";
import { EDIT_SHAPE_UNAVAILABLE } from "../tools/shape";
import { createEditShape } from "./editshape";

const box: StepBox = { type: "box", center: [1, 2, 3], dimensions: [2, 2, 2], rpy_deg: [0, 0, 30], mode: "inside" };
const entry = (sid: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ index: sid, kind: "delete", description: "d", count: 5, sid, tool: "box", ...extra });

function setup(entries: HistoryEntry[], selected = 7) {
  const store = createAppStore();
  const session = sessionFixture({ selection: { count: selected, ops: [] }, history: { entries, cursor: entries.length, can_undo: true, can_redo: false } });
  store.set({ session, tool: "none", timeline: { ...store.get().timeline, highlight: entries[0]?.sid ?? null } });
  const calls: string[] = [];
  const deps = {
    resetRunner: vi.fn(() => void calls.push("reset")),
    clearSelection: vi.fn(async () => {
      calls.push("clear");
      store.set({ session: { ...store.get().session!, selection: { count: 0, ops: [] } }, liveFirst: true });
    }),
    toolChanged: vi.fn(() => void calls.push(`changed:${store.get().tool}`)),
  };
  return { store, deps, calls, edit: createEditShape(store, deps), session };
}

describe("Edit shape (13-8)", () => {
  it("UI-676 clears the selection, arms the tool, seeds it and starts a live first selection, in that order", async () => {
    const t = setup([entry(11, { shape: box })]);
    const r = await t.edit.edit(11);
    expect(r.ok).toBe(true);
    expect(t.calls).toEqual(["reset", "clear", "changed:box"]);
    const s = t.store.get();
    expect(s.tool).toBe("box");
    expect(s.tools.box.center).toEqual([1, 2, 3]);
    expect(s.liveFirst).toBe(true);
    expect(s.draft).toBe(false);
    expect(s.timeline.highlight).toBeNull(); // the old step's highlight makes way for the live shape
  });

  it("UI-676 never touches the history: no step is added, removed or rolled back", async () => {
    const t = setup([entry(11, { shape: box }), entry(12, { shape: box })]);
    const before = t.store.get().session!.history;
    await t.edit.edit(11);
    expect(t.store.get().session!.history).toBe(before);
    expect(Object.keys(t.deps).sort()).toEqual(["clearSelection", "resetRunner", "toolChanged"]);
  });

  it("UI-677 an old step with no stored shape is refused with the reason and nothing is cleared", async () => {
    const t = setup([entry(11, { shape: null })]);
    const r = await t.edit.edit(11);
    expect(r).toEqual({ ok: false, reason: EDIT_SHAPE_UNAVAILABLE });
    expect(t.calls).toEqual([]);
    expect(t.store.get().tool).toBe("none");
    expect(t.store.get().session!.selection.count).toBe(7);
  });

  it("UI-677 a running job refuses the click with the standard notice; a missing step does nothing", async () => {
    const t = setup([entry(11, { shape: box })]);
    t.store.set({ job: { busy: true, progress: null, message: "x" } });
    const r = await t.edit.edit(11);
    expect(r.ok).toBe(false);
    expect(t.calls).toEqual([]);
    expect(t.store.get().notices.map((n) => n.code)).toContain("busy");
    t.store.set({ job: { busy: false, progress: null, message: null } });
    expect((await t.edit.edit(99)).ok).toBe(false);
    expect(t.calls).toEqual([]);
  });

  it("UI-677 if the session was replaced while the selection was clearing, the shape is not applied", async () => {
    const t = setup([entry(11, { shape: box })]);
    t.deps.clearSelection.mockImplementationOnce(async () => {
      t.store.set({ session: { ...t.store.get().session!, session_id: "other" } });
    });
    const r = await t.edit.edit(11);
    expect(r.ok).toBe(false);
    expect(t.store.get().tool).toBe("none");
  });
});
