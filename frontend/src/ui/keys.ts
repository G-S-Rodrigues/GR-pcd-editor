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
  | "perspective" | "fit" | "fit-selection" | "rect"
  | "polygon-close" | "polygon-remove-vertex" | "cancel" | "apply"
  | "undo" | "redo" | "help" | "box-nudge" | "box-grow" | "box-turn";

export interface KeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** tagName of the event target. */
  target: string;
  /** The Box tool is armed in the edited view: only then do the box keys mean anything. */
  boxTool?: boolean;
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
  { id: "rect", keys: "R (hold)", label: "Rectangle select in a face view while held", probes: [{ key: "r" }, { key: "R" }] },
  { id: "polygon-close", keys: "Enter", label: "Close the polygon being drawn, or leave polygon edit mode", probes: [{ key: "Enter" }] },
  { id: "polygon-remove-vertex", keys: "Backspace", label: "Remove the polygon vertex under the pointer while the polygon pencil (edit mode) is on", probes: [{ key: "Backspace" }] },
  { id: "cancel", keys: "Esc", label: "Leave pick mode, cancel polygon drawing, leave polygon edit mode, close help, discard a pending draft; with none of these, disarm the armed tool", probes: [{ key: "Escape" }] },
  { id: "apply", keys: "Delete", label: "Apply: delete the previewed points (same as the Apply button)", probes: [{ key: "Delete" }] },
  { id: "undo", keys: "Ctrl+Z", label: "Undo the last step", probes: [{ key: "z", ctrlKey: true }, { key: "Z", metaKey: true }] },
  { id: "redo", keys: "Ctrl+Y", label: "Redo (also Ctrl+Shift+Z)", probes: [{ key: "y", ctrlKey: true }, { key: "Z", ctrlKey: true, shiftKey: true }] },
  { id: "box-nudge", keys: "Arrow keys, PageUp/PageDown", label: "Box tool: move the box by Step along the axes nearest the screen (Shift a tenth)", probes: [{ key: "ArrowLeft", boxTool: true }, { key: "PageUp", boxTool: true }, { key: "ArrowUp", shiftKey: true, boxTool: true }] },
  { id: "box-grow", keys: "Alt+Arrow keys", label: "Box tool: grow (Right, Up) or shrink (Left, Down) both faces of the box axis nearest that direction by Step", probes: [{ key: "ArrowRight", altKey: true, boxTool: true }] },
  { id: "box-turn", keys: ". and ,", label: "Box tool: turn the box by Angle step about its Z axis (Shift: the axis nearest screen-right; Ctrl+Shift: the view axis)", probes: [{ key: ".", boxTool: true }, { key: ",", boxTool: true }, { key: ">", shiftKey: true, boxTool: true }, { key: ".", ctrlKey: true, shiftKey: true, boxTool: true }] },
  { id: "help", keys: "?", label: "Show or hide this help", probes: [{ key: "?" }, { key: "?", shiftKey: true }] },
];

const TYPING = ["INPUT", "TEXTAREA", "SELECT"];
const NON_TEXT_INPUTS = ["checkbox", "radio", "range", "button", "submit", "reset", "color", "file", "image"];

/** Escape typed in a text entry (text-like INPUT, TEXTAREA, SELECT) belongs to the field; on a checkbox, slider or button it does not (22-1, R22-1). */
export function escapeInField(tag: string, type = ""): boolean {
  if (tag === "INPUT") return !NON_TEXT_INPUTS.includes(type.toLowerCase());
  return tag === "TEXTAREA" || tag === "SELECT";
}

/** Which documented key a keydown is, or null. Typing in a field only lets Escape through. */
export function classifyKey(e: KeyEvent): KeyId | null {
  if (TYPING.includes(e.target)) return e.key === "Escape" ? "cancel" : null;
  const k = e.key.toLowerCase();
  if (e.boxTool && (e.target === "BODY" || e.target === "CANVAS")) {
    const arrow = k.startsWith("arrow");
    if (!e.metaKey && !e.ctrlKey && (arrow || k === "pageup" || k === "pagedown")) {
      return e.altKey ? (arrow ? "box-grow" : null) : "box-nudge";
    }
    if (!e.metaKey && !e.altKey && [".", ",", ">", "<"].includes(e.key) && (!e.ctrlKey || e.shiftKey)) return "box-turn";
  }
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
    case "r": return "rect";
    case "enter": return "polygon-close";
    case "backspace": return "polygon-remove-vertex";
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
  { keys: "Drag a filter box grip, or the arrow on its plane", label: "Set that side of the display filter along the view; Shift is finer, Esc cancels the drag" },
  { keys: "Drag a protection arrow, or the band's edge", label: "Move that side of the protected slab along its normal; Esc cancels the drag" },
  { keys: "Drag a blue ring around the slab", label: "Tilt the protected slab (X ring and Y ring, limit 60 degrees); the Level button resets it" },
  { keys: "Click a timeline step icon", label: "Highlight the points that step deleted or moved (click again, the strip background or Esc clears; hover previews)" },
  { keys: "Drag the timeline marker", label: "Roll the history back or forward to that point (one step per cursor slot); the button Roll back to here and the Left/Right/Home/End keys do the same" },
  { keys: "Double-click a step name", label: "Rename the step (also the pencil button or F2); Delete or Backspace on a focused step removes it after a confirmation" },
  { keys: "Arrow keys on a focused grip", label: "Nudge the filter value (Shift finer, PageUp/PageDown ten steps, Home/End the cloud bounds)" },
];
