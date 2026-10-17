import { COMPARE_MODES, type CompareMode, clampOpacity, fetchPlan } from "../compare/model";
import { createDebouncer } from "../orchestration/timing";
import type { Quat } from "../math/quat";
import type { BoxModel } from "../tools/box/model";
import type { ClusterModel } from "../tools/cluster/model";
import type { PolygonState } from "../tools/polygon/model";
import type { Camera } from "../view/camera";
import type { AppState } from "./app";
import type { Store } from "./store";

type Json = Record<string, unknown>;
export const CLIENT_STATE_VERSION = 1;

/** View-only state saved in the session archive; filters and protection live in the backend state. */
export function serialiseClientState(s: AppState): Json {
  return {
    v: CLIENT_STATE_VERSION,
    camera: s.camera,
    pivot: s.camera.target,
    colour: s.colour.mode,
    pointSize: s.colour.pointSize,
    comparison: { mode: s.compare, opacity: s.overlayOpacity },
    unit: s.session?.unit ?? "m",
    tools: { box: s.tools.box, polygon: s.tools.polygon, cluster: s.tools.cluster },
    ui: { budget: s.budget, scope: s.scope, op: s.op, gizmo: s.gizmo },
  };
}

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const nums = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number" && Number.isFinite(x));

export interface ClientPatch {
  camera?: Camera;
  colour?: AppState["colour"];
  compare?: CompareMode;
  overlayOpacity?: number;
  budget?: number;
  scope?: AppState["scope"];
  op?: AppState["op"];
  tools?: Partial<Pick<AppState["tools"], "box" | "polygon" | "cluster">>;
}

const COLOURS = ["height", "rgb", "intensity", "flat"];

/** Returns null for an unknown version or non-object; ignores each malformed section on its own. */
export function restoreClientState(raw: unknown): ClientPatch | null {
  if (!isObj(raw) || raw.v !== CLIENT_STATE_VERSION) return null;
  const out: ClientPatch = {};
  const c = raw.camera;
  if (isObj(c) && nums(c.target, 3) && nums(c.orientation, 4) && typeof c.distance === "number" && c.distance > 0 && Number.isFinite(c.distance) && typeof c.ortho === "boolean") {
    out.camera = { target: [...c.target] as Camera["target"], orientation: [...c.orientation] as Quat, distance: c.distance, ortho: c.ortho };
  }
  if (typeof raw.colour === "string" && COLOURS.includes(raw.colour) && typeof raw.pointSize === "number" && raw.pointSize > 0 && raw.pointSize <= 50) {
    out.colour = { mode: raw.colour as AppState["colour"]["mode"], pointSize: raw.pointSize };
  }
  const cmp = raw.comparison;
  if (isObj(cmp)) {
    if (typeof cmp.mode === "string" && (COMPARE_MODES as string[]).includes(cmp.mode)) out.compare = cmp.mode as CompareMode;
    if (typeof cmp.opacity === "number") out.overlayOpacity = clampOpacity(cmp.opacity);
  }
  const ui = raw.ui;
  if (isObj(ui)) {
    if (typeof ui.budget === "number" && ui.budget >= 1) out.budget = ui.budget;
    if (ui.scope === "displayed" || ui.scope === "active") out.scope = ui.scope;
    if (["replace", "add", "subtract", "intersect"].includes(ui.op as string)) out.op = ui.op as AppState["op"];
  }
  const t = raw.tools;
  if (isObj(t)) {
    const tools: NonNullable<ClientPatch["tools"]> = {};
    const b = t.box;
    if (isObj(b) && nums(b.center, 3) && nums(b.dimensions, 3) && nums(b.quat, 4) && (b.mode === "inside" || b.mode === "outside")) {
      tools.box = { center: [...b.center], dimensions: [...b.dimensions], quat: [...b.quat], mode: b.mode } as BoxModel;
    }
    const p = t.polygon;
    if (
      isObj(p) &&
      ["idle", "closed"].includes(p.phase as string) &&
      Array.isArray(p.vertices) &&
      p.vertices.every((v) => nums(v, 2)) &&
      typeof p.zMin === "number" &&
      typeof p.zMax === "number" &&
      (p.mode === "inside" || p.mode === "outside")
    ) {
      tools.polygon = { phase: p.phase, vertices: p.vertices, previous: null, zMin: p.zMin, zMax: p.zMax, mode: p.mode } as PolygonState;
    }
    const k = t.cluster;
    if (isObj(k) && typeof k.radius === "number" && k.radius > 0 && typeof k.excludeProtected === "boolean" && typeof k.maxPoints === "number" && ["none", "box", "prism"].includes(k.region as string) && (k.scope === "displayed" || k.scope === "active")) {
      tools.cluster = { seed: null, radius: k.radius, region: k.region, excludeProtected: k.excludeProtected, maxPoints: k.maxPoints, scope: k.scope } as ClusterModel;
    }
    if (Object.keys(tools).length > 0) out.tools = tools;
  }
  return out;
}

export interface PersisterOptions {
  ms?: number;
  dragging: () => boolean;
}

/** Debounced PUT of the serialised client state; skips unchanged state, no session, and any drag in progress. */
export function createPersister(
  store: Store<AppState>,
  put: (state: Json) => Promise<unknown>,
  opts: PersisterOptions,
) {
  const deb = createDebouncer(opts.ms ?? 1000);
  let last: string | null = null;
  let sessionId: string | undefined;
  const arm = (): void =>
    deb.call(() => {
      if (opts.dragging()) return arm();
      const s = store.get();
      if (!s.session) return;
      const body = serialiseClientState(s);
      const text = JSON.stringify(body);
      if (text === last) return;
      last = text;
      void put(body).catch(() => {
        last = null;
      });
    });
  const unsub = store.subscribe((s) => {
    if (s.session?.session_id !== sessionId) {
      sessionId = s.session?.session_id;
      last = s.session ? JSON.stringify(serialiseClientState(s)) : null;
      return;
    }
    if (!s.session) return;
    if (JSON.stringify(serialiseClientState(s)) !== last) arm();
  });
  return {
    dispose() {
      unsub();
      deb.cancel();
    },
  };
}

/** Merges a restored patch into the state; filters and protection are left to the backend state. */
export function applyClientPatch(s: AppState, p: ClientPatch): AppState {
  return {
    ...s,
    camera: p.camera ?? s.camera,
    colour: p.colour ?? s.colour,
    ...(p.compare ? { compare: p.compare, renderMode: fetchPlan(p.compare).primary, render2: null } : {}),
    overlayOpacity: p.overlayOpacity ?? s.overlayOpacity,
    budget: p.budget ?? s.budget,
    scope: p.scope ?? s.scope,
    op: p.op ?? s.op,
    tools: { ...s.tools, ...p.tools },
  };
}
