import { expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { exportDefaults, exportInfo, runExport } from "./export";
import { runSave } from "./session-save";

const counts = (over = {}) => ({ ...sessionFixture().counts, ...over });

test("UI-88 export defaults to active scope and binary, even with display filters hiding points", () => {
  const store = createAppStore();
  store.set({ session: sessionFixture({ counts: counts({ displayed: 10 }) }) });
  expect(exportDefaults()).toEqual({ scope: "active", format: "binary" });
});

test("UI-88 scope summary states exact counts and what is excluded", () => {
  const c = counts({ original: 100_000, active: 92_345, displayed: 12_345, selected: 7, invalid_active: 3 });
  expect(exportInfo(c, "displayed").summary).toBe("Exports 12,345 displayed points; 80,000 active points are excluded");
  expect(exportInfo(c, "selected").summary).toBe("Exports 7 selected points; 92,338 active points are excluded");
  expect(exportInfo(c, "active").summary).toBe("Exports all 92,345 active points; 7,655 deleted points are excluded");
  expect(exportInfo(c, "active").retainedInvalid).toBe("3 invalid (NaN/Infinity) points are retained in the export");
  expect(exportInfo(counts({ invalid_active: 0 }), "active").retainedInvalid).toBeNull();
  expect(exportInfo(c, "active").structureNote).toMatch(/organised.*structure.*lost/i);
});

test("UI-88 the default export request is exactly scope active", async () => {
  const startExport = vi.fn(async () => ({ url: "/api/exports/e", filename: "a_cleaned.pcd" }));
  const store = createAppStore();
  await runExport(store, exportDefaults(), { startExport });
  expect(startExport).toHaveBeenCalledWith("binary", "active");
});

test("UI-90 export wording: the browser decides where it is saved, with the suggested filename", async () => {
  const store = createAppStore();
  const r = await runExport(store, exportDefaults(), {
    startExport: async () => ({ url: "/u", filename: "a_cleaned.pcd" }),
  });
  expect(r).toEqual({
    ok: true,
    message: "Export prepared; your browser decides where it is saved. Suggested name: a_cleaned.pcd. The source file is never overwritten.",
  });
  expect(store.get().notices.at(-1)?.text).toBe(r.message);
});

test("UI-90 a failed export reports a notice and no success", async () => {
  const store = createAppStore();
  const r = await runExport(store, exportDefaults(), {
    startExport: async () => {
      throw new Error("disk full");
    },
  });
  expect(r.ok).toBe(false);
  expect(store.get().notices.at(-1)?.level).toBe("error");
  expect(store.get().notices.at(-1)?.text).toContain("disk full");
});

test("UI-89 save session: download, then mark saved; wording says started, never saved to disk", async () => {
  const store = createAppStore();
  store.set({ session: sessionFixture({ unsaved: true }) });
  const order: string[] = [];
  const r = await runSave(store, {
    startSave: async () => {
      order.push("download");
      return { url: "/u", filename: "a_session_v1.pcdsession", archiveId: "ar1" };
    },
    markSaved: async (id) => {
      order.push(`mark:${id}`);
      return sessionFixture({ unsaved: false });
    },
  });
  expect(order).toEqual(["download", "mark:ar1"]);
  expect(r.ok).toBe(true);
  expect(r.message).toMatch(/^Session download started/);
  expect(r.message).not.toMatch(/saved to disk/i);
  expect(store.get().session?.unsaved).toBe(false);
});

test("UI-89 a failed mark-saved keeps Unsaved", async () => {
  const store = createAppStore();
  store.set({ session: sessionFixture({ unsaved: true }) });
  const r = await runSave(store, {
    startSave: async () => ({ url: "/u", filename: "f.pcdsession", archiveId: "a" }),
    markSaved: async () => {
      throw new Error("nope");
    },
  });
  expect(r.ok).toBe(false);
  expect(store.get().session?.unsaved).toBe(true);
  expect(store.get().notices.at(-1)?.level).toBe("error");
});

test("UI-89 a failed save job never marks saved", async () => {
  const store = createAppStore();
  store.set({ session: sessionFixture({ unsaved: true }) });
  const markSaved = vi.fn();
  const r = await runSave(store, {
    startSave: async () => {
      throw new Error("save failed");
    },
    markSaved,
  });
  expect(r.ok).toBe(false);
  expect(markSaved).not.toHaveBeenCalled();
  expect(store.get().session?.unsaved).toBe(true);
});
