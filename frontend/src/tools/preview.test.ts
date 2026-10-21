import { describe, expect, test } from "vitest";
import { PALETTE } from "../colour/palette";
import { colourize } from "../colour/modes";
import { lodIndex } from "../render/lod";
import { initialState } from "../state/app";
import { legendEntries } from "../ui/legend";
import { FLAG_PREVIEW_ADD, FLAG_PREVIEW_REMOVE, commitEnabled, commitLabel, discardEnabled, previewClusterOf, previewParts, previewText } from "./preview";
import type { PreviewState } from "../state/types";

const P: PreviewState = { id: "p1", op: "add", selected_after: 120, base_selected: 100, added: 20, removed: 0 };
const base = { ...initialState(), draft: true, tool: "box" as const, op: "add" as const };

describe("preview model (12b-3)", () => {
  test("UI-400 text per op names the counts and the base, never invents one while the job runs", () => {
    const add = previewText({ ...base, preview: P })!;
    expect(add).toMatch(/would select 120 points \(20 new\)/);
    expect(previewParts({ ...base, preview: P })!.title).toMatch(/still 100 points/); // 17-10: the rest of the sentence is the note's tooltip
    expect(add).toMatch(/Apply uses only those 100 committed points/);
    const sub = previewText({ ...base, op: "subtract", preview: { ...P, op: "subtract", selected_after: 70, added: 0, removed: 30 } })!;
    expect(sub).toMatch(/would leave 70 selected \(30 removed\)/);
    const inter = previewText({ ...base, op: "intersect", preview: { ...P, op: "intersect", selected_after: 5, added: 0, removed: 95 } })!;
    expect(inter).toMatch(/would leave 5 selected \(95 removed\)/);
    const busy = previewText({ ...base, preview: P, job: { busy: true, progress: null, message: "x" } })!;
    expect(busy).toBe("Computing preview...");
    expect(previewText({ ...base, preview: null, job: { busy: true, progress: null, message: "x" } })).toBe("Computing preview...");
    expect(previewText({ ...base, draft: false, preview: null })).toBeNull();
    expect(previewText({ ...base, preview: { ...P, selected_after: 1234567 } })).toMatch(/1,234,567/);
  });

  test("UI-401 the two preview colours are pairwise distinct from every other palette colour (RGB distance >= 0.25)", () => {
    const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const others = [PALETTE.selected, PALETTE.protected, PALETTE.protectedStrong, PALETTE.deleted, PALETTE.step, PALETTE.base];
    for (const c of [PALETTE.previewAdd, PALETTE.previewRemove]) for (const o of others) expect(dist(c, o)).toBeGreaterThanOrEqual(0.25);
    expect(dist(PALETTE.previewAdd, PALETTE.previewRemove)).toBeGreaterThanOrEqual(0.25);
  });

  test("UI-402 colourize precedence: protected > add > remove > selected > deleted", () => {
    const flags = Uint8Array.from([
      2 | FLAG_PREVIEW_ADD, // protected wins
      1 | FLAG_PREVIEW_ADD, // add beats selected
      FLAG_PREVIEW_REMOVE, // remove (not selected)
      1 | FLAG_PREVIEW_REMOVE,
      1,
      4,
      4 | FLAG_PREVIEW_ADD,
    ]);
    const r = { count: 7, coords: new Float32Array(21), flags, origin: [0, 0, 0] as [number, number, number] };
    const out = colourize(r as never, { mode: "flat", bounds: null, markDeleted: true } as never);
    const at = (i: number) => Array.from(out.subarray(3 * i, 3 * i + 3));
    const same = (i: number, c: readonly number[]) => c.forEach((v, k) => expect(at(i)[k]).toBeCloseTo(v, 5));
    same(0, PALETTE.protected);
    same(1, PALETTE.previewAdd);
    same(2, PALETTE.previewRemove);
    same(3, PALETTE.previewRemove);
    same(4, PALETTE.selected);
    same(5, PALETTE.deleted);
    same(6, PALETTE.previewAdd);
  });

  test("UI-403 the interaction LOD keeps the flag 8 and 16 points", () => {
    const n = 1_000_000;
    const flags = new Uint8Array(n);
    flags[3] = FLAG_PREVIEW_ADD;
    flags[500_001] = FLAG_PREVIEW_REMOVE;
    const idx = lodIndex(n, 150_000, flags)!;
    const set = new Set(idx);
    expect(set.has(3)).toBe(true);
    expect(set.has(500_001)).toBe(true);
  });

  test("UI-404 legend rows Will be added / Will be removed only while a preview of that op is active", () => {
    expect(legendEntries().map((e) => e.id)).toEqual(["base", "selected", "protected", "slab", "deleted"]);
    expect(legendEntries(false, null).map((e) => e.id)).toEqual(["base", "selected", "protected", "slab", "deleted"]);
    const add = legendEntries(false, "add");
    expect(add.map((e) => e.id)).toContain("preview-add");
    expect(add.map((e) => e.id)).not.toContain("preview-remove");
    expect(add.find((e) => e.id === "preview-add")?.label).toBe("Will be added");
    for (const op of ["subtract", "intersect"] as const) {
      const r = legendEntries(true, op);
      expect(r.map((e) => e.id)).toContain("preview-remove");
      expect(r.map((e) => e.id)).not.toContain("preview-add");
      expect(r.find((e) => e.id === "preview-remove")?.label).toBe("Will be removed");
      expect(r.map((e) => e.id)).toContain("step");
    }
  });

  test("UI-413 the cluster panel reads the preview's cluster summary while a preview is pending, else the candidate's", () => {
    const pc = { seed_id: 1, radius: 0.5, size: 9, complete: true, bounds: { min: [0, 0, 0], max: [1, 1, 1] } };
    const cc = { ...pc, size: 4 };
    const cand = { candidates: 4, cluster: cc } as never;
    expect((previewClusterOf({ ...base, preview: { ...P, cluster: pc }, candidate: cand }) as typeof pc).size).toBe(9);
    expect((previewClusterOf({ ...base, preview: null, candidate: cand }) as typeof pc).size).toBe(4);
    expect(previewClusterOf({ ...base, preview: P, candidate: null })).toBeNull();
  });
});

describe("preview controls (12b-4)", () => {
  test("UI-416 commit is enabled only with a ready preview of the chosen op, and is labelled with its count", () => {
    expect(commitEnabled({ ...base, preview: null })).toBe(false);
    expect(commitEnabled({ ...base, preview: P })).toBe(true);
    expect(commitEnabled({ ...base, preview: P, job: { busy: true, progress: null, message: "x" } })).toBe(false);
    expect(commitEnabled({ ...base, op: "subtract", preview: P })).toBe(false);
    expect(commitEnabled({ ...base, draft: false, preview: P })).toBe(false);
    expect(commitLabel({ ...base, preview: P })).toBe("Commit: add 20 points");
    expect(commitLabel({ ...base, op: "subtract", preview: { ...P, op: "subtract", added: 0, removed: 1234 } })).toBe("Commit: remove 1,234 points");
    expect(commitLabel({ ...base, preview: null })).toBe("Commit: add tool shape");
    expect(commitLabel({ ...base, draft: false })).toBe("Commit draft");
  });
  test("UI-417 discard is enabled while there is a draft or a preview", () => {
    expect(discardEnabled({ ...base, draft: false, preview: null })).toBe(false);
    expect(discardEnabled({ ...base, draft: true, preview: null })).toBe(true);
    expect(discardEnabled({ ...base, draft: false, preview: P })).toBe(true);
  });
});

describe("Live preview off (13-4)", () => {
  test("UI-623 with Live preview off a draft alone enables Commit and the note says it computes on commit", () => {
    const off = { ...base, previewLive: false, draft: true, preview: null };
    expect(commitEnabled(off)).toBe(true);
    expect(commitEnabled({ ...off, job: { busy: true, progress: null, message: "x" } })).toBe(false);
    expect(commitEnabled({ ...off, draft: false })).toBe(false);
    expect(previewText(off)).toMatch(/Live preview is off/);
    expect(commitEnabled({ ...base, previewLive: true, preview: null })).toBe(false);
  });
});
