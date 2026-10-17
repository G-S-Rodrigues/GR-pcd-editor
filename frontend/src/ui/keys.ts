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

export type KeyId =
  | "view-1" | "view-2" | "view-3" | "view-4" | "view-5" | "view-6"
  | "perspective" | "fit" | "fit-selection" | "hold-original" | "rect"
  | "slice-prev" | "slice-next" | "polygon-close" | "cancel" | "apply"
  | "undo" | "redo" | "help";

export interface KeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** tagName of the event target. */
  target: string;
}

export interface KeyDoc {
  id: KeyId;
  /** As shown in the help overlay. */
  keys: string;
  label: string;
  /** Events that must classify to this id (the table is tested against them). */
  probes: Partial<KeyEvent>[];
}

/** The single key table: the help overlay renders it and `classifyKey` is what every key handler consults. */
export const KEY_DOCS: KeyDoc[] = [
  ...VIEW_KEYS.map((b, i): KeyDoc => ({ id: `view-${i + 1}` as KeyId, keys: b.key, label: b.label, probes: [{ key: b.key }] })),
  { id: "perspective", keys: "P", label: "Perspective / orthographic", probes: [{ key: "p" }, { key: "P" }] },
  { id: "fit", keys: "F", label: "Fit the whole cloud", probes: [{ key: "f" }, { key: "F" }] },
  { id: "fit-selection", keys: "Alt+F", label: "Fit the camera to the current candidate", probes: [{ key: "f", altKey: true }, { key: "F", altKey: true }] },
  { id: "hold-original", keys: "O (hold)", label: "Show the original cloud while held", probes: [{ key: "o" }, { key: "O" }] },
  { id: "rect", keys: "R (hold)", label: "Rectangle select in a face view while held", probes: [{ key: "r" }, { key: "R" }] },
  { id: "slice-prev", keys: "[", label: "Move the slice slab down", probes: [{ key: "[" }] },
  { id: "slice-next", keys: "]", label: "Move the slice slab up", probes: [{ key: "]" }] },
  { id: "polygon-close", keys: "Enter", label: "Close the polygon being drawn", probes: [{ key: "Enter" }] },
  { id: "cancel", keys: "Esc", label: "Leave pick mode, cancel polygon drawing, close help", probes: [{ key: "Escape" }] },
  { id: "apply", keys: "Delete", label: "Apply: delete the previewed points (same as the Apply button)", probes: [{ key: "Delete" }] },
  { id: "undo", keys: "Ctrl+Z", label: "Undo the last deletion", probes: [{ key: "z", ctrlKey: true }, { key: "Z", metaKey: true }] },
  { id: "redo", keys: "Ctrl+Y", label: "Redo (also Ctrl+Shift+Z)", probes: [{ key: "y", ctrlKey: true }, { key: "Z", ctrlKey: true, shiftKey: true }] },
  { id: "help", keys: "?", label: "Show or hide this help", probes: [{ key: "?" }, { key: "?", shiftKey: true }] },
];

const TYPING = ["INPUT", "TEXTAREA", "SELECT"];

/** Which documented key a keydown is, or null. Typing in a field only lets Escape through. */
export function classifyKey(e: KeyEvent): KeyId | null {
  if (TYPING.includes(e.target)) return e.key === "Escape" ? "cancel" : null;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === "z") return e.shiftKey ? "redo" : "undo";
    return k === "y" ? "redo" : null;
  }
  if (e.altKey) return k === "f" ? "fit-selection" : null;
  const view = VIEW_KEYS.findIndex((b) => b.key === e.key);
  if (view >= 0) return `view-${view + 1}` as KeyId;
  switch (k) {
    case "p": return "perspective";
    case "f": return "fit";
    case "o": return "hold-original";
    case "r": return "rect";
    case "[": return "slice-prev";
    case "]": return "slice-next";
    case "enter": return "polygon-close";
    case "escape": return "cancel";
    case "delete": return "apply";
    case "?": return "help";
    default: return null;
  }
}

/** Whether the help overlay is open after a key: ? toggles, Escape closes, everything else leaves it. */
export function helpOpenAfter(open: boolean, id: KeyId | null): boolean {
  if (id === "help") return !open;
  if (id === "cancel") return false;
  return open;
}

export const MOUSE_DOCS: { keys: string; label: string }[] = [
  { keys: "Left-drag", label: "Orbit about the pivot (a tool handle or rectangle drag when one is active)" },
  { keys: "Middle/right-drag, Shift+left-drag", label: "Pan" },
  { keys: "Wheel", label: "Zoom" },
  { keys: "Click a ViewCube face", label: "Look along that axis; edges and corners look diagonally" },
  { keys: "Drag a filter box grip", label: "Set that side of the display filter along the view; Shift is finer, Esc cancels the drag" },
  { keys: "Arrow keys on a focused grip", label: "Nudge the filter value (Shift finer, PageUp/PageDown ten steps, Home/End the cloud bounds)" },
];
