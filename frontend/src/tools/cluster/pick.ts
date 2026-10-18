import type { AppState } from "../../state/app";

/**
 * The Pick point toggle of the Cluster tool. `waiting`: armed, the next click on the cloud is the seed. `set`: a seed
 * is chosen (its cluster is selected or previewed). `paused`: the tool is armed but pick mode was left (Esc).
 */
export type PickState = "waiting" | "set" | "paused";

export function clusterPickState(s: Pick<AppState, "interaction" | "tools">): PickState {
  if (s.tools.cluster.seed) return "set";
  return s.interaction === "pick-seed" ? "waiting" : "paused";
}

/** What pressing the toggle does: waiting stays waiting; set clears the seed and waits; paused waits. */
export function pressPick(s: Pick<AppState, "interaction" | "tools">): Pick<AppState, "interaction" | "tools"> {
  return { interaction: "pick-seed", tools: { ...s.tools, cluster: { ...s.tools.cluster, seed: null } } };
}

/** Text under the toggle for each state. */
export function pickText(s: Pick<AppState, "interaction" | "tools">): string {
  const st = clusterPickState(s);
  const seed = s.tools.cluster.seed;
  if (st === "set" && seed) return `Seed: point ${seed.id} at ${seed.point.map((v) => String(Math.round(v * 1e6) / 1e6)).join(", ")}. Press Pick point to choose another.`;
  if (st === "waiting") return "Waiting: click a point of the cloud to seed the cluster";
  return "Paused: press Pick point, then click a point";
}
