import type { AppState } from "../state/app";
import type { ToolKind } from "../state/types";
import { emptyPolygon } from "../tools/polygon/model";

/** Arming a tool (or pressing the armed one again to disarm): Cluster waits for its seed click at once; any change drops the old seed. */
export function armTool(st: AppState, t: ToolKind): AppState {
  return {
    ...st,
    tool: t,
    interaction: t === "cluster" ? "pick-seed" : "orbit",
    liveFirst: (st.session?.selection.count ?? 0) === 0,
    tools: { ...st.tools, cluster: { ...st.tools.cluster, seed: null } },
  };
}

/** Clear selection also disarms the tool: no armed button, no seed, no polygon, orbit works again; the next shape is a first selection. */
export function disarmed(st: AppState): AppState {
  return {
    ...st,
    tool: "none",
    interaction: "orbit",
    liveFirst: true,
    tools: { ...st.tools, polygon: emptyPolygon(), cluster: { ...st.tools.cluster, seed: null } },
  };
}
