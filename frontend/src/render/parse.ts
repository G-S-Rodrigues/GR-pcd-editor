import { ApiError } from "../files/errors";
import { failure, sessionHeaders } from "../files/http";
import type { RenderMode, Vec3 } from "../state/types";

export type AttrArray = Float32Array | Uint32Array | Int32Array;

export interface RenderData {
  coords: Float32Array; // origin-relative
  ids: Uint32Array;
  flags: Uint8Array; // 1 selected, 2 protected, 4 deleted
  attr?: AttrArray;
  attrField?: string;
  attrKind?: "f32" | "u32" | "i32";
  origin: Vec3;
  count: number;
  eligible: number;
  cloudRevision: number;
  paramsRevision: number;
  sessionId?: string;
}

export interface HeaderLike {
  get(name: string): string | null;
}

const bad = (msg: string) => new ApiError(0, "bad_render", msg);

export function parseRender(buf: ArrayBuffer, headers: HeaderLike): RenderData {
  const num = (k: string) => {
    const v = Number(headers.get(k));
    if (!Number.isFinite(v)) throw bad(`missing render header ${k}`);
    return v;
  };
  const count = num("X-Count");
  const origin = (headers.get("X-Origin") ?? "").split(",").map(Number);
  if (origin.length !== 3 || origin.some((v) => !Number.isFinite(v))) throw bad("bad X-Origin");
  const attrKind = (headers.get("X-Attr-Kind") ?? undefined) as RenderData["attrKind"];
  const expected = count * 17 + (attrKind ? count * 4 : 0);
  if (buf.byteLength !== expected) {
    throw bad(`render body is ${buf.byteLength} bytes, expected ${expected}`);
  }
  const out: RenderData = {
    coords: new Float32Array(buf, 0, count * 3),
    ids: new Uint32Array(buf, count * 12, count),
    flags: new Uint8Array(buf, count * 16, count),
    origin: origin as Vec3,
    count,
    eligible: num("X-Eligible"),
    cloudRevision: num("X-Cloud-Revision"),
    paramsRevision: num("X-Params-Revision"),
  };
  const sid = headers.get("X-Session-Id");
  if (sid) out.sessionId = sid;
  if (attrKind) {
    const block = buf.slice(count * 17, count * 21); // not 4-byte aligned in place
    out.attrKind = attrKind;
    out.attrField = headers.get("X-Attr-Field") ?? undefined;
    out.attr =
      attrKind === "u32" ? new Uint32Array(block) : attrKind === "i32" ? new Int32Array(block) : new Float32Array(block);
  }
  return out;
}

export const MAX_BUDGET = 2_000_000;

export function renderQuery(mode: RenderMode | "step", budget: number, attr?: string, step?: number): string {
  const b = Math.min(MAX_BUDGET, Math.max(1, Math.floor(budget)));
  const st = mode === "step" && step !== undefined ? `&step=${Math.floor(step)}` : "";
  return `mode=${mode}${st}&budget=${b}${attr ? `&attr=${encodeURIComponent(attr)}` : ""}`;
}

export async function fetchRender(
  mode: RenderMode | "step",
  budget: number,
  attr?: string,
  signal?: AbortSignal,
  step?: number,
): Promise<RenderData> {
  let res: Response;
  try {
    res = await fetch(`/api/session/render?${renderQuery(mode, budget, attr, step)}`, { signal, headers: sessionHeaders() });
  } catch (cause) {
    if (signal?.aborted) throw new ApiError(0, "cancelled", "render request superseded");
    throw new ApiError(0, "network", `could not reach the app: ${String(cause)}`);
  }
  if (!res.ok) {
    throw await failure(res);
  }
  return parseRender(await res.arrayBuffer(), res.headers);
}
