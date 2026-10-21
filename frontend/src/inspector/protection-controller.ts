import { createDebouncer } from "../orchestration/timing";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { SessionState } from "../state/types";
import { type ProtectionBody, type ProtectionEdit, type ProtectionModel, toProtectionBody } from "./protection";

export interface ProtectionDeps {
  putProtection: (b: ProtectionBody) => Promise<SessionState>;
  onParamsChanged: () => void;
  onError?: (e: unknown) => void;
}

/** Debounced protection edits. Settings that need an acknowledgement are never sent. */
export function createProtectionController(store: Store<AppState>, deps: ProtectionDeps) {
  const debounce = createDebouncer(150, { maxWaitMs: 250 });
  let gen = 0;
  let inflight: Promise<boolean> | null = null;
  const send = (): Promise<boolean> => {
    const run = sendNow().finally(() => {
      if (inflight === run) inflight = null;
    });
    inflight = run;
    return run;
  };
  /** True when the server holds the band on screen (or a newer send took over); false after an error. */
  const sendNow = async (): Promise<boolean> => {
    const body = toProtectionBody(store.get().tools.protection);
    if (!body.ok) return false;
    const mine = ++gen;
    try {
      const state = await deps.putProtection(body.body);
      if (mine !== gen) return true;
      store.set({ session: state });
      deps.onParamsChanged();
      return true;
    } catch (e) {
      deps.onError?.(e);
      return false;
    }
  };
  return {
    /**
     * Sends an edit still waiting in the debounce now and resolves once the server has answered every edit made so far.
     * Resolves false (with the error reported) when the band on screen is not one the server holds: an invalid setting,
     * a refused or failed PUT.
     */
    async flush(): Promise<boolean> {
      const body = toProtectionBody(store.get().tools.protection);
      if (!body.ok) {
        debounce.cancel();
        deps.onError?.(new Error(body.message));
        return false;
      }
      if (debounce.pending()) {
        debounce.cancel();
        return send();
      }
      return inflight ? inflight : true;
    },
    edit(fn: (m: ProtectionModel) => ProtectionEdit): ProtectionEdit {
      const r = fn(store.get().tools.protection);
      if (!r.ok) return r;
      store.update((s) => ({ ...s, candidate: null, tools: { ...s.tools, protection: r.model } }));
      debounce.call(() => void send());
      return r;
    },
  };
}
