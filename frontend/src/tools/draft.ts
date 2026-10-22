import type { AppState } from "../state/app";

export const LIVE_OUTLINE = 0xffd23f;
export const DRAFT_OUTLINE = 0x7ee8fa;
/** The light stage's outlines (3:1 or more on #e9ebef and #f6f7f9, 100 RGB apart): near-black ink and a deep teal. */
export const LIGHT_LIVE_OUTLINE = 0x34343d;
export const LIGHT_DRAFT_OUTLINE = 0x007c99;

/** Text under the selection controls while an Add/Subtract/Intersect shape is only drafted. The count stays unknown, never invented. */
export function draftText(s: AppState): string | null {
  if (!s.draft) return null;
  return `Draft, not yet applied: the outline shows the ${s.op} shape. Its count is unknown until you commit it.`;
}

/** Outline style of the tool shape: a draft is drawn in its own colour so it is not mistaken for the live preview. */
export function draftOutline(s: AppState): { draft: boolean; colour: number } {
  const light = s.renderTheme === "light";
  return s.draft ? { draft: true, colour: light ? LIGHT_DRAFT_OUTLINE : DRAFT_OUTLINE } : { draft: false, colour: light ? LIGHT_LIVE_OUTLINE : LIVE_OUTLINE };
}
