import type { LayerReply } from "../api/layers";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { HIDDEN_LAYER_NAME, hiddenLayer } from "../layers/model";
import { makeGuard } from "./edit";
import type { ParamsKind } from "./runner";

export interface LayersApi {
  createLayer(rev: number, o?: { name?: string; visible?: boolean; dry_run?: boolean }): Promise<LayerReply>;
  assignLayer(rev: number, id: number, o?: { visible?: boolean; dry_run?: boolean }): Promise<LayerReply>;
  setVisibility(ids: number[] | null, visible: boolean): Promise<LayerReply>;
  refreshState(): Promise<unknown>;
}

export interface LayersDeps {
  /** Re-runs the live tool and redraws, as for a filter change. */
  paramsHook(kind: ParamsKind): void;
  confirm(message: string): boolean;
}

/**
 * Layer calls. A layer edit is not a timeline step, so the reply replaces the session and goes through the params hook;
 * it does NOT go through the editor's afterChange, which would reset the draft and the preview.
 */
export function createLayers(store: Store<AppState>, api: LayersApi, deps: LayersDeps) {
  const guarded = makeGuard(store, () => api.refreshState());
  const rev = () => store.get().session?.revision.cloud ?? 0;

  function adopt(reply: LayerReply): void {
    store.set({ session: reply.session });
    deps.paramsHook("layers");
  }

  return {
    /** Hide selected: one atomic call that fills (or makes) the layer named exactly "Hidden" and hides it. */
    hideSelected: (): Promise<void> =>
      guarded(async () => {
        const existing = hiddenLayer(store.get().session);
        const reply = existing
          ? await api.assignLayer(rev(), existing.id, { visible: false })
          : await api.createLayer(rev(), { name: HIDDEN_LAYER_NAME, visible: false });
        adopt(reply);
      }),
    /** Show every hidden layer again (the legend chip and the pressed Hide button). */
    showAll: (): Promise<void> =>
      guarded(async () => {
        adopt(await api.setVisibility(null, true));
      }),
  };
}
