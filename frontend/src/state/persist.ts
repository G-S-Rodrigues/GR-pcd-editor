import { layerModeFix } from "../layers/model";
import { COMPARE_MODES, type CompareMode, clampOpacity, fetchPlan } from "../compare/model";
import { createDebouncer } from "../orchestration/timing";
import type { Quat } from "../math/quat";
import type { BoxModel } from "../tools/box/model";
import { type ClusterModel, defaultCluster } from "../tools/cluster/model";
import type { PolygonState } from "../tools/polygon/model";
import type { Camera } from "../view/camera";
import { type SelectedColourId, isSelectedColourId } from "../colour/selectcolour";
import { SECTION_IDS, type SectionId, type SectionsOpen } from "../ui/sections";
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
    tools: { box: s.tools.box, polygon: { ...s.tools.polygon, editing: false }, cluster: s.tools.cluster },
    ui: { budget: s.budget, gizmo: s.gizmo, boxesCollapsed: s.filterUi.collapsed, floorPanelOpen: s.floorPanelOpen, sectionsOpen: s.sectionsOpen, ...(s.legendOpen ? {} : { legendOpen: false }), ...(s.previewLive ? {} : { previewLive: false }), ...(s.selectedColour === "orange" ? {} : { selectedColour: s.selectedColour }) },
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
  boxesCollapsed?: Record<string, boolean>;
  floorPanelOpen?: boolean;
  sectionsOpen?: SectionsOpen;
  legendOpen?: boolean;
  previewLive?: boolean;
  selectedColour?: SelectedColourId;
  tools?: Partial<Pick<AppState["tools"], "box" | "polygon" | "cluster">>;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const unitQuat = (v: unknown): v is number[] => nums(v, 4) && Math.hypot(...v) > 1e-9;
const BOX_KEYS = ["x", "y", "z"].flatMap((a) => ["min", "max"].map((s) => `${a}-${s}`));
const COLOURS = ["turbo", "viridis", "flat", "distance", "normals", "layers"];
/** Saved colour modes of older builds: Height, RGB and Intensity all open as Turbo (RGB and Intensity were removed in part 12). */
const OLD_COLOURS = ["height", "rgb", "intensity"];
export const migrateColour = (m: string): string | null => (OLD_COLOURS.includes(m) ? "turbo" : COLOURS.includes(m) ? m : null);

/** Returns null for an unknown version or non-object; ignores each malformed section on its own. */
export function restoreClientState(raw: unknown): ClientPatch | null {
  if (!isObj(raw) || raw.v !== CLIENT_STATE_VERSION) return null;
  const out: ClientPatch = {};
  const c = raw.camera;
  if (isObj(c) && nums(c.target, 3) && unitQuat(c.orientation) && typeof c.distance === "number" && c.distance > 0 && Number.isFinite(c.distance) && typeof c.ortho === "boolean") {
    out.camera = { target: [...c.target] as Camera["target"], orientation: [...c.orientation] as Quat, distance: c.distance, ortho: c.ortho };
  }
  const mode = typeof raw.colour === "string" ? migrateColour(raw.colour) : null;
  if (mode !== null && finite(raw.pointSize) && raw.pointSize > 0 && raw.pointSize <= 50) {
    out.colour = { mode: mode as AppState["colour"]["mode"], pointSize: raw.pointSize };
  }
  const cmp = raw.comparison;
  if (isObj(cmp)) {
    if (typeof cmp.mode === "string" && (COMPARE_MODES as string[]).includes(cmp.mode)) out.compare = cmp.mode as CompareMode;
    if (typeof cmp.opacity === "number") out.overlayOpacity = clampOpacity(cmp.opacity);
  }
  const ui = raw.ui;
  if (isObj(ui)) {
    if (finite(ui.budget) && ui.budget >= 1) out.budget = ui.budget;
    if (isObj(ui.boxesCollapsed)) {
      const kept: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(ui.boxesCollapsed)) if (BOX_KEYS.includes(k) && typeof v === "boolean") kept[k] = v;
      out.boxesCollapsed = kept;
    }
    if (ui.legendOpen === false) out.legendOpen = false;
    if (ui.previewLive === false) out.previewLive = false;
    if (isSelectedColourId(ui.selectedColour) && ui.selectedColour !== "orange") out.selectedColour = ui.selectedColour;
    if (typeof ui.floorPanelOpen === "boolean") out.floorPanelOpen = ui.floorPanelOpen;
    if (isObj(ui.sectionsOpen)) {
      const kept: SectionsOpen = {};
      for (const [k, v] of Object.entries(ui.sectionsOpen)) if ((SECTION_IDS as readonly string[]).includes(k) && v === false) kept[k as SectionId] = false;
      out.sectionsOpen = kept;
    }
  }
  const t = raw.tools;
  if (isObj(t)) {
    const tools: NonNullable<ClientPatch["tools"]> = {};
    const b = t.box;
    if (isObj(b) && nums(b.center, 3) && nums(b.dimensions, 3) && b.dimensions.every((d) => d > 0) && unitQuat(b.quat) && (b.mode === "inside" || b.mode === "outside")) {
      tools.box = { center: [...b.center], dimensions: [...b.dimensions], quat: [...b.quat], mode: b.mode } as BoxModel;
    }
    const p = t.polygon;
    if (
      isObj(p) &&
      ["idle", "closed"].includes(p.phase as string) &&
      Array.isArray(p.vertices) &&
      p.vertices.every((v) => nums(v, 2)) &&
      finite(p.zMin) &&
      finite(p.zMax) &&
      p.zMin <= p.zMax &&
      (p.mode === "inside" || p.mode === "outside")
    ) {
      tools.polygon = { phase: p.phase, vertices: p.vertices, previous: null, zMin: p.zMin, zMax: p.zMax, mode: p.mode, editing: false } as PolygonState;
    }
    const k = t.cluster;
    if (isObj(k) && finite(k.radius) && k.radius > 0 && typeof k.excludeProtected === "boolean" && ["none", "box", "prism"].includes(k.region as string) && (k.scope === "displayed" || k.scope === "active")) {
      tools.cluster = { seed: null, radius: k.radius, region: k.region, excludeProtected: k.excludeProtected, maxPoints: defaultCluster().maxPoints, scope: k.scope } as ClusterModel;
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
  let inflight: Promise<unknown> = Promise.resolve();
  const send = (): void => {
    const s = store.get();
    if (!s.session) return;
    const body = serialiseClientState(s);
    const text = JSON.stringify(body);
    if (text === last) return;
    last = text;
    inflight = put(body).catch(() => {
      last = null;
    });
  };
  const arm = (): void =>
    deb.call(() => {
      if (opts.dragging()) return arm();
      send();
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
    /** Sends a pending change now (a Save right after a fold or camera move must archive it) and waits for the PUT. */
    async flush(): Promise<void> {
      deb.cancel();
      send();
      await inflight;
    },
    dispose() {
      unsub();
      deb.cancel();
    },
  };
}

/** Merges a restored patch into the state: view state only. Filters and protection come from the backend; op, scope and tool are never restored. */
export function applyClientPatch(s: AppState, p: ClientPatch): AppState {
  const colour = p.colour ?? s.colour;
  return {
    ...s,
    camera: p.camera ?? s.camera,
    colour: layerModeFix({ colour, session: s.session }) ?? colour,
    ...(p.compare ? { compare: p.compare, renderMode: fetchPlan(p.compare).primary, render2: null } : {}),
    overlayOpacity: p.overlayOpacity ?? s.overlayOpacity,
    budget: p.budget ?? s.budget,
    filterUi: p.boxesCollapsed ? { ...s.filterUi, collapsed: p.boxesCollapsed } : s.filterUi,
    floorPanelOpen: p.floorPanelOpen ?? s.floorPanelOpen,
    sectionsOpen: p.sectionsOpen ?? s.sectionsOpen,
    legendOpen: p.legendOpen ?? s.legendOpen,
    previewLive: p.previewLive ?? s.previewLive,
    selectedColour: p.selectedColour ?? s.selectedColour,
    tools: { ...s.tools, ...p.tools },
  };
}
