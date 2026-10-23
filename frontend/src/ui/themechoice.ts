export type ThemeChoice = "system" | "light" | "dark";

/** The per-browser key; the choice is not a document property, so it never enters the session archive. */
export const THEME_KEY = "gr-pcd-editor.theme";

interface ReadStore {
  getItem(k: string): string | null;
}
interface WriteStore {
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Light or dark only when the stored value says exactly that; anything else, or a store that throws, follows the OS. */
export function readTheme(storage: ReadStore): ThemeChoice {
  try {
    const v = storage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function writeTheme(storage: WriteStore, c: ThemeChoice): void {
  try {
    if (c === "system") storage.removeItem(THEME_KEY);
    else storage.setItem(THEME_KEY, c);
  } catch {
    // a blocked store keeps the choice for this page only
  }
}

/** Light or dark pins `<html data-theme>`; system removes it so the OS preference decides. */
export function applyTheme(el: { setAttribute(k: string, v: string): void; removeAttribute(k: string): void }, c: ThemeChoice): void {
  if (c === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", c);
}
