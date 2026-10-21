import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { createRunner } from "./runner";

function setup(tool: "plane" | "thin" | "box") {
  const store = createAppStore();
  store.set({
    session: sessionFixture({ selection: { count: 300, ops: [] } }),
    tool,
    liveFirst: true,
    candidate: candidateFixture({ candidates: 300 }),
    planes: { ...createAppStore().get().planes, chosen: { normal: [0, 0, 1], d: 1, thickness: 0.03 } },
  });
  let n = 0;
  const submitted: unknown[] = [];
  const api = {
    submitSelection: vi.fn(async (b: unknown) => (submitted.push(b), { id: `j${++n}` })),
    submitCandidate: vi.fn(async () => ({ id: `j${++n}` })),
    submitPreview: vi.fn(async () => ({ id: `j${++n}` })),
    submitCommit: vi.fn(async () => ({ id: `j${++n}` })),
    discardPreview: vi.fn(async () => undefined),
    cancelJob: vi.fn(async () => undefined),
    poll: vi.fn(() => new Promise<Record<string, unknown>>(() => undefined)),
    refreshState: vi.fn(async () => undefined),
  };
  return { store, api, submitted, runner: createRunner(store, api) };
}

describe("runner with the Planes and Thin tools (20-6)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(["plane", "thin"] as const)("UI-976 a protection change re-selects for the armed %s tool instead of only the candidate", async (tool) => {
    const t = setup(tool);
    t.runner.paramsChanged("protection");
    expect(t.store.get().candidate).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.api.submitSelection).toHaveBeenCalledTimes(1);
    expect((t.submitted[0] as { tool: { type: string } }).tool.type).toBe(tool);
    expect(t.api.submitCandidate).not.toHaveBeenCalled();
  });

  it("UI-976 a protection change under the Box tool still only asks for a new candidate", async () => {
    const t = setup("box");
    t.runner.paramsChanged("protection");
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.api.submitSelection).not.toHaveBeenCalled();
    expect(t.api.submitCandidate).toHaveBeenCalledTimes(1);
  });
});
