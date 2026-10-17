import { PRESET_ORDER, type PresetName } from "../view/presets";

export interface KeyBinding {
  key: string;
  label: string;
  preset?: PresetName;
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Keys 1-6 look along the six axes; the same order as the ViewCube faces. */
export const VIEW_KEYS: KeyBinding[] = PRESET_ORDER.map((p, i) => ({ key: String(i + 1), label: `${cap(p)} view`, preset: p }));
export const presetForKey = (k: string): PresetName | null => VIEW_KEYS.find((b) => b.key === k)?.preset ?? null;
