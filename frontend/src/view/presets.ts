import type { Vec3 } from "../state/types";
import { fromBasisLookUp } from "./basis";
import type { Camera } from "./camera";

export const PRESETS = {
  top: { look: [0, 0, -1], up: [0, 1, 0] },
  bottom: { look: [0, 0, 1], up: [0, 1, 0] },
  front: { look: [0, 1, 0], up: [0, 0, 1] },
  back: { look: [0, -1, 0], up: [0, 0, 1] },
  left: { look: [1, 0, 0], up: [0, 0, 1] },
  right: { look: [-1, 0, 0], up: [0, 0, 1] },
} as const satisfies Record<string, { look: Vec3; up: Vec3 }>;

export type PresetName = keyof typeof PRESETS;
export const PRESET_ORDER: PresetName[] = ["top", "bottom", "front", "back", "left", "right"];

/** Looks along the preset axis in orthographic projection; target and distance are kept. */
export function applyPreset(c: Camera, name: PresetName): Camera {
  const p = PRESETS[name];
  return { ...c, orientation: fromBasisLookUp([...p.look], [...p.up]), ortho: true };
}
