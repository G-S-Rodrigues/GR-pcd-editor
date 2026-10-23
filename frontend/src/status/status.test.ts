import { expect, test } from "vitest";
import { createAppStore, initialState } from "../state/app";
import type { Candidate, SessionState } from "../state/types";
import { applyPreset } from "../view/presets";
import { footerItems, modeIndicator, statusItems } from "./model";

const session = (over: Partial<SessionState> = {}) =>
  ({
    filename: "a.pcd",
    unit: "m",
    unsaved: false,
    revision: { cloud: 3, params: 4 },
    counts: { original: 1000, active: 900, deleted: 100, invalid_total: 5, invalid_active: 2, displayed: 800, selected: 50, protected: 7 },
    ...over,
  }) as SessionState;
const cand = (over: Partial<Candidate> = {}): Candidate =>
  ({ candidate_id: "c", cloud_revision: 3, params_revision: 4, selected_active: 50, protected_retained: 7, candidates: 43, selected_outside_display_filter: 0, bounds: null, effective_protection: null, cluster: null, ...over });

test("UI-23 status lists labelled counts in order", () => {
  const items = statusItems({ ...initialState(), session: session(), candidate: cand(), render: { count: 300, eligible: 800 } as never, budget: 300 });
  expect(items.slice(0, 6).map((i) => i.label)).toEqual(["Original", "Active", "Displayed", "Selected", "Protected", "Candidates"]);
  const m = Object.fromEntries(items.map((i) => [i.label, i.value]));
  expect(m.Original).toBe("1,000");
  expect(m.Active).toBe("900");
  expect(m.Displayed).toBe("800");
  expect(m.Selected).toBe("50");
  expect(m.Protected).toBe("7");
  expect(m.Candidates).toBe("43");
  expect(m["Invalid (active/total)"]).toBe("2 / 5");
  expect(m["Deleted"]).toBe("10.00%");
  expect(m.Rendered).toBe("300 of 800 eligible (sampled to budget)");
  expect(m.Unsaved).toBe("No");
  expect(items.map((i) => i.label)).not.toContain("Total");
});

test("UI-23 candidates show a dash without a current candidate; rendered is never a cloud count", () => {
  const none = statusItems({ ...initialState(), session: session() });
  expect(none.find((i) => i.label === "Candidates")?.value).toBe("—");
  const stale = statusItems({ ...initialState(), session: session(), candidate: cand({ params_revision: 3 }) });
  expect(stale.find((i) => i.label === "Candidates")?.value).toBe("—");
  expect(none.find((i) => i.label === "Original")?.value).toBe("1,000");
  const r = none.find((i) => i.label === "Rendered");
  expect(r?.value).toBe("—");
});

test("UI-23 unsaved flag, job progress and no-session state", () => {
  const items = statusItems({ ...initialState(), session: session({ unsaved: true }), job: { busy: true, progress: 0.5, message: "Selecting" } });
  expect(items.find((i) => i.label === "Unsaved")?.value).toBe("Yes");
  expect(items.find((i) => i.label === "Job")?.value).toBe("Selecting 50%");
  expect(statusItems(createAppStore().get())).toEqual([]);
});

test("UI-24 mode and frame indicator is always present", () => {
  expect(modeIndicator(initialState())).toBe("Tool: None · Op: Add · Scope: Displayed · Frame: file (Z up) · Unit: m (assumed)");
  expect(modeIndicator({ ...initialState(), tool: "box", op: "subtract", scope: "active", session: session({ unit: "mm" }) })).toBe(
    "Tool: Box · Op: Subtract · Scope: Active · Frame: file (Z up) · Unit: mm (assumed)",
  );
  expect(modeIndicator({ ...initialState(), interaction: "pick-pivot" })).toContain("Tool: Pick pivot");
});

test("UI-170 Pick floor point in a non-face view says which view makes the floor a line; a face view and other picks do not", () => {
  const HINT = "Use Front, Back, Left or Right view so the floor is a line";
  const base = { ...initialState(), interaction: "pick-floor" as const };
  const persp = { ...base, camera: { ...base.camera, ortho: false } };
  expect(modeIndicator(persp)).toContain(HINT);
  expect(modeIndicator({ ...persp, camera: { ...persp.camera, ortho: false } })).toContain(HINT);
  expect(modeIndicator({ ...persp, camera: applyPreset(persp.camera, "front") })).not.toContain(HINT);
  expect(modeIndicator({ ...persp, camera: applyPreset(persp.camera, "left") })).not.toContain(HINT);
  expect(modeIndicator({ ...initialState(), interaction: "pick-pivot" })).not.toContain(HINT);
  expect(modeIndicator({ ...initialState(), interaction: "orbit" })).not.toContain(HINT);
});

test("UI-183 the Rendered value does not repeat its own label (m-4)", () => {
  const v = (count: number, eligible: number) =>
    statusItems({ ...initialState(), session: session(), render: { count, eligible } as never, budget: 1000 }).find((i) => i.label === "Rendered")?.value;
  expect(v(993000, 993000)).toBe("all 993,000 eligible points");
  expect(v(100, 993000)).toBe("100 of 993,000 eligible (sampled to budget)");
});

test("UI-184 Protected shows an update marker until the server has the protection the panel holds (m-13)", () => {
  const server = session({ protection: { global: { enabled: false, min: 0, max: 0 }, operation: { mode: "inherit", local: null, acknowledge_override: false } } } as never);
  const base = { ...initialState(), session: server };
  const protectedOf = (s: typeof base) => statusItems(s).find((i) => i.label === "Protected")?.value;
  expect(protectedOf(base)).toBe("7");
  const picked = { ...base, tools: { ...base.tools, protection: { ...base.tools.protection, global: { enabled: true, min: -0.05, max: 0.05 } } } };
  expect(protectedOf(picked)).toBe("updating…");
  const synced = { ...picked, session: session({ protection: { global: { enabled: true, min: -0.05, max: 0.05 }, operation: { mode: "inherit", local: null, acknowledge_override: false } } } as never) };
  expect(protectedOf(synced)).toBe("7");
  // a disabled panel with other numbers is not pending
  const off = { ...base, tools: { ...base.tools, protection: { ...base.tools.protection, global: { enabled: false, min: 5, max: 6 } } } };
  expect(protectedOf(off)).toBe("7");
});

test("UI-1139 (items) footerItems is statusItems without Original, Active and Unsaved, in the same order", () => {
  const st = { ...initialState(), session: session(), candidate: cand(), render: { count: 300, eligible: 800 } as never, budget: 300 };
  const all = statusItems(st).map((i) => i.label);
  expect(footerItems(st).map((i) => i.label)).toEqual(all.filter((l) => !["Original", "Active", "Unsaved"].includes(l)));
  expect(footerItems(st).map((i) => i.label)).toEqual(["Displayed", "Selected", "Protected", "Candidates", "Invalid (active/total)", "Deleted", "Rendered", "Job"]);
  expect(footerItems(initialState())).toEqual([]);
});
