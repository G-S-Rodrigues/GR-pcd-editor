import type { LayerReply } from "../api/layers";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import type { Scope } from "../state/types";
import { HIDDEN_LAYER_NAME, SHOW_FIRST, findLayer, hiddenLayer, layerButtons, layersOf, stealConfirmText } from "../layers/model";
import { makeGuard } from "./edit";
import type { ParamsKind } from "./runner";
import type { SelectionRequest } from "./selection";

export interface LayersApi {
  createLayer(rev: number, o?: { name?: string; visible?: boolean; dry_run?: boolean }): Promise<LayerReply>;
  assignLayer(rev: number, id: number, o?: { visible?: boolean; dry_run?: boolean }): Promise<LayerReply>;
  deleteLayer(rev: number, id: number): Promise<LayerReply>;
  patchLayer(id: number, o: { name?: string; colour?: number; visible?: boolean }): Promise<LayerReply>;
  setVisibility(ids: number[] | null, visible: boolean): Promise<LayerReply>;
  refreshState(): Promise<unknown>;
}

export interface LayersDeps {
  /** Re-runs the live tool and redraws, as for a filter change. */
  paramsHook(kind: ParamsKind): void;
  confirm(message: string): boolean;
  /** Sends the one-shot selection of one layer's members. */
  selectLayer(id: number): void;
}

/** The one-shot selection of a layer's members (replace). */
export const layerSelectBody = (rev: number, id: number, scope: Scope): SelectionRequest => ({
  cloud_revision: rev,
  op: "replace",
  scope,
  tool: { type: "layer", layer_id: id },
  evaluate_candidate: true,
});

/**
 * Layer calls. A layer edit is not a timeline step, so the reply replaces the session and goes through the params hook;
 * it does NOT go through the editor's afterChange, which would reset the draft and the preview.
 */
export function createLayers(store: Store<AppState>, api: LayersApi, deps: LayersDeps) {
  const guarded = makeGuard(store, () => api.refreshState());
  const rev = () => store.get().session?.revision.cloud ?? 0;
  const refuse = (why: string | null): boolean => {
    if (why) addNotice(store, "info", "layer_disabled", why);
    return why !== null;
  };

  function adopt(reply: LayerReply): void {
    store.set({ session: reply.session });
    deps.paramsHook("layers");
  }

  /** Dry run first; a move out of other layers asks once. Returns false when the user said no. */
  async function confirmed(dry: Promise<LayerReply>, name: string): Promise<boolean> {
    const text = stealConfirmText((await dry).op, name);
    return text === null || deps.confirm(text);
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
    /** New layer from the selection; a blank name lets the server name it. */
    create: (rawName: string): Promise<void> => {
      if (refuse(layerButtons(store.get()).create)) return Promise.resolve();
      const name = rawName.trim();
      const o = name ? { name } : {};
      return guarded(async () => {
        if (!(await confirmed(api.createLayer(rev(), { ...o, dry_run: true }), name || "the new layer"))) return;
        const before = new Set(layersOf(store.get().session).map((l) => l.id));
        const reply = await api.createLayer(rev(), o);
        adopt(reply);
        const fresh = reply.session.layers.find((l) => !before.has(l.id));
        if (fresh) store.update((s) => ({ ...s, layerUi: { ...s.layerUi, active: fresh.id } }));
      });
    },
    /** Selected points into the chosen layer. */
    assign: (): Promise<void> => {
      const b = layerButtons(store.get());
      if (refuse(b.assign) || !b.active) return Promise.resolve();
      const target = b.active;
      return guarded(async () => {
        if (!(await confirmed(api.assignLayer(rev(), target.id, { dry_run: true }), target.name))) return;
        adopt(await api.assignLayer(rev(), target.id));
      });
    },
    /** Selected points back to main (layer 0). */
    release: (): Promise<void> => {
      if (refuse(layerButtons(store.get()).release)) return Promise.resolve();
      return guarded(async () => {
        adopt(await api.assignLayer(rev(), 0));
      });
    },
    toggle: (id: number): Promise<void> => {
      const l = findLayer(store.get().session, id);
      if (!l) return Promise.resolve();
      return guarded(async () => {
        adopt(await api.patchLayer(id, { visible: !l.visible }));
      });
    },
    /** Every member goes back to main and the layer is removed. */
    toMain: (id: number): Promise<void> =>
      guarded(async () => {
        adopt(await api.deleteLayer(rev(), id));
        store.update((s) => (s.layerUi.active === id ? { ...s, layerUi: { ...s.layerUi, active: null } } : s));
      }),
    select(id: number): void {
      const l = findLayer(store.get().session, id);
      if (!l) return;
      if (!l.visible) {
        addNotice(store, "info", "layer_disabled", SHOW_FIRST);
        return;
      }
      deps.selectLayer(id);
    },
    setActive: (id: number | null): void => store.update((s) => ({ ...s, layerUi: { ...s.layerUi, active: id } })),
  };
}
