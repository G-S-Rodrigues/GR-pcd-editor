import type { UploadHandle } from "../files/upload";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";

/** Remembers the upload in flight so the Cancel button can stop it while bytes are being sent. */
export function createUploadCanceller(store: Store<AppState>) {
  let current: UploadHandle<unknown> | null = null;
  return {
    track(h: UploadHandle<unknown>): void {
      current = h;
    },
    visible: (u: AppState["upload"]): boolean => u !== null && u.phase === "sending",
    /** True when the upload was stopped; false once the import has begun or nothing is uploading. */
    cancel(): boolean {
      const h = current;
      current = null;
      if (!h) return false;
      const stopped = h.cancel();
      if (stopped) store.set({ upload: null });
      return stopped;
    },
  };
}
