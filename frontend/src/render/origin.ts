import type { Vec3 } from "../state/types";

/** Scene (origin-relative, float32-exact) -> world, in float64. */
export const toWorld = (local: Vec3, origin: Vec3): Vec3 => [
  local[0] + origin[0],
  local[1] + origin[1],
  local[2] + origin[2],
];
export const toLocal = (world: Vec3, origin: Vec3): Vec3 => [
  world[0] - origin[0],
  world[1] - origin[1],
  world[2] - origin[2],
];
