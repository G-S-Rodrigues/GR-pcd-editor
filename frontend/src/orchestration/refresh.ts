import { colourOptions } from "../colour/modes";
import { fetchRender as realFetchRender } from "../render/parse";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";

type FetchRender = typeof realFetchRender;

/** Fetches the current render for the store's mode, budget and colour attribute; latest request wins. */
export function createRefresher(store: Store<AppState>, fetchRender: FetchRender = realFetchRender) {
  let gen = 0;
  let ctl: AbortController | null = null;
  return {
    async refresh(): Promise<boolean> {
      const mine = ++gen;
      ctl?.abort();
      ctl = new AbortController();
      const s = store.get();
      const attr = colourOptions(s.session?.schema ?? []).find((o) => o.id === s.colour.mode)?.attr;
      store.set({ rendering: true });
      try {
        const data = await fetchRender(s.renderMode, s.budget, attr, ctl.signal);
        if (mine !== gen) return false;
        store.set({ render: data, rendering: false });
        return true;
      } catch (e) {
        if (mine !== gen) return false;
        store.set({ rendering: false });
        addNotice(store, "error", "render_failed", e instanceof Error ? e.message : "Could not load the point cloud");
        return false;
      }
    },
  };
}
