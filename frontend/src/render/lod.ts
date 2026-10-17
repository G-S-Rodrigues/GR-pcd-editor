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
