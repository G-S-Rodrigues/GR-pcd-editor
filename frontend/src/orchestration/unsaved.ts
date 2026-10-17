import type { AppState } from "../state/app";

export const shouldWarn = (s: Pick<AppState, "session">): boolean => s.session?.unsaved === true;
export const unsavedLabel = (s: Pick<AppState, "session">): string =>
  shouldWarn(s) ? "Unsaved edits" : "No unsaved edits";

interface UnloadEventLike {
  preventDefault(): void;
  returnValue: unknown;
}
/** Handler for `beforeunload`: only intervenes while there are unsaved edits. */
export function beforeUnloadHandler(get: () => Pick<AppState, "session">) {
  return (e: UnloadEventLike): void => {
    if (!shouldWarn(get())) return;
    e.preventDefault();
    e.returnValue = "";
  };
}
