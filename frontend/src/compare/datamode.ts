import type { IconName } from "../ui/icons";
import { COMPARE_MODES, type CompareMode } from "./model";

export interface DataModeItem {
  mode: CompareMode;
  icon: IconName;
  pressed: boolean;
  disabled: boolean;
}

const ICON: Record<CompareMode, IconName> = { original: "orig", edited: "edit", overlay: "ovl", split: "split" };

/** The data-mode icon group: one pressed item, all disabled without a file; the opacity slider shows only in Overlay. */
export function dataModeModel(mode: CompareMode, hasSession: boolean): { items: DataModeItem[]; showOpacity: boolean } {
  return {
    items: COMPARE_MODES.map((m) => ({ mode: m, icon: ICON[m], pressed: m === mode, disabled: !hasSession })),
    showOpacity: hasSession && mode === "overlay",
  };
}
