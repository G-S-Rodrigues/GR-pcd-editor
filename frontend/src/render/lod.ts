const fmt = (n: number) => n.toLocaleString("en-US");

function ordinal(n: number): string {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

export interface LodInfo {
  count: number;
  eligible: number;
  budget: number;
}

/** Describes the sampled render; it is never a cloud total. */
export function lodLabel({ count, eligible, budget }: LodInfo): string {
  if (count >= eligible) return `Rendered all ${fmt(count)} eligible points`;
  const step = Math.max(2, Math.ceil(eligible / Math.max(1, budget)));
  return `Rendered ${fmt(count)} of ${fmt(eligible)} eligible (every ${ordinal(step)} point, sampled)`;
}
