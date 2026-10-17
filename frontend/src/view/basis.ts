import { type Quat, fromBasis } from "../math/quat";
import { cross, normalize } from "../math/vec";
import type { Vec3 } from "../state/types";

/** Camera orientation looking along `forward` with `up` as screen up. */
export function fromBasisLookUp(forward: Vec3, up: Vec3): Quat {
  const f = normalize(forward);
  const right = normalize(cross(f, up));
  const u = cross(right, f);
  return fromBasis(right, u, [-f[0], -f[1], -f[2]]);
}
