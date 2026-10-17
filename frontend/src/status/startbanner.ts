import type { AppState } from "../state/app";

export interface StartBanner {
  title: string;
  reason: string;
}

/** Shown in the side panels until a file is open: why the tools are inert and what to do. */
export function startBanner(s: AppState): StartBanner | null {
  if (s.session) return null;
  return {
    title: "Open a PCD to start",
    reason: "The tools and editing panels are disabled until a file is open. Use Open from this computer, or drop a .pcd or .pcdsession file anywhere.",
  };
}
