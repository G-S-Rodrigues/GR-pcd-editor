import type { AppState } from "../state/app";

export const LIVE_OUTLINE = 0xffd23f;
export const DRAFT_OUTLINE = 0x7ee8fa;

/** Text under the selection controls while an Add/Subtract/Intersect shape is only drafted. The count stays unknown, never invented. */
export function draftText(s: AppState): string | null {
  if (!s.draft) return null;
  return `Draft, not yet applied: the outline shows the ${s.op} shape. Its count is unknown until you commit it.`;
}

/** Outline style of the tool shape: a draft is drawn in its own colour so it is not mistaken for the live preview. */
export function draftOutline(s: AppState): { draft: boolean; colour: number } {
  return s.draft ? { draft: true, colour: DRAFT_OUTLINE } : { draft: false, colour: LIVE_OUTLINE };
}
