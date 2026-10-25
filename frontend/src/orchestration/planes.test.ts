import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../files/errors";
import { emptyProtection } from "../inspector/protection";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type DetectedPlane } from "../tools/plane/model";
import { DETECTING_TEXT, createPlanesController, planesNote } from "./planes";

const plane = (z: number, count: number, over: Partial<DetectedPlane> = {}): DetectedPlane => ({
  normal: [0, 0, 1], d: z, count, rms: 0.01, tilt_deg: 0, z_centre: z, bounds: { min: [0, 0, z], max: [10, 10, z] }, ...over,
});

interface Poll {
  id: string;
  signal?: AbortSignal;
  onProgress?: (p: number | null, m: string | null) => void;
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: unknown) => void;
}

function setup() {
  const store = createAppStore();
  store.set({ session: sessionFixture() });
  const polls: Poll[] = [];
  const detects: unknown[] = [];
  const cancelled: string[] = [];
  let n = 0;
  const api = {
    detect: vi.fn(async (b: unknown) => {
      detects.push(b);
      return { id: `d${++n}` };
    }),
    poll: vi.fn(
      (id: string, opts: { signal?: AbortSignal; onProgress?: (p: number | null, m: string | null) => void }) =>
        new Promise<Record<string, unknown>>((resolve, reject) => polls.push({ id, ...opts, resolve, reject })),
    ),
    cancelJob: vi.fn(async (id: string) => void cancelled.push(id)),
  };
  const deps = { confirm: vi.fn((_m: string) => true), toolChanged: vi.fn() };
  const protectionEdit = vi.fn((fn: (m: ReturnType<typeof emptyProtection>) => { ok: boolean; model: ReturnType<typeof emptyProtection>; error?: string }) => {
    const r = fn(store.get().tools.protection);
    if (r.ok) store.update((s) => ({ ...s, tools: { ...s.tools, protection: r.model } }));
    return r;
  });
  const ctl = createPlanesController(store, api, { protectionEdit, confirm: deps.confirm, toolChanged: deps.toolChanged });
  return { store, api, ctl, polls, detects, cancelled, protectionEdit, confirm: deps.confirm, toolChanged: deps.toolChanged };
}
const done = (revision: number, planes: DetectedPlane[], over: Record<string, unknown> = {}) => ({ cloud_revision: revision, scope: "displayed", eligible: 1234, planes, ...over });
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("planes controller (20-6)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("UI-971 detect posts once with the parameters, shows Detecting planes with the progress fraction, ignores a second press, and Cancel cancels the job", async () => {
    const t = setup();
    void t.ctl.detect();
    void t.ctl.detect();
    await flush();
    expect(t.detects).toHaveLength(1);
    expect(t.detects[0]).toEqual({ cloud_revision: 3, scope: "displayed", distance: 0.1, max_tilt_deg: 5, max_planes: 1, region: null, exclude_protected: true });
    expect(t.store.get().planes.busy).toBe(true);
    expect(planesNote(t.store.get())).toBe(DETECTING_TEXT);
    t.polls[0].onProgress?.(0.5, "testing planes");
    expect(planesNote(t.store.get())).toBe(`${DETECTING_TEXT} testing planes 50%`);
    t.ctl.cancel();
    await flush();
    expect(t.polls[0].signal?.aborted).toBe(true);
    expect(t.cancelled).toEqual(["d1"]);
    expect(t.store.get().planes).toMatchObject({ busy: false, list: null });
    t.polls[0].reject(new ApiError(0, "cancelled", "the job was cancelled"));
    await flush();
    expect(t.store.get().planes.list).toBeNull();
    expect(t.store.get().notices).toEqual([]);
  });

  it("UI-972 a result for an older cloud revision is dropped with a notice; a current one replaces the list and keeps the scope and count", async () => {
    const t = setup();
    void t.ctl.detect();
    await flush();
    t.store.update((s) => ({ ...s, session: sessionFixture({ revision: { cloud: 4, params: 4 } }) }));
    t.polls[0].resolve(done(3, [plane(0, 10)]));
    await flush();
    expect(t.store.get().planes.list).toBeNull();
    expect(t.store.get().notices.map((n) => n.code)).toContain("planes_stale");
    void t.ctl.detect();
    await flush();
    t.polls[1].resolve(done(4, [plane(0, 1600), plane(3, 900)]));
    await flush();
    const p = t.store.get().planes;
    expect(p.list?.map((x) => x.count)).toEqual([1600, 900]);
    expect(p).toMatchObject({ eligible: 1234, scope: "displayed", revision: 4, busy: false });
    expect(t.store.get().notices.map((n) => n.code)).not.toContain("planes_stale");
    // a newer detect replaces the list
    void t.ctl.detect();
    await flush();
    t.polls[2].resolve(done(4, [plane(1, 5)]));
    await flush();
    expect(t.store.get().planes.list).toHaveLength(1);
  });

  it("UI-972 a 409 from the detect request maps to the stale notice, other failures to an error notice", async () => {
    const t = setup();
    t.api.detect.mockRejectedValueOnce(new ApiError(409, "stale_revision", "old"));
    await t.ctl.detect();
    expect(t.store.get().notices.map((n) => n.code)).toEqual(["planes_stale"]);
    expect(t.store.get().planes.busy).toBe(false);
    t.api.detect.mockRejectedValueOnce(new ApiError(413, "memory_budget_exceeded", "too big"));
    await t.ctl.detect();
    expect(t.store.get().notices.at(-1)).toMatchObject({ code: "planes_failed", level: "error", text: "too big" });
  });

  it("UI-973 choosing a row arms the Planes tool with that plane, as the first selection, and runs the tool path", async () => {
    const t = setup();
    void t.ctl.detect();
    await flush();
    t.polls[0].resolve(done(3, [plane(0, 1600), plane(3, 900)]));
    await flush();
    t.ctl.select(1);
    const s = t.store.get();
    expect(s.tool).toBe("plane");
    expect(s.liveFirst).toBe(true);
    expect(s.planes.chosenRow).toBe(1);
    expect(s.planes.chosen).toEqual({ normal: [0, 0, 1], d: 3, thickness: 0.1 });
    expect(t.toolChanged).toHaveBeenCalledTimes(1);
    t.ctl.select(9);
    expect(t.toolChanged).toHaveBeenCalledTimes(1);
  });

  it("UI-974 Use as protection band puts the protection once; an enabled band asks first (No changes nothing); a refusal shows under the row", async () => {
    const t = setup();
    void t.ctl.detect();
    await flush();
    const steep = plane(0, 10, { normal: [0.9, 0, Math.sqrt(1 - 0.81)] });
    t.polls[0].resolve(done(3, [plane(2, 100), steep]));
    await flush();
    t.ctl.band(0);
    expect(t.protectionEdit).toHaveBeenCalledTimes(1);
    expect(t.confirm).not.toHaveBeenCalled();
    expect(t.store.get().tools.protection.global).toMatchObject({ enabled: true });
    expect(t.store.get().tools.protection.global.min).toBeCloseTo(1.9, 12);
    expect(t.store.get().planes.rowNote).toBeNull();
    // a band is enabled now: the second use asks, naming it; No changes nothing
    t.confirm.mockReturnValueOnce(false);
    t.ctl.band(0);
    expect(t.confirm).toHaveBeenCalledTimes(1);
    expect(t.confirm.mock.calls[0]?.[0]).toMatch(/^Replace the protection band 1\.9 to 2\.1 \(level\)/);
    expect(t.protectionEdit).toHaveBeenCalledTimes(1);
    t.ctl.band(0); // Yes
    expect(t.protectionEdit).toHaveBeenCalledTimes(2);
    // refusal: no confirm, no protection edit, the text under the row
    t.ctl.band(1);
    expect(t.confirm).toHaveBeenCalledTimes(2);
    expect(t.protectionEdit).toHaveBeenCalledTimes(2);
    expect(t.store.get().planes.rowNote).toMatchObject({ row: 1 });
    expect(t.store.get().planes.rowNote?.text).toMatch(/allows at most 60 on each/);
  });

  it("UI-977 Clear selection (disarmed) drops the chosen plane and keeps the detected list", async () => {
    const { disarmed } = await import("./toolstate");
    const t = setup();
    void t.ctl.detect();
    await flush();
    t.polls[0].resolve(done(3, [plane(0, 5)]));
    await flush();
    t.ctl.select(0);
    t.store.update((s) => disarmed(s));
    expect(t.store.get().tool).toBe("none");
    expect(t.store.get().planes.chosen).toBeNull();
    expect(t.store.get().planes.chosenRow).toBeNull();
    expect(t.store.get().planes.list).toHaveLength(1);
  });

  it("UI-978 the note says No planes found with the point count for an empty result", async () => {
    const t = setup();
    void t.ctl.detect();
    await flush();
    t.polls[0].resolve(done(3, [], { eligible: 12000 }));
    await flush();
    expect(planesNote(t.store.get())).toBe("No planes found among 12,000 points (detection used the displayed points; the display filter applies).");
  });

  it("UI-979 with Active scope the note says the active points were used; a stale list says to detect again", async () => {
    const t = setup();
    t.store.set({ scope: "active" });
    void t.ctl.detect();
    await flush();
    expect((t.detects[0] as { scope: string }).scope).toBe("active");
    t.polls[0].resolve(done(3, [plane(0, 5)], { scope: "active" }));
    await flush();
    expect(planesNote(t.store.get())).toBe("1 found among 1,234 points (detection used the active points).");
    t.store.update((s) => ({ ...s, session: sessionFixture({ revision: { cloud: 9, params: 4 } }) }));
    expect(planesNote(t.store.get())).toMatch(/The cloud changed since; detect again\.$/);
  });
});
