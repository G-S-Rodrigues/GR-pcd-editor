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
  const send = async () => {
    const body = toProtectionBody(store.get().tools.protection);
    if (!body.ok) return;
    const mine = ++gen;
    try {
      const state = await deps.putProtection(body.body);
      if (mine !== gen) return;
      store.set({ session: state });
      deps.onParamsChanged();
    } catch (e) {
      deps.onError?.(e);
    }
  };
  return {
    edit(fn: (m: ProtectionModel) => ProtectionEdit): ProtectionEdit {
      const r = fn(store.get().tools.protection);
      if (!r.ok) return r;
      store.update((s) => ({ ...s, candidate: null, tools: { ...s.tools, protection: r.model } }));
      debounce.call(() => void send());
      return r;
    },
  };
}
