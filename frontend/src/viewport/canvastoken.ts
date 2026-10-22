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
