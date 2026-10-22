import type { LayerReply } from "../api/layers";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import type { Scope, StepBox, Vec3 } from "../state/types";
import type { EditShapeResult } from "./editshape";
import { HIDDEN_LAYER_NAME, SHOW_FIRST, deletePointsText, findLayer, hiddenLayer, layerBoxShape, layerButtons, layerRows, layersOf, mergeConfirmText, stealConfirmText, toMainProtectedText } from "../layers/model";
import { discardCount, layerDiscardText } from "../timeline/model";
import { makeGuard } from "./edit";
import type { ParamsKind } from "./runner";
import { disarmed } from "./toolstate";
import type { SelectionRequest } from "./selection";

export interface LayersApi {
  createLayer(rev: number, o?: { name?: string; visible?: boolean; dry_run?: boolean }): Promise<LayerReply>;
  assignLayer(rev: number, id: number, o?: { visible?: boolean; dry_run?: boolean }): Promise<LayerReply>;
  deleteLayer(rev: number, id: number): Promise<LayerReply>;
  setMembers(rev: number, id: number, o?: { dry_run?: boolean }): Promise<LayerReply>;
  patchLayer(id: number, o: { name?: string; colour?: number; visible?: boolean; protected?: boolean; locked?: boolean }): Promise<LayerReply>;
  mergeLayer(rev: number, id: number, o: { into: number; dry_run?: boolean }): Promise<LayerReply>;
  setOrder(ids: number[]): Promise<LayerReply>;
  layerFromProtection(rev: number, o?: { name?: string; dry_run?: boolean }): Promise<LayerReply>;
  setVisibility(ids: number[] | null, visible: boolean): Promise<LayerReply>;
  refreshState(): Promise<unknown>;
}

export interface LayersDeps {
  /** Sends a protection edit still waiting in its debounce and waits for the server (the band the server uses must be the one on screen); false when it could not be set (the error is already a notice). */
  flushProtection?(): Promise<boolean>;
  /** Re-runs the live tool and redraws, as for a filter change. */
  paramsHook(kind: ParamsKind): void;
  confirm(message: string): boolean;
  /** Sends the one-shot selection of one layer's members; a promise answers true when it landed (the tool then disarms, R22-1). */
  selectLayer(id: number): void | Promise<boolean>;
  /** Adds one layer's members (scope Active) to the selection; true when it landed, false when something superseded it or it failed. */
  selectLayerAdd(id: number): Promise<boolean>;
  /** One-shot selection of a layer's members with the given operation (scope Active); true when it landed. */
  selectLayerOp(id: number, op: LayerSelectOp): Promise<boolean>;
  /** Applies the evaluated candidate (the Delete path). */
  apply(): Promise<void>;
  /** Forgets the drafted preview (client and server); the committed selection stays. */
  discardDraft(): void;
  /** Arms the Box seeded from a shape as a live first selection (clearing the selection first). */
  openShape(shape: StepBox, centre: Vec3 | null): Promise<EditShapeResult>;
}

/** The one-shot selection of a layer's members (replace). */
export const layerSelectBody = (rev: number, id: number, scope: Scope): SelectionRequest => ({
  cloud_revision: rev,
  op: "replace",
  scope,
  tool: { type: "layer", layer_id: id },
  evaluate_candidate: true,
});

export type LayerSelectOp = "replace" | "add" | "subtract" | "intersect";

/** A one-shot selection of a layer's members with any operation, regardless of the display filter. */
export const layerOpBody = (rev: number, id: number, op: LayerSelectOp): SelectionRequest => ({ ...layerSelectBody(rev, id, "active"), op });

/** Adds a layer's members to the selection regardless of the display filter (R17-8). */
export const layerAddBody = (rev: number, id: number): SelectionRequest => layerOpBody(rev, id, "add");

/**
 * Layer calls. A reply carries the new history (membership edits and layer add/remove are timeline steps), so it replaces
 * the session and goes through the params hook; it does NOT go through the editor's afterChange, which would reset the
 * draft and the preview. Step-making calls ask `stepGate` first.
 */
export function createLayers(store: Store<AppState>, api: LayersApi, deps: LayersDeps) {
  const guarded = makeGuard(store, () => api.refreshState());
  const rev = () => store.get().session?.revision.cloud ?? 0;
  const refuse = (why: string | null): boolean => {
    if (why) addNotice(store, "info", "layer_disabled", why);
    return why !== null;
  };

  /** R22-1: a call that consumed the selection leaves no tool armed. Runs before `adopt`, so the params hook sees tool none. */
  const disarm = (): void => store.update(disarmed);

  function adopt(reply: LayerReply): void {
    store.set({ session: reply.session });
    deps.paramsHook("layers");
  }

  /** Dry run first; a move out of other layers asks once. Returns false when the user said no. */
  async function confirmed(dry: Promise<LayerReply>, name: string): Promise<boolean> {
    const text = stealConfirmText((await dry).op, name);
    return text === null || deps.confirm(text);
  }

  /** A layer edit that makes a step throws the rolled-back steps away: ask once, before anything is sent. */
  const stepGate = (): boolean => {
    const n = discardCount(store.get().session);
    return n === 0 || deps.confirm(layerDiscardText(n));
  };

  const patch = (id: number, o: Parameters<LayersApi["patchLayer"]>[1]): Promise<void> =>
    guarded(async () => {
      adopt(await api.patchLayer(id, o));
    });

  return {
    /** Hide selected: one atomic call that fills (or makes) the layer named exactly "Hidden" and hides it. */
    hideSelected: (): Promise<void> => {
      if (!stepGate()) return Promise.resolve();
      return guarded(async () => {
        const existing = hiddenLayer(store.get().session);
        const reply = existing
          ? await api.assignLayer(rev(), existing.id, { visible: false })
          : await api.createLayer(rev(), { name: HIDDEN_LAYER_NAME, visible: false });
        disarm();
        adopt(reply);
      });
    },
    /**
     * Show hidden: every hidden layer is visible again and the members of the layer named Hidden (the one Hide selected
     * fills) join the selection, so Delete works on them at once. A user layer hidden by its eye comes back visible, not
     * selected. Showing consumes nothing, so the tool stays as it is; `liveFirst` goes false so neither the params hook nor the next tool edit replaces the union.
     */
    showHidden: (): Promise<void> =>
      guarded(async () => {
        const h = hiddenLayer(store.get().session);
        const reselect = h && !h.visible && h.count > 0 ? h.id : null;
        if (store.get().draft) deps.discardDraft();
        store.set({ liveFirst: false });
        adopt(await api.setVisibility(null, true));
        if (reselect !== null) await deps.selectLayerAdd(reselect);
      }),
    /** New layer from the selection; a blank name lets the server name it. */
    create: (rawName: string): Promise<void> => {
      if (refuse(layerButtons(store.get()).create)) return Promise.resolve();
      const name = rawName.trim();
      const o = name ? { name } : {};
      if (!stepGate()) return Promise.resolve();
      return guarded(async () => {
        if (!(await confirmed(api.createLayer(rev(), { ...o, dry_run: true }), name || "the new layer"))) return;
        const before = new Set(layersOf(store.get().session).map((l) => l.id));
        const reply = await api.createLayer(rev(), o);
        disarm();
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
      if (!stepGate()) return Promise.resolve();
      return guarded(async () => {
        if (!(await confirmed(api.assignLayer(rev(), target.id, { dry_run: true }), target.name))) return;
        const reply = await api.assignLayer(rev(), target.id);
        disarm();
        adopt(reply);
      });
    },
    /** Selected points back to main (layer 0). */
    release: (): Promise<void> => {
      if (refuse(layerButtons(store.get()).release)) return Promise.resolve();
      if (!stepGate()) return Promise.resolve();
      return guarded(async () => {
        const reply = await api.assignLayer(rev(), 0);
        disarm();
        adopt(reply);
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
    toMain: (id: number): Promise<void> => {
      const l = findLayer(store.get().session, id);
      if (!stepGate()) return Promise.resolve();
      if (l?.protected && !deps.confirm(toMainProtectedText(l))) return Promise.resolve();
      return guarded(async () => {
        adopt(await api.deleteLayer(rev(), id));
        store.update((s) => (s.layerUi.active === id ? { ...s, layerUi: { ...s.layerUi, active: null } } : s));
      });
    },
    select(id: number): void {
      const l = findLayer(store.get().session, id);
      if (!l) return;
      if (!l.visible) {
        addNotice(store, "info", "layer_disabled", SHOW_FIRST);
        return;
      }
      const landing = deps.selectLayer(id);
      if (landing) void landing.then((ok) => (ok ? disarm() : undefined));
    },
    /** Edit layer: clear the selection, seed a Box at the member bounds and start a live selection; the box then picks the new members. */
    async editLayer(id: number): Promise<void> {
      const l = findLayer(store.get().session, id);
      const row = layerRows(store.get().session).find((r) => r.id === id);
      if (!l || !row) return;
      if (refuse(row.editDisabled) || !l.bounds) return;
      const b = l.bounds;
      const centre = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2) as Vec3;
      const r = await deps.openShape(layerBoxShape(b), centre);
      if (r.ok) store.update((s) => ({ ...s, layerUi: { editing: id, active: id } }));
    },
    /** Set layer to selection: the layer's members become exactly the selection. Leaves edit mode and keeps the selection. */
    setMembers: (): Promise<void> => {
      const st = store.get();
      const id = st.layerUi.editing;
      const l = id === null ? null : findLayer(st.session, id);
      if (!l || refuse(layerButtons(st).set)) return Promise.resolve();
      if (!stepGate()) return Promise.resolve();
      return guarded(async () => {
        if (!(await confirmed(api.setMembers(rev(), l.id, { dry_run: true }), l.name))) return;
        const reply = await api.setMembers(rev(), l.id);
        disarm();
        adopt(reply);
        store.update((s) => ({ ...s, layerUi: { ...s.layerUi, editing: null } }));
      });
    },
    /** Esc, Clear selection or a stale layer: edit mode ends with no change to the layer. */
    leaveEdit: (): void => store.update((s) => (s.layerUi.editing === null ? s : { ...s, layerUi: { ...s.layerUi, editing: null } })),
    /** New layer from protected points: the points inside the global height band become a protected layer. */
    fromBand: (): Promise<void> => {
      if (refuse(layerButtons(store.get()).fromBand)) return Promise.resolve();
      if (!stepGate()) return Promise.resolve();
      return guarded(async () => {
        if (deps.flushProtection && !(await deps.flushProtection())) return;
        if (!(await confirmed(api.layerFromProtection(rev(), { dry_run: true }), "Floor"))) return;
        const before = new Set(layersOf(store.get().session).map((l) => l.id));
        const reply = await api.layerFromProtection(rev());
        disarm();
        adopt(reply);
        const fresh = reply.session.layers.find((l) => !before.has(l.id));
        if (fresh) store.update((s) => ({ ...s, layerUi: { ...s.layerUi, active: fresh.id } }));
      });
    },
    /** Layer `from` joins layer `into` (confirmed first) and goes away. */
    merge: (from: number, into: number): Promise<void> => {
      const a = findLayer(store.get().session, from);
      const b = findLayer(store.get().session, into);
      const row = layerRows(store.get().session).find((r) => r.id === from);
      if (!a || !b || refuse(row?.mergeDisabled ?? null)) return Promise.resolve();
      if (!stepGate()) return Promise.resolve();
      if (!deps.confirm(mergeConfirmText(a, b))) return Promise.resolve();
      return guarded(async () => {
        const reply = await api.mergeLayer(rev(), from, { into });
        disarm();
        adopt(reply);
        store.update((s) => ({ ...s, layerUi: { ...s.layerUi, active: into } }));
      });
    },
    /** Moves a layer one place in the stored order. */
    move: (id: number, dir: -1 | 1): Promise<void> => {
      const ids = layersOf(store.get().session).map((l) => l.id);
      const i = ids.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return Promise.resolve();
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return guarded(async () => {
        adopt(await api.setOrder(ids));
      });
    },
    /** Add / Subtract / Intersect (or Select) aimed at one layer: one shot, scope Active, no live preview. */
    async layerOp(id: number, op: LayerSelectOp): Promise<void> {
      const st = store.get();
      const l = findLayer(st.session, id);
      if (!l) return;
      const why = st.draft || st.preview
        ? "Commit or discard the draft first"
        : !l.visible
          ? SHOW_FIRST
          : l.count === 0
            ? "The layer has no points"
            : (op === "subtract" || op === "intersect") && (st.session?.selection.count ?? 0) === 0
              ? "Select some points first"
              : null;
      if (refuse(why)) return;
      store.update((s) => ({ ...s, layerUi: { ...s.layerUi, active: id } }));
      if (await deps.selectLayerOp(id, op)) disarm();
    },
    /** Delete the layer's points as a normal timeline step (confirmed; a protected layer is refused). */
    async deletePoints(id: number): Promise<void> {
      const st = store.get();
      const l = findLayer(st.session, id);
      const row = layerRows(st.session).find((r) => r.id === id);
      if (!l || !row) return;
      const why = row.deletePointsDisabled ?? (st.draft || st.preview ? "Commit or discard the draft first" : null);
      if (refuse(why)) return;
      if (!deps.confirm(deletePointsText(l))) return;
      if (await deps.selectLayerOp(id, "replace")) await deps.apply();
    },
    rename: (id: number, raw: string): Promise<void> => {
      const name = raw.trim();
      if (!name) {
        addNotice(store, "info", "layer_disabled", "A layer needs a name");
        return Promise.resolve();
      }
      return patch(id, { name });
    },
    setColour: (id: number, colour: number): Promise<void> => patch(id, { colour }),
    setFlag: (id: number, flag: "protected" | "locked", value: boolean): Promise<void> => patch(id, { [flag]: value }),
    setVisible: (id: number, visible: boolean): Promise<void> => patch(id, { visible }),
    setActive: (id: number | null): void => store.update((s) => ({ ...s, layerUi: { ...s.layerUi, active: id } })),
  };
}
