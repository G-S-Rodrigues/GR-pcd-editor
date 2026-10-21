import { sendJson } from "../files/http";
import type { LayerOp, SessionState } from "../state/types";
import { normaliseState } from "./session";

const BASE = "/api/session/layers";

export interface LayerReply {
  session: SessionState;
  /** Present on create, assign and set-members. */
  op: LayerOp | null;
}

async function call(method: string, url: string, body: unknown): Promise<LayerReply> {
  const raw = (await sendJson<Record<string, unknown>>(method, url, body)) as { layer_op?: LayerOp };
  return { session: normaliseState(raw), op: raw.layer_op ?? null };
}

/** Moves the selectable selected points into a new layer (`dry_run` counts only). */
export const createLayer = (rev: number, o: { name?: string; visible?: boolean; dry_run?: boolean } = {}) =>
  call("POST", BASE, { cloud_revision: rev, ...o });
/** Id 0 releases the selected points to main. */
export const assignLayer = (rev: number, id: number, o: { visible?: boolean; dry_run?: boolean } = {}) =>
  call("POST", `${BASE}/${id}/assign`, { cloud_revision: rev, ...o });
/** The layer's members become exactly the current selection. */
export const setMembers = (rev: number, id: number, o: { dry_run?: boolean } = {}) =>
  call("POST", `${BASE}/${id}/set-members`, { cloud_revision: rev, ...o });
export const patchLayer = (id: number, o: { name?: string; colour?: number; visible?: boolean; protected?: boolean; locked?: boolean }) =>
  call("PATCH", `${BASE}/${id}`, o);
export const deleteLayer = (rev: number, id: number) => call("DELETE", `${BASE}/${id}`, { cloud_revision: rev });
/** `ids: null` means every layer (the Show-all call of the legend chip). */
export const setVisibility = (ids: number[] | null, visible: boolean) =>
  call("PUT", `${BASE}/visibility`, { ids, visible });
/** The stored layer order: every id once. */
export const setOrder = (ids: number[]) => call("PUT", `${BASE}/order`, { ids });
/** Layer `id` joins `into` and goes away (`dry_run` counts only). */
export const mergeLayer = (rev: number, id: number, o: { into: number; dry_run?: boolean }) =>
  call("POST", `${BASE}/${id}/merge`, { cloud_revision: rev, ...o });
/** A protected layer of the points inside the height band (default name Floor). */
export const layerFromProtection = (rev: number, o: { name?: string; dry_run?: boolean } = {}) =>
  call("POST", `${BASE}/from-protection`, { cloud_revision: rev, ...o });
