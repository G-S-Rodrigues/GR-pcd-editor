import { ApiError } from "../files/errors";
import { bandFromPlane, bandReplaceText, type ProtectionEdit, type ProtectionModel } from "../inspector/protection";
import { type AppState, addNotice, clearNotices } from "../state/app";
import type { Store } from "../state/store";
import { toBoxTool } from "../tools/box/model";
import { toPrismTool } from "../tools/polygon/model";
import { type DetectedPlane, chosenFrom } from "../tools/plane/model";
import { armTool } from "./toolstate";

export const DETECTING_TEXT = "Detecting planes…";
export const STALE_DETECT_TEXT = "The cloud changed while planes were detected; detect again";

export interface PlanesApi {
  detect(body: {
    cloud_revision: number;
    scope: AppState["scope"];
    distance: number;
    max_tilt_deg: number;
    max_planes: number;
    region: unknown;
    exclude_protected: boolean;
  }): Promise<{ id: string }>;
  poll(id: string, opts: { signal?: AbortSignal; onProgress?: (p: number | null, m: string | null) => void }): Promise<Record<string, unknown>>;
  cancelJob(id: string): Promise<unknown>;
}

export interface PlanesDeps {
  protectionEdit(fn: (m: ProtectionModel) => ProtectionEdit): ProtectionEdit;
  confirm(text: string): boolean;
  toolChanged(): void;
}

/** Where the detection ran and what the list says about it. */
export function planesNote(s: AppState): string {
  const p = s.planes;
  if (p.busy) return `${p.message ?? DETECTING_TEXT}${p.progress === null ? "" : ` ${Math.round(p.progress * 100)}%`}`;
  if (p.list === null) return "";
  const n = p.eligible.toLocaleString("en-US");
  const used = p.scope === "displayed" ? "the displayed points" : "the active points";
  const fresh = s.session !== null && p.revision === s.session.revision.cloud;
  const head = p.list.length === 0 ? `No planes found among ${n} points` : `${p.list.length} found among ${n} points`;
  return `${head} (detection used ${used}${p.scope === "displayed" ? "; the display filter applies" : ""}).${fresh ? "" : " The cloud changed since; detect again."}`;
}

export function createPlanesController(store: Store<AppState>, api: PlanesApi, deps: PlanesDeps) {
  let ctl: AbortController | null = null;
  let jobId: string | null = null;
  let run = 0;
  const set = (patch: Partial<AppState["planes"]>) => store.update((s) => ({ ...s, planes: { ...s.planes, ...patch } }));

  const centreOf = (s: AppState): [number, number] => {
    const b = s.session?.active_bounds;
    return b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] : [0, 0];
  };

  async function detect(): Promise<void> {
    const s = store.get();
    if (!s.session || s.planes.busy) return;
    const m = s.tools.plane;
    const region = m.region === "box" ? toBoxTool(s.tools.box) : m.region === "prism" ? toPrismTool(s.tools.polygon) : null;
    const mine = ++run;
    const revision = s.session.revision.cloud;
    const mineCtl = new AbortController();
    ctl = mineCtl;
    jobId = null;
    set({ busy: true, progress: null, message: DETECTING_TEXT, rowNote: null });
    try {
      const { id } = await api.detect({ cloud_revision: revision, scope: s.scope, distance: m.distance, max_tilt_deg: m.maxTilt, max_planes: m.maxPlanes, region, exclude_protected: m.excludeProtected });
      jobId = id;
      const out = await api.poll(id, { signal: mineCtl.signal, onProgress: (p, msg) => mine === run && set({ progress: p, message: msg ? `${DETECTING_TEXT} ${msg}` : DETECTING_TEXT }) });
      if (mine !== run) return;
      const now = store.get().session?.revision.cloud;
      if (out.cloud_revision !== now) {
        set({ busy: false, progress: null, message: null });
        addNotice(store, "warn", "planes_stale", STALE_DETECT_TEXT);
        return;
      }
      clearNotices(store, ["planes_stale", "planes_failed"]);
      set({
        list: out.planes as DetectedPlane[],
        eligible: Number(out.eligible ?? 0),
        scope: out.scope === "active" ? "active" : "displayed",
        revision: out.cloud_revision as number,
        chosenRow: null,
        busy: false,
        progress: null,
        message: null,
      });
    } catch (e) {
      if (mine !== run) return;
      set({ busy: false, progress: null, message: null });
      if (e instanceof ApiError && (e.code === "cancelled" || e.status === 0)) return;
      if (e instanceof ApiError && e.status === 409) addNotice(store, "warn", "planes_stale", STALE_DETECT_TEXT);
      else addNotice(store, "error", "planes_failed", e instanceof Error ? e.message : "Plane detection failed");
    } finally {
      if (mine === run) {
        ctl = null;
        jobId = null;
      }
    }
  }

  function cancel(): void {
    if (!store.get().planes.busy) return;
    run++; // the pending result, if any, is dropped
    const id = jobId;
    ctl?.abort();
    ctl = null;
    jobId = null;
    if (id) void api.cancelJob(id).catch(() => undefined);
    set({ busy: false, progress: null, message: null });
  }

  /** Choosing a row arms the Planes tool with that plane and runs the first-selection or live path. */
  function select(i: number): void {
    const s = store.get();
    const p = s.planes.list?.[i];
    if (!p || !s.session) return;
    store.update((st) => ({ ...armTool(st, "plane"), planes: { ...st.planes, chosen: chosenFrom(p, st.tools.plane.distance), chosenRow: i, rowNote: null } }));
    deps.toolChanged();
  }

  /** Use as protection band: a refusal shows under the row; an enabled band is replaced only after a confirm (O11). */
  function band(i: number): void {
    const s = store.get();
    const p = s.planes.list?.[i];
    if (!p) return;
    const plane = chosenFrom(p, s.tools.plane.distance);
    const centre = centreOf(s);
    const probe = bandFromPlane(s.tools.protection, plane, centre);
    if (!probe.ok) {
      set({ rowNote: { row: i, text: probe.error ?? "This plane cannot be a band" } });
      return;
    }
    const ask = bandReplaceText(s.tools.protection);
    if (ask !== null && !deps.confirm(ask)) return;
    const r = deps.protectionEdit((m) => bandFromPlane(m, plane, centre));
    set({ rowNote: r.ok ? null : { row: i, text: r.error ?? "The band was not applied" } });
  }

  return { detect, cancel, select, band };
}
