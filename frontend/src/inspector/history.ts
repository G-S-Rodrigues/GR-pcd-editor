import type { SessionState } from "../state/types";

export interface HistoryRow {
  label: string;
  count: number;
  /** The newest applied entry. */
  current: boolean;
  /** Undone (in the redo branch). */
  undone: boolean;
}

export function historyRows(s: SessionState): HistoryRow[] {
  const { entries, cursor } = s.history;
  return entries.map((e, i) => ({
    label: e.description,
    count: e.count,
    current: i === cursor - 1,
    undone: i >= cursor,
  }));
}
