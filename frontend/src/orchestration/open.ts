import { getState } from "../api/session";
import { ApiError, openErrorText } from "../files/errors";
import { type DataTransferLike, type DropErrorCode, pickDroppedFile } from "../files/dragdrop";
import { openMounted as realOpenMounted } from "../files/mounted";
import { type UploadHandle, type UploadOptions, uploadFile } from "../files/upload";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import type { SessionState } from "../state/types";

export type OpenSource =
  | { kind: "picker"; file: File }
  | { kind: "drop"; dt: DataTransferLike }
  | { kind: "mounted"; path: string; itemKind: "pcd" | "session" };

export interface OpenDeps {
  store: Store<AppState>;
  confirm: (message: string) => Promise<boolean> | boolean;
  refresh: () => Promise<unknown>;
  clearCache?: () => void;
  upload?: (file: File, opts: UploadOptions) => UploadHandle<unknown>;
  openMounted?: (path: string, kind: "pcd" | "session", replace: boolean) => Promise<unknown>;
  onOpened?: (state: SessionState) => void;
}

export type OpenOutcome =
  | { ok: true }
  | { ok: false; reason: "declined" }
  | { ok: false; reason: "drop"; code: DropErrorCode }
  | { ok: false; reason: "error"; code: string };

const DROP_TEXT: Record<DropErrorCode, string> = {
  no_files: "Nothing was dropped",
  multiple_files: "Drop one file at a time",
  directory_not_supported: "Folders cannot be dropped; drop a .pcd or .pcdsession file",
  unsupported_type: "Only .pcd and .pcdsession files can be opened",
};
export const dropNotice = (store: Store<AppState>, code: DropErrorCode) =>
  addNotice(store, "warn", code, DROP_TEXT[code]);

export async function openSource(src: OpenSource, deps: OpenDeps): Promise<OpenOutcome> {
  const { store } = deps;
  let file: File | undefined;
  if (src.kind === "picker") file = src.file;
  if (src.kind === "drop") {
    const d = pickDroppedFile(src.dt);
    if ("error" in d) {
      dropNotice(store, d.error);
      return { ok: false, reason: "drop", code: d.error };
    }
    file = d.file;
  }

  const existing = store.get().session;
  let replace = false;
  if (existing?.unsaved) {
    const yes = await deps.confirm(
      `${existing.filename} has unsaved edits. Opening another file discards them. Continue?`,
    );
    if (!yes) return { ok: false, reason: "declined" };
    replace = true;
  }

  try {
    if (file) {
      const up = deps.upload ?? ((f, o) => uploadFile(f, o));
      const set = (p: Partial<NonNullable<AppState["upload"]>>) =>
        store.update((s) => ({
          ...s,
          upload: { phase: "sending", loaded: 0, total: null, ...s.upload, ...p },
        }));
      await up(file, {
        replace,
        onPhase: (phase) => set({ phase }),
        onProgress: (p) => set({ loaded: p.loaded, total: p.total }),
      }).promise;
    } else if (src.kind === "mounted") {
      await (deps.openMounted ?? realOpenMounted)(src.path, src.itemKind, replace);
    }
    const state = await getState();
    if (!state) throw new ApiError(0, "no_session", "the file opened but no session was found");
    deps.clearCache?.();
    store.batch(() => {
      store.set({ session: state, candidate: null, upload: null, render: null });
    });
    deps.onOpened?.(state);
    await deps.refresh();
    return { ok: true };
  } catch (e) {
    store.set({ upload: null });
    const code = e instanceof ApiError ? e.code : "open_failed";
    if (code !== "cancelled") {
      const name = file?.name ?? (src.kind === "mounted" ? (src.path.split("/").pop() ?? src.path) : "the file");
      addNotice(store, "error", "open_failed", openErrorText(name, e instanceof Error ? e.message : "unknown error"));
    }
    return { ok: false, reason: "error", code };
  }
}
