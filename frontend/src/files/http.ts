import { ApiError, networkError, parseError } from "./errors";

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (cause) {
    throw networkError(cause);
  }
  if (!res.ok) throw await parseError(res);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, "bad_response", "the app returned an unreadable reply");
  }
}

export const getJson = <T>(url: string) => request<T>("GET", url);
export const postJson = <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {});
export const deleteJson = <T>(url: string) => request<T>("DELETE", url);
