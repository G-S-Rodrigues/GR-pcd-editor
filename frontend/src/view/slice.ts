export type SliceAxis = "x" | "y" | "z";

/** A render-only slab: points with centre - thickness/2 <= coordinate <= centre + thickness/2 on `axis` stay drawn. */
export interface Slice {
  enabled: boolean;
  axis: SliceAxis;
  centre: number;
  thickness: number;
}

export const defaultSlice = (): Slice => ({ enabled: false, axis: "z", centre: 0, thickness: 1 });

export const AXIS_INDEX: Record<SliceAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
