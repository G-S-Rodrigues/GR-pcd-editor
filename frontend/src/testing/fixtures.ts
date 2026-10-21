import type { Candidate, SessionState } from "../state/types";

/** A real-shaped session state for unit tests (counts and revisions are the usual knobs). */
export const sessionFixture = (over: Partial<SessionState> = {}): SessionState =>
  ({
    session_id: "s1",
    filename: "a.pcd",
    encoding: "binary",
    schema: [],
    width: 1000,
    height: 1,
    viewpoint: [0, 0, 0, 1, 0, 0, 0],
    unit: "m",
    unsaved: false,
    revision: { cloud: 3, params: 4 },
    counts: { original: 1000, active: 900, deleted: 100, invalid_total: 0, invalid_active: 0, displayed: 800, selected: 0, protected: 0, main: 0, hidden: 0 },
    layers: [],
    bounds: { min: [0, 0, 0], max: [10, 10, 10] },
    active_bounds: { min: [0, 0, 0], max: [10, 10, 10] },
    display_filter: {
      x: { enabled: false, min: 0, max: 0 },
      y: { enabled: false, min: 0, max: 0 },
      z: { enabled: false, min: 0, max: 0 },
    },
    protection: {
      global: { enabled: false, min: 0, max: 0 },
      operation: { mode: "inherit", local: null, acknowledge_override: false },
    },
    selection: { count: 0, ops: [] },
    history: { entries: [], cursor: 0, can_undo: false, can_redo: false },
    client_state: {},
    ...over,
  }) as SessionState;

export const candidateFixture = (over: Partial<Candidate> = {}): Candidate => ({
  candidate_id: "c1",
  cloud_revision: 3,
  params_revision: 4,
  selected_active: 50,
  protected_retained: 0,
  candidates: 50,
  selected_outside_display_filter: 0,
  bounds: null,
  effective_protection: { mode: "inherit", intervals: [] },
  cluster: null,
  ...over,
});
