const fmt = (n: number) => n.toLocaleString("en-US");

export interface LodInfo {
  count: number;
  eligible: number;
  /** The requested budget; the backend draws exactly this many (plus flagged points up to half again). */
  budget: number;
}

/** Describes the sampled render; it is never a cloud total. */
export function lodLabel({ count, eligible }: LodInfo): string {
  if (count >= eligible) return `Rendered all ${fmt(count)} eligible points`;
  return `Rendered ${fmt(count)} of ${fmt(eligible)} eligible (sampled to budget)`;
}

/** The same text without the leading "Rendered": for the status item that is already labelled Rendered. */
export function lodValue(info: LodInfo): string {
  return lodLabel(info).replace(/^Rendered /, "");
}

/** Points drawn while the camera moves (orbit, pan, wheel). */
export const LOD_INTERACT = 150_000;
/** At most this many selected or protected points are kept on top of the stride sample while moving. */
export const LOD_FLAGGED_CAP = 50_000;
/** The full draw comes back this long after the last camera change. */
export const LOD_IDLE_MS = 250;
const SELECTED_OR_PROTECTED = 1 | 2 | 8 | 16;

/**
 * Draw index for interaction: every `ceil(n / cap)`-th point (deterministic, at most `cap`) plus the selected and
 * protected points (flags 1, 2 and the preview bits 8, 16; deleted-only points do not count), thinned evenly to `LOD_FLAGGED_CAP` if there
 * are more. Ascending, no duplicates. Null when the cloud already fits the cap: draw everything.
 */
export function lodIndex(n: number, cap: number, flags?: Uint8Array): Uint32Array | null {
  if (n <= cap) return null;
  const stride = Math.ceil(n / cap);
  const sampled = Math.ceil(n / stride);
  let flagged: number[] = [];
  if (flags) for (let i = 0; i < n; i++) if (flags[i] & SELECTED_OR_PROTECTED) flagged.push(i);
  if (flagged.length > LOD_FLAGGED_CAP) {
    const every = flagged.length / LOD_FLAGGED_CAP;
    flagged = Array.from({ length: LOD_FLAGGED_CAP }, (_, k) => flagged[Math.floor(k * every)]);
  }
  const out = new Uint32Array(sampled + flagged.length);
  let o = 0;
  let s = 0; // next sampled index = s * stride
  let f = 0;
  while (s < sampled || f < flagged.length) {
    const a = s < sampled ? s * stride : Number.POSITIVE_INFINITY;
    const b = f < flagged.length ? flagged[f] : Number.POSITIVE_INFINITY;
    if (a <= b) {
      out[o++] = a;
      s++;
      if (a === b) f++;
    } else {
      out[o++] = b;
      f++;
    }
  }
  return out.subarray(0, o);
}

export interface LodGate {
  /** True from the first camera change until `LOD_IDLE_MS` after the last one. */
  active(): boolean;
  cameraMoved(): void;
  dispose(): void;
}

/** Tracks "the camera is moving"; `onChange` fires only when that flips. */
export function createLodGate(onChange: (active: boolean) => void, idleMs = LOD_IDLE_MS): LodGate {
  let on = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    active: () => on,
    cameraMoved() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        on = false;
        onChange(false);
      }, idleMs);
      if (!on) {
        on = true;
        onChange(true);
      }
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
