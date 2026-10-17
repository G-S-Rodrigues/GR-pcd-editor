import { notifySessionChanged } from "../files/http";
import { fetchRender, type RenderData } from "../render/parse";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { emptyTimeline, reconcile, stepLayerStyle } from "../timeline/model";

type FetchStep = (sid: number, budget: number, signal: AbortSignal) => Promise<RenderData>;
const CACHE_MAX = 3;

export const realFetchStep: FetchStep = (sid, budget, signal) => fetchRender("step", budget, undefined, signal, sid);

/**
 * Keeps `stepRender` equal to the render of the highlighted (or hovered) step. A click fetches at once, a hover after
 * `hoverMs` and is dropped when the pointer leaves; the last 3 renders are cached by session, step and params revision
 * (a step's ids never change, the display filter does). Also forgets steps that vanish and every step of a replaced session.
 */
export function createStepView(store: Store<AppState>, fetchStep: FetchStep = realFetchStep, opts: { hoverMs?: number } = {}) {
  const hoverMs = opts.hoverMs ?? 120;
  const cache = new Map<string, RenderData>();
  let ctl: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let want = "";
  let lastSession: string | undefined;

  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    ctl?.abort();
    ctl = null;
  };

  async function load(sid: number, key: string): Promise<void> {
    const s = store.get();
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      store.set({ stepRender: hit });
      return;
    }
    ctl?.abort();
    ctl = new AbortController();
    const mine = ctl;
    try {
      const data = await fetchStep(sid, s.budget, mine.signal);
      if (mine.signal.aborted || want !== key) return;
      if (data.sessionId && s.session && data.sessionId !== s.session.session_id) {
        notifySessionChanged();
        return;
      }
      cache.set(key, data);
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
      store.set({ stepRender: data });
    } catch {
      // a superseded or failed preview is only a missing overlay; the strip itself still works
    }
  }

  const sync = (s: AppState): void => {
    // a replaced session: step ids restart, so nothing carries over
    if (s.session?.session_id !== lastSession) {
      lastSession = s.session?.session_id;
      cache.clear();
      if (s.timeline.highlight !== null || s.timeline.hover !== null || s.timeline.renaming !== null) {
        store.set({ timeline: emptyTimeline() });
        return;
      }
    }
    const rec = reconcile(s.timeline, s.session);
    if (rec !== s.timeline) {
      store.set({ timeline: rec });
      return;
    }
    const style = stepLayerStyle(s.timeline);
    if (!style || !s.session) {
      want = "";
      stop();
      if (s.stepRender !== null) store.set({ stepRender: null });
      return;
    }
    const key = `${s.session.session_id}|${style.sid}|${s.session.revision.params}`;
    if (key === want) return;
    want = key;
    stop();
    if (!style.hover || cache.has(key)) {
      void load(style.sid, key);
    } else if (!s.job.busy && !s.rendering) {
      timer = setTimeout(() => {
        timer = null;
        void load(style.sid, key);
      }, hoverMs);
    }
  };

  const unsub = store.subscribe(sync);
  sync(store.get());
  return {
    /** Forgets cached renders (a different file opened). */
    clear: () => cache.clear(),
    dispose() {
      unsub();
      stop();
    },
  };
}
