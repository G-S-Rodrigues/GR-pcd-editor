/** Optional text view of a numeric field: `empty` is the number a blank (or "unlimited") entry means. */
export interface NumberView {
  show: (v: number) => string;
  empty: number;
}

/** Shared commit rule of every typed number: returns an error message, or null when `commit` accepted the value. */
export function commitNumber(raw: string, label: string, commit: (v: number) => string | null, view?: NumberView): string | null {
  const text = raw.trim();
  const blank = view !== undefined && (text === "" || text.toLowerCase() === "unlimited");
  const v = blank ? view.empty : Number(text);
  if ((text === "" && !blank) || Number.isNaN(v)) return `${label} must be a number`;
  return commit(v);
}
