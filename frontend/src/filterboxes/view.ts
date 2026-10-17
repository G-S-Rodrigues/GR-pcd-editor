import { AXES, type Axis, type FilterModel, type Side, sideActive, sideValue } from "../inspector/filters";
import type { Bounds } from "../state/types";

export interface BoxView {
  label: string;
  valueText: string;
  ariaValueText: string;
  /** Text of the collapsed chip, e.g. `Z>= 0.5`. */
  chipText: string;
  active: boolean;
  collapsed: boolean;
  disabled: boolean;
  /** Slider range and value (cloud bounds on that axis, the side's shown value). */
  min: number;
  max: number;
  now: number;
  classes: string;
}

const round6 = (v: number) => String(Math.round(v * 1e6) / 1e6);
const round3 = (v: number) => String(Math.round(v * 1e3) / 1e3);

/** Everything a box needs to draw itself; pure so the DOM binder stays thin. */
export function boxView(m: FilterModel, b: Bounds | null, axis: Axis, side: Side, collapsed: boolean): BoxView {
  const i = AXES.indexOf(axis);
  const A = axis.toUpperCase();
  const now = sideValue(m, b, axis, side);
  const active = sideActive(m, b, axis, side);
  const disabled = b === null;
  const label = `${A} ${side}`;
  return {
    label,
    valueText: round6(now),
    ariaValueText: `${label} ${round6(now)}`,
    chipText: `${A}${side === "min" ? ">=" : "<="} ${round3(now)}`,
    active,
    collapsed,
    disabled,
    min: b ? b.min[i] : 0,
    max: b ? b.max[i] : 0,
    now,
    classes: ["fbox", active && "active", collapsed && "collapsed", disabled && "disabled"].filter(Boolean).join(" "),
  };
}

export function parseBoxInput(raw: string): { ok: true; value: number } | { ok: false } {
  const t = raw.trim();
  if (t === "") return { ok: false };
  const v = Number(t);
  return Number.isNaN(v) ? { ok: false } : { ok: true, value: v };
}

/** New value for a nudge key on a focused grip, or null when the key is not a nudge key (or there is no cloud). */
export function nudgeValue(current: number, b: Bounds | null, axis: Axis, key: string, shift: boolean): number | null {
  if (!b) return null;
  const i = AXES.indexOf(axis);
  const step = ((b.max[i] - b.min[i]) / 100) * (shift ? 0.1 : 1);
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return current + step;
    case "ArrowLeft":
    case "ArrowDown":
      return current - step;
    case "PageUp":
      return current + 10 * step;
    case "PageDown":
      return current - 10 * step;
    case "Home":
      return b.min[i];
    case "End":
      return b.max[i];
    default:
      return null;
  }
}
