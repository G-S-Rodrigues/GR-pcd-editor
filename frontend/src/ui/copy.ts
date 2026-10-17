import { FILTER_COPY } from "../inspector/filters";
import { PROTECTION_COPY } from "../inspector/protection";
import { POLYGON_DEPTH_NOTE } from "../tools/polygon/model";

/** Explanatory inspector text blocks (README repeats them). */
export const COPY = {
  scope:
    "Scope decides which points a selection can reach: Displayed means only points that pass the display filter; Active means every point still in the cloud, including hidden ones.",
  protectionSlab: PROTECTION_COPY,
  polygonDepth: POLYGON_DEPTH_NOTE,
  filterVsDelete: FILTER_COPY,
} as const;
