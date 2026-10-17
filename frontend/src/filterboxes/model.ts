import type { Axis, Side } from "../inspector/filters";
import { AXES } from "../inspector/filters";

export interface BoxId {
  axis: Axis;
  side: Side;
}

/** Stable id of a box, `x-min` .. `z-max`; also the key of the persisted collapse state. */
export const boxKey = (b: BoxId): string => `${b.axis}-${b.side}`;

/** Deterministic order: x, y, z; max before min. */
export const BOX_IDS: BoxId[] = AXES.flatMap((axis) => (["max", "min"] as Side[]).map((side) => ({ axis, side })));
