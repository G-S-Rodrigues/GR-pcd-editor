import type { AppState } from "../state/app";
import type { RenderTheme } from "../colour/palette";
import type { Store } from "../state/store";

/** Keeps the renderer's clear colour on the theme's `--canvas`: the pure seam, so vitest (no DOM, no WebGL) can drive it. */
export interface CanvasTokenFollower {
  /** The current `--canvas` value, as the stylesheet declares it (may carry whitespace). */
  read: () => string;
  /** Registers the callback that fires when the theme may have changed (the colour-scheme media query, the `data-theme` attribute); returns its unsubscribe. */
  subscribe: (onChange: () => void) => () => void;
  /** Applies a colour to the renderer and asks for a redraw. */
  apply: (colour: string) => void;
}

/** Applies the token once, again on every theme change, and returns the unsubscribe. */
export function followCanvasToken(f: CanvasTokenFollower): () => void {
  const sync = () => f.apply(f.read().trim());
  sync();
  return f.subscribe(sync);
}

/** The render theme for a computed `color-scheme` value; anything but `light` is dark (the app's default). */
export const renderThemeOf = (scheme: string): RenderTheme => (scheme.trim() === "light" ? "light" : "dark");

/** An `apply` for `followCanvasToken` that puts the page's colour scheme in the store as `renderTheme`; a same-theme call changes nothing, so it notifies nobody. */
export const applyRenderTheme = (store: Store<AppState>) => (scheme: string): void => {
  const theme = renderThemeOf(scheme);
  if (store.get().renderTheme !== theme) store.set({ renderTheme: theme });
};
