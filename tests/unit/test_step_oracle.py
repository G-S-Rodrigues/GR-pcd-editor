"""HST-31: the step oracle on its own (part 19, 19-1).

Random sequences of deletions and layer edits with undo, redo, rollback and
delete-step run on the plain-set oracle alone. This proves, before any engine
code, that ordered flips plus the delete rule (plan 3.4) are sound: every
allowed delete is followed by a replay of the remaining applied steps from the
initial state that must give the same per-point layers and row ids. Row order
is deliberately not compared (amendment 2).
"""

import random

from fixtures.step_oracle import MAX_LAYERS, StepOracle

SEQUENCES = 300
OPS = 40


def run(seed: int, ops: int = OPS) -> StepOracle:
    rng = random.Random(seed)
    n = rng.randrange(20, 80)
    o = StepOracle(n)
    for step in range(ops):
        act = sorted(o.active())
        pick = (
            set(rng.sample(act, rng.randrange(0, len(act) + 1)))
            if act
            else set()
        )
        rows = sorted(o.row_ids())
        op = rng.choice(
            ["apply", "create", "create", "floor", "assign", "release",
             "members", "merge", "to_main", "patch", "undo", "undo", "redo",
             "rollback", "delete", "delete", "rename"]
        )  # fmt: skip
        if op == "apply" and pick:
            o.apply(pick)
        elif op in ("create", "floor") and pick and len(rows) < MAX_LAYERS:
            o.create(pick, f"L{seed}-{step}", True, protected=op == "floor")
        elif op == "assign" and pick and rows:
            o.assign(pick, rng.choice(rows))
        elif op == "release" and pick:
            o.assign(pick, 0)
        elif op == "members" and pick and rows:
            o.set_members(rng.choice(rows), pick)
        elif op == "merge" and len(rows) >= 2:
            a, b = rng.sample(rows, 2)
            o.merge(a, b)
        elif op == "to_main" and rows:
            o.to_main(rng.choice(rows))
        elif op == "patch" and rows:
            o.patch(rng.choice(rows), name=f"renamed{step}")
        elif op == "undo" and o.cursor:
            o.undo()
        elif op == "redo" and o.cursor < len(o.steps):
            o.redo()
        elif op == "rollback":
            o.rollback(rng.randrange(0, len(o.steps) + 1))
        elif op == "delete" and o.steps:
            o.delete_step(rng.choice(o.steps).sid)
        o.assert_replay_matches()
    return o


def test_hst_31_oracle_replay_is_sound():
    totals = {"layer_undone": 0, "delete_refused": 0}
    for seed in range(SEQUENCES):
        o = run(seed)
        for key in totals:
            totals[key] += o.stats[key]
    assert totals["layer_undone"] > 3 and totals["delete_refused"] > 3
