export interface ClearPolygonDeps {
  emptyPolygon(): void;
  /** True while the selection on screen came from the polygon tool. */
  polygonSelected(): boolean;
  resetRunner(): void;
  clearSelection(): void;
}

/** Clearing the polygon also clears the highlight and counts it produced, so no stale Selected remains. */
export function createClearPolygon(d: ClearPolygonDeps): () => void {
  return () => {
    const selected = d.polygonSelected();
    d.emptyPolygon();
    d.resetRunner();
    if (selected) d.clearSelection();
  };
}
