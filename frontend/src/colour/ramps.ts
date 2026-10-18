import type { Bounds } from "../state/types";
import type { Rgb } from "./palette";

/** Gradient stops of the approved colour modes (review/symbol-sheet.html, colour modes table). */
export const TURBO_HEX = ["#30123b", "#4662d7", "#36aaf9", "#1ae4b6", "#72fe5e", "#c7ef34", "#faba39", "#f66b19", "#cb2a04", "#7a0403"] as const;
export const VIRIDIS_HEX = ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"] as const;
/** Distance to viewer: near is light, far is dark. */
export const DISTANCE_HEX = ["#ffe9a8", "#f2a35e", "#a64d79", "#3a2f7a", "#1b2a6b"] as const;

const toRgb = (h: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as unknown as Rgb;

export type RampId = "turbo" | "viridis" | "distance";
export const RAMP_STOPS: Record<RampId, readonly Rgb[]> = {
  turbo: TURBO_HEX.map(toRgb),
  viridis: VIRIDIS_HEX.map(toRgb),
  distance: DISTANCE_HEX.map(toRgb),
};

/** Piecewise-linear colour of a stop table at t in 0..1 (clamped). */
export function rampAt(stops: readonly Rgb[], t: number): Rgb {
  const f = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const u = f - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

export const cssGradient = (stops: readonly Rgb[]): string => {
  const hex = (c: Rgb) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  return `linear-gradient(90deg, ${stops.map(hex).join(", ")})`;
};

export interface RampLegend {
  id: RampId;
  title: string;
  stops: readonly Rgb[];
  minLabel: string;
  maxLabel: string;
}

const num = (v: number): string => String(Number(v.toFixed(2)));

/** The colour key of the active mode: a gradient with its two end labels; null when the mode has no ramp. */
export function rampLegend(mode: string, bounds: Bounds | null, unit = "m"): RampLegend | null {
  if (mode === "turbo" || mode === "viridis") {
    return {
      id: mode,
      title: mode === "turbo" ? "Height (Turbo)" : "Height (Viridis)",
      stops: RAMP_STOPS[mode],
      minLabel: bounds ? `${num(bounds.min[2])} ${unit}` : "low",
      maxLabel: bounds ? `${num(bounds.max[2])} ${unit}` : "high",
    };
  }
  if (mode === "distance") return { id: "distance", title: "Distance to viewer", stops: RAMP_STOPS.distance, minLabel: "near", maxLabel: "far" };
  return null;
}
