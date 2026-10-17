import type { ParamsKind } from "./runner";

/** One hook for every server-side parameter change: re-run the preview, then redraw the canvas. */
export function createParamsHook(
  runner: { paramsChanged(kind: ParamsKind): void },
  refresh: () => unknown,
): (kind: ParamsKind) => void {
  return (kind) => {
    runner.paramsChanged(kind);
    void refresh();
  };
}
