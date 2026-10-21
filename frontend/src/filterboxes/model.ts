import type { Axis, Side } from "../inspector/filters";
import { AXES } from "../inspector/filters";
import type { FilterUi } from "../state/app";

export interface BoxId {
  axis: Axis;
  side: Side;
}

/** Stable id of a box, `x-min` .. `z-max`; also the key of the persisted collapse state. */
export const boxKey = (b: BoxId): string => `${b.axis}-${b.side}`;

/** Deterministic order: x, y, z; max before min. */
export const BOX_IDS: BoxId[] = AXES.flatMap((axis) => (["max", "min"] as Side[]).map((side) => ({ axis, side })));

/**
 * Filter boxes open collapsed: a key that was never touched is collapsed, and only an explicit `false` is expanded
 * (a session saved before this rule holds `{}` and so opens collapsed too).
 */
export const isBoxCollapsed = (ui: Pick<FilterUi, "collapsed">, key: string): boolean => ui.collapsed[key] !== false;
