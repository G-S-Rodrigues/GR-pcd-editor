import { type Quat, rotate } from "../math/quat";
import { dot } from "../math/vec";
import type { Vec3 } from "../state/types";
import { CUBE_NAV, CUBE_SIDE } from "./layout";
import { PRESET_ORDER, type PresetName } from "./presets";
import { cubeTransform, faceForDirection } from "./cube";

/**
 * Pure placement of the ViewCube's arrows and corner zones. Positions are px from the cube centre (x right, y down).
 * One arrow per face sits on one of eight 45-degree slots of the ring; a face that points at or away from the viewer
 * has no screen direction, so it takes a diagonal slot (rule (c) of the plan).
 */
export interface ArrowPos {
  face: PresetName;
  slot: number;
  /** Degrees clockwise from screen-up that the arrow glyph points (the slot direction, away from the cube). */
  angle: number;
  x: number;
  y: number;
}

/** A face whose projected normal is shorter than this has no usable screen direction. */
export const END_ON_LEN = 0.25;
const SLOTS = 8;
const slotDir = (k: number): [number, number] => [Math.sin((k * Math.PI) / 4), -Math.cos((k * Math.PI) / 4)];
const angDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % SLOTS;
  return Math.min(d, SLOTS - d);
};

export function arrowLayout(o: Quat, ring: number = CUBE_NAV.ring): ArrowPos[] {
  const r = rotate(o, [1, 0, 0]);
  const u = rotate(o, [0, 1, 0]);
  const faces = cubeTransform(o).map((f) => {
    const sx = dot(f.normal, r);
    const sy = -dot(f.normal, u);
    const len = Math.hypot(sx, sy);
    // slot coordinate (fractional) clockwise from up
    const at = len > 1e-9 ? ((Math.atan2(sx, -sy) / (Math.PI / 4)) + SLOTS) % SLOTS : -1;
    return { face: f.face, len, at };
  });
  const taken = new Set<number>();
  const slotOf = new Map<PresetName, number>();
  const pick = (at: number, allowed: number[]): number => {
    let best = -1;
    for (const k of allowed) if (!taken.has(k) && (best < 0 || angDist(at, k) < angDist(at, best))) best = k;
    return best;
  };
  const all = [0, 1, 2, 3, 4, 5, 6, 7];
  const diag = [1, 3, 5, 7];
  const long = faces.filter((f) => f.len >= END_ON_LEN).sort((a, b) => b.len - a.len || PRESET_ORDER.indexOf(a.face) - PRESET_ORDER.indexOf(b.face));
  for (const f of long) {
    const k = pick(f.at, all);
    taken.add(k);
    slotOf.set(f.face, k);
  }
  const short = faces.filter((f) => f.len < END_ON_LEN).sort((a, b) => PRESET_ORDER.indexOf(a.face) - PRESET_ORDER.indexOf(b.face));
  for (const f of short) {
    let k: number;
    if (f.at >= 0) k = pick(f.at, diag);
    else {
      // no direction: the first free diagonal, or the one opposite a diagonal already taken by an end-on face
      const used = [...slotOf.entries()].filter(([face]) => short.some((s) => s.face === face)).map(([, v]) => v);
      const opposite = used.length ? (used[0] + 4) % SLOTS : -1;
      k = opposite >= 0 && !taken.has(opposite) ? opposite : pick(1, diag);
    }
    if (k < 0) k = pick(f.at < 0 ? 1 : f.at, all);
    taken.add(k);
    slotOf.set(f.face, k);
  }
  return PRESET_ORDER.map((face) => {
    const slot = slotOf.get(face) as number;
    const [dx, dy] = slotDir(slot);
    return { face, slot, angle: slot * 45, x: dx * ring, y: dy * ring };
  });
}

export interface CornerZone {
  id: string;
  /** The three faces meeting at the corner, in PRESET_ORDER. */
  faces: PresetName[];
  x: number;
  y: number;
  depth: number;
}

const SIGNS = [-1, 1] as const;
const VERTS: { id: string; faces: PresetName[]; v: Vec3 }[] = SIGNS.flatMap((sx) =>
  SIGNS.flatMap((sy) =>
    SIGNS.map((sz) => {
      const v: Vec3 = [sx, sy, sz];
      const faces = ([faceForDirection([sx, 0, 0]), faceForDirection([0, sy, 0]), faceForDirection([0, 0, sz])] as PresetName[]).sort(
        (a, b) => PRESET_ORDER.indexOf(a) - PRESET_ORDER.indexOf(b),
      );
      return { id: `corner-${faces.join("-")}`, faces, v };
    }),
  ),
);
export const CORNER_IDS: string[] = VERTS.map((c) => c.id);

const cross2 = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * Up to eight click zones just outside the silhouette corners of the cube: only corners on the outline get one, a corner
 * hidden behind another at the same screen point keeps the nearer one, and zones closer than `zone` px give way to the
 * nearer one. Every centre lies outside the faces.
 */
export function cornerZones(o: Quat, side: number = CUBE_SIDE, zone: number = CUBE_NAV.zone, offset: number = CUBE_NAV.zoneOffset): CornerZone[] {
  const r = rotate(o, [1, 0, 0]);
  const u = rotate(o, [0, 1, 0]);
  const b = rotate(o, [0, 0, 1]);
  const pts = VERTS.map((c) => ({ ...c, p: [0.5 * side * dot(c.v, r), -0.5 * side * dot(c.v, u)], depth: dot(c.v, b) }));
  // the convex hull (monotone chain, collinear points dropped) is the silhouette
  const near = [...pts].sort((a, c) => c.depth - a.depth);
  const uniq: typeof pts = [];
  for (const q of near) if (!uniq.some((k) => Math.hypot(k.p[0] - q.p[0], k.p[1] - q.p[1]) < 1e-6)) uniq.push(q);
  const sorted = uniq.sort((a, c) => a.p[0] - c.p[0] || a.p[1] - c.p[1]);
  const half = (list: typeof pts) => {
    const h: typeof pts = [];
    for (const q of list) {
      while (h.length >= 2 && cross2(h[h.length - 2].p, h[h.length - 1].p, q.p) <= 1e-9) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  const hull = [...half(sorted), ...half([...sorted].reverse())];
  const out: CornerZone[] = [];
  for (const c of [...hull].sort((a, c2) => c2.depth - a.depth)) {
    const len = Math.hypot(c.p[0], c.p[1]);
    if (len < 1e-6) continue;
    const x = c.p[0] + (c.p[0] / len) * offset;
    const y = c.p[1] + (c.p[1] / len) * offset;
    if (out.some((z) => Math.hypot(z.x - x, z.y - y) < zone)) continue;
    out.push({ id: c.id, faces: c.faces, x, y, depth: c.depth });
  }
  return out;
}
