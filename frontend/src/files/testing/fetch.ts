import { vi } from "vitest";

export type Reply = { status?: number; body?: unknown };

/** Stubs global fetch; `route` maps (method, url, body) to a reply. */
export function stubFetch(route: (method: string, url: string, body: unknown) => Reply | Error) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = init?.method ?? "GET";
    calls.push({ method, url, body });
    const r = route(method, url, body);
    if (r instanceof Error) throw r;
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return new Response(text, { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}
