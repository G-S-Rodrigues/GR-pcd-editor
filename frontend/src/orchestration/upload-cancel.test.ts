import { expect, test, vi } from "vitest";
import type { UploadHandle } from "../files/upload";
import { createAppStore } from "../state/app";
import { createUploadCanceller } from "./upload-cancel";

const handle = (cancelResult: boolean) => {
  const cancel = vi.fn(() => cancelResult);
  const h: UploadHandle<unknown> = { uploadId: "u1", promise: new Promise(() => undefined), cancel };
  return { h, cancel };
};

test("UI-144 cancel calls the handle once, clears the progress and a second press does nothing", () => {
  const store = createAppStore();
  store.set({ upload: { phase: "sending", loaded: 10, total: 100 } });
  const { h, cancel } = handle(true);
  const c = createUploadCanceller(store);
  c.track(h);
  expect(c.cancel()).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(store.get().upload).toBeNull();
  expect(c.cancel()).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(1);
});

test("UI-144 once the import has begun the upload cannot be cancelled and the progress stays", () => {
  const store = createAppStore();
  store.set({ upload: { phase: "importing", loaded: 100, total: 100 } });
  const { h, cancel } = handle(false);
  const c = createUploadCanceller(store);
  c.track(h);
  expect(c.cancel()).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(store.get().upload).not.toBeNull();
  expect(createUploadCanceller(store).cancel()).toBe(false);
});

test("UI-144 the cancel button is offered only while bytes are being sent", () => {
  expect(createUploadCanceller(createAppStore()).visible(null)).toBe(false);
  const c = createUploadCanceller(createAppStore());
  expect(c.visible({ phase: "sending", loaded: 0, total: null })).toBe(true);
  expect(c.visible({ phase: "importing", loaded: 1, total: 1 })).toBe(false);
});
