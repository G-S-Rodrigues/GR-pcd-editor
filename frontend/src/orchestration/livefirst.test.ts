import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppStore } from "../state/app";
import { applyClientPatch, restoreClientState, serialiseClientState } from "../state/persist";
import { sessionFixture } from "../testing/fixtures";
import { setCenter } from "../tools/box/model";
import { SECTION_IDS } from "../ui/sections";
import { KEY_DOCS } from "../ui/keys";
import { rectDepth } from "../tools/box/rect";
import { createRunner } from "./runner";
import { buildSelection, shouldPreview } from "./selection";

function harness(count: number) {
  const store = createAppStore();
  store.set({ session: sessionFixture({ selection: { count, ops: [] } }), tool: "box", liveFirst: true });
  const sent: { op: string; tool: { center: number[] } }[] = [];
  const previews: unknown[] = [];
  let n = 0;
  const api = {
    submitSelection: vi.fn(async (b: unknown) => (sent.push(b as never), { id: `j${++n}` })),
    submitCandidate: vi.fn(async () => ({ id: `j${++n}` })),
    submitPreview: vi.fn(async (b: unknown) => (previews.push(b), { id: `j${++n}` })),
    submitCommit: vi.fn(async () => ({ id: `j${++n}` })),
    discardPreview: vi.fn(async () => undefined),
    cancelJob: vi.fn(async () => undefined),
    poll: vi.fn(async (id: string) =>
      id.startsWith("j") && previews.length > 0 && sent.length === 0
        ? { preview_id: "p1", selected_after: 5, base_selected: count, added: 1, removed: 0 }
        : { selected: 1, operand: 1, candidate: null },
    ),
    refreshState: vi.fn(async () => undefined),
  };
  const runner = createRunner(store, api);
  const edit = (x: number) => {
    store.update((s) => ({ ...s, tools: { ...s.tools, box: setCenter(s.tools.box, [x, 0, 0]).box } }));
    runner.onToolChanged();
  };
  return { store, api, runner, sent, previews, edit };
}
const settle = async () => {
  await vi.advanceTimersByTimeAsync(250);
  await vi.advanceTimersByTimeAsync(0);
};

describe("first selection is live (13-3)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("UI-600 buildSelection sends the wire replace only while liveFirst", () => {
    const h = harness(0);
    const b = buildSelection(h.store.get());
    expect(b.ok && b.body.op).toBe("replace");
    h.store.set({ liveFirst: false, op: "subtract" });
    const c = buildSelection(h.store.get());
    expect(c.ok && c.body.op).toBe("subtract");
  });

  it("UI-601 dragging the first box three times sends three replaces and no preview: no accumulation", async () => {
    const h = harness(0);
    for (const x of [1, 2, 3]) {
      h.edit(x);
      await settle();
      h.store.update((s) => ({ ...s, session: sessionFixture({ selection: { count: 4, ops: [] } }) })); // the result landed
    }
    expect(h.sent.map((b) => b.op)).toEqual(["replace", "replace", "replace"]);
    expect(h.sent.map((b) => b.tool.center[0])).toEqual([1, 2, 3]);
    expect(h.api.submitPreview).not.toHaveBeenCalled();
    expect(shouldPreview(h.store.get())).toBe(false);
  });

  it("UI-602 after an operation is chosen the next edit previews against the selection", async () => {
    const h = harness(4);
    h.store.set({ liveFirst: false, op: "add" });
    h.edit(7);
    await settle();
    expect(h.api.submitPreview).toHaveBeenCalledTimes(1);
    expect(h.api.submitSelection).not.toHaveBeenCalled();
    expect((h.previews[0] as { op: string }).op).toBe("add");
  });

  it("UI-603 a commit ends the first selection", async () => {
    const h = harness(4);
    h.store.set({ liveFirst: false, op: "add" });
    h.edit(7);
    await settle();
    h.runner.commitDraft();
    await settle();
    expect(h.api.submitCommit).toHaveBeenCalledTimes(1);
    expect(h.store.get().liveFirst).toBe(false);
  });

  it("UI-604 the default op is add and liveFirst starts false", () => {
    const s = createAppStore().get();
    expect(s.op).toBe("add");
    expect(s.liveFirst).toBe(false);
  });

  it("UI-605 liveFirst and op are never saved; a saved replace restores as add", () => {
    const a = createAppStore();
    a.update((s) => ({ ...s, liveFirst: true, op: "subtract" }));
    const saved = JSON.parse(JSON.stringify(serialiseClientState(a.get())));
    expect(JSON.stringify(saved)).not.toMatch(/liveFirst|subtract/);
    const old = restoreClientState({ v: 1, ui: { op: "replace" } });
    const out = applyClientPatch(createAppStore().get(), old!);
    expect(out.op).toBe("add");
    expect(out.liveFirst).toBe(false);
  });

  it("UI-606 the wire type still carries replace and invert (one-shot bodies)", () => {
    const body: import("./selection").SelectionRequest[] = [
      { cloud_revision: 1, op: "replace", scope: "displayed", tool: null, evaluate_candidate: true },
      { cloud_revision: 1, op: "invert", scope: "displayed", tool: null, evaluate_candidate: true },
    ];
    expect(body.map((b) => b.op)).toEqual(["replace", "invert"]);
  });
});

describe("Slice view removal (13-3)", () => {
  it("UI-607 AppState has no slice and no pick-slice interaction", () => {
    const s = createAppStore().get() as unknown as Record<string, unknown>;
    expect("slice" in s).toBe(false);
  });

  it("UI-608 the key table has no [ or ] rows", () => {
    const keys = KEY_DOCS.map((d) => d.keys);
    expect(keys).not.toContain("[");
    expect(keys).not.toContain("]");
  });

  it("UI-609 there is no slice section id", () => {
    expect(SECTION_IDS as readonly string[]).not.toContain("slice");
  });

  it("UI-610 rectDepth with no slice is the full active extent along the view axis", () => {
    const b = { min: [-1, 0, 5] as [number, number, number], max: [19, 19, 9] as [number, number, number] };
    expect([0, 1, 2].map((a) => rectDepth(a as 0 | 1 | 2, b))).toEqual([
      { min: -1, max: 19 },
      { min: 0, max: 19 },
      { min: 5, max: 9 },
    ]);
  });

  it("UI-611 an old saved ui.slice and sectionsOpen.slice are ignored without error and not written back", () => {
    const patch = restoreClientState({
      v: 1,
      ui: { slice: { enabled: true, axis: "z", centre: 1, thickness: 2 }, sectionsOpen: { slice: false } },
    });
    const out = applyClientPatch(createAppStore().get(), patch ?? {}) as unknown as Record<string, unknown>;
    expect("slice" in out).toBe(false);
    expect((patch?.sectionsOpen ?? {}) as Record<string, unknown>).toEqual({});
    const saved = JSON.stringify(serialiseClientState(createAppStore().get()));
    expect(saved).not.toMatch(/slice/);
  });
});
