import { ApiError } from "../files/errors";
import { failure, getJson, postJson, sessionHeaders } from "../files/http";
import type { DisplayFilter, Protection, Scope, SelectionOp, SessionState } from "../state/types";

type Json = Record<string, unknown>;

async function putJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...sessionHeaders() },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiError(0, "network", `could not reach the app: ${String(cause)}`);
  }
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

export function normaliseState(raw: unknown): SessionState {
  const r = raw as Json;
  return {
    ...(r as unknown as SessionState),
    bounds: (r.bounds as SessionState["bounds"]) ?? null,
    active_bounds: (r.active_bounds as SessionState["active_bounds"]) ?? null,
    client_state: (r.client_state as Record<string, unknown>) ?? {},
  };
}

export async function getState(): Promise<SessionState | null> {
  try {
    const body = await getJson("/api/session");
    if ((body as { no_session?: unknown }).no_session === true) return null;
    return normaliseState(body);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function putFilter(f: DisplayFilter): Promise<SessionState> {
  return normaliseState(await putJson("/api/session/display-filter", f));
}
export async function putProtection(p: Protection): Promise<SessionState> {
  return normaliseState(await putJson("/api/session/protection", p));
}
export async function putClientState(s: Json): Promise<unknown> {
  return putJson("/api/session/client-state", s);
}

export interface SelectionBody {
  cloud_revision: number;
  op: SelectionOp;
  scope: Scope;
  tool: Json | null;
  evaluate_candidate: boolean;
}
export const submitSelection = (b: SelectionBody) =>
  postJson<{ id: string }>("/api/session/selection", b);
export interface PreviewBody {
  cloud_revision: number;
  op: SelectionOp;
  scope: Scope;
  tool: Json | null;
}
export const submitPreview = (b: PreviewBody) => postJson<{ id: string }>("/api/session/selection/preview", b);
export const submitCommit = (b: { cloud_revision: number; preview_id: string }) =>
  postJson<{ id: string }>("/api/session/selection/commit", b);
export const discardPreview = (cloud_revision: number) =>
  postJson("/api/session/selection/preview/discard", { cloud_revision });
export const submitCandidate = (cloud_revision: number) =>
  postJson<{ id: string }>("/api/session/candidate", { cloud_revision });

const revCall = async (path: string, cloud_revision: number) =>
  normaliseState(await postJson(`/api/session/${path}`, { cloud_revision }));
export const clearSelection = (rev: number) => revCall("selection/clear", rev);
export const undo = (rev: number) => revCall("undo", rev);
export const redo = (rev: number) => revCall("redo", rev);
export const rollback = async (cloud_revision: number, cursor: number) =>
  normaliseState(await postJson("/api/session/history/rollback", { cloud_revision, cursor }));
export const deleteStep = async (cloud_revision: number, sid: number) =>
  normaliseState(await postJson("/api/session/history/delete-step", { cloud_revision, sid }));
/** An empty name clears the step's name. Does not change the cloud revision. */
export const renameStep = async (sid: number, name: string) =>
  normaliseState(await postJson("/api/session/history/rename", { sid, name }));
export const removeInvalid = (rev: number) => revCall("remove-invalid", rev);
export async function apply(cloud_revision: number, candidate_id: string, description: string) {
  return normaliseState(
    await postJson("/api/session/apply", { cloud_revision, candidate_id, description }),
  );
}

export interface NearestResult {
  id: number | null;
  distance?: number;
  point?: [number, number, number];
}
export const nearest = (point: number[], radius: number) =>
  postJson<NearestResult>("/api/session/nearest", { point, radius });
