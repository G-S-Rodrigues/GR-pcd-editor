import { ApiError, networkError, parseError } from "./errors";

let sessionId: string | null = null;
let changedHandler: (() => void) | null = null;

/** The id of the session this tab works on; sent as X-Session-Id so a replaced session answers 409. */
export const setSessionId = (id: string | null): void => {
  sessionId = id;
};
export const sessionHeaders = (): Record<string, string> => (sessionId ? { "X-Session-Id": sessionId } : {});
export const setSessionChangedHandler = (fn: (() => void) | null): void => {
  changedHandler = fn;
};
/** Called for a 409 session_changed reply and for a render answered by another session. */
export const notifySessionChanged = (): void => changedHandler?.();

/** The error for a failed reply; a session_changed reply also notifies the handler. */
export async function failure(res: Response): Promise<ApiError> {
  const err = await parseError(res);
  if (err.code === "session_changed") notifySessionChanged();
  return err;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  const headers: Record<string, string> = { ...sessionHeaders() };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (Object.keys(headers).length > 0) init.headers = headers;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (cause) {
    throw networkError(cause);
  }
  if (!res.ok) throw await failure(res);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, "bad_response", "the app returned an unreadable reply");
  }
}

/** A request with any method and a JSON body (PUT, PATCH, DELETE), through the same session header and error mapping. */
export const sendJson = <T>(method: string, url: string, body?: unknown) => request<T>(method, url, body);
export const getJson = <T>(url: string) => request<T>("GET", url);
export const postJson = <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {});
export const deleteJson = <T>(url: string) => request<T>("DELETE", url);
