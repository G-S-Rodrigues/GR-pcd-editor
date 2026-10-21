import { notifySessionChanged } from "../files/http";
import { colourOptions } from "../colour/modes";
import { ApiError } from "../files/errors";
import { fetchPlan, renderCacheKey } from "../compare/model";
import { fetchRender as realFetchRender, type RenderData } from "../render/parse";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import type { RenderMode } from "../state/types";

class StaleSession extends Error {}

type FetchRender = typeof realFetchRender;
const CACHE_MAX = 3;

/** Fetches the current render(s) for the store's comparison mode, budget and colour attribute; latest request wins. */
export function createRefresher(store: Store<AppState>, fetchRender: FetchRender = realFetchRender) {
  let gen = 0;
  let ctl: AbortController | null = null;
  // Only read-only renders are cached: the edited render carries selection flags that change without a revision bump.
  const cache = new Map<string, RenderData>();
  return {
    /** Drops every cached render (a different file or session was opened). */
    clear(): void {
      cache.clear();
    },
    async refresh(): Promise<boolean> {
      const mine = ++gen;
      ctl?.abort();
      ctl = new AbortController();
      const signal = ctl.signal;
      const s = store.get();
      const attr = colourOptions(s.session?.schema ?? []).find((o) => o.id === s.colour.mode)?.attr;
      // `renderMode` is the primary render; the comparison mode adds the secondary one.
      const secondary = fetchPlan(s.compare).secondary;
      const get = async (mode: RenderMode): Promise<RenderData> => {
        const key = renderCacheKey(s, mode, attr);
        const hit = mode !== "edited" ? cache.get(key) : undefined;
        if (hit) return hit;
        // the pending preview is drawn only into the edited primary render
        const pid = mode === "edited" && s.renderMode === "edited" ? s.preview?.id : undefined;
        let data = pid
          ? await fetchRender(mode, s.budget, attr, signal, undefined, pid)
          : await fetchRender(mode, s.budget, attr, signal);
        if (pid && data.previewId !== pid && mine === gen) {
          // the server no longer has that preview: forget it and draw the plain selection once
          store.set({ preview: null });
          data = await fetchRender(mode, s.budget, attr, signal);
        }
        // a render made for another session must never be shown or cached
        if (data.sessionId && s.session && data.sessionId !== s.session.session_id) {
          notifySessionChanged();
          throw new StaleSession();
        }
        if (mode !== "edited") {
          cache.delete(key);
          cache.set(key, data);
          while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
        }
        return data;
      };
      store.set({ rendering: true });
      try {
        const [data, data2] = await Promise.all([get(s.renderMode), secondary ? get(secondary) : null]);
        if (mine !== gen) return false;
        // hidden layers are left out by the server, so the render is used as it came
        store.set({ render: data, render2: data2, rendering: false });
        return true;
      } catch (e) {
        if (mine !== gen) return false;
        store.set({ rendering: false });
        if (e instanceof StaleSession || (e instanceof ApiError && e.code === "session_changed")) return false;
        addNotice(store, "error", "render_failed", e instanceof Error ? e.message : "Could not load the point cloud");
        return false;
      }
    },
  };
}
