"""Run the sparse-point filter on a generated room in a fresh process: seconds and RSS growth (SPR-10).

Parent: `run_sparse(n)`. Child: this file run as a script (imports the code under test).
"""

import json
import os
import resource
import subprocess
import sys
import time


def run_sparse(n, *, timeout=120):
    env = dict(os.environ, PYTHONPATH=os.pathsep.join(p for p in sys.path if p))
    proc = subprocess.run(
        [sys.executable, os.path.abspath(__file__), json.dumps({"n": n})],
        check=False,
        capture_output=True,
        text=True,
        env=env,
        timeout=timeout,
    )
    if proc.returncode != 0:
        return {"ok": False, "stderr": proc.stderr[-2000:]}
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    out["ok"] = True
    return out


def _child(args):
    import numpy as np

    from fixtures.pcdgen import room_rows
    from gr_pcd.editing.sparse import (
        DEFAULT_MIN_NEIGHBOURS,
        auto_radius,
        sparse_mask,
    )

    xyz, _ = room_rows(args["n"], 7)
    xyz = np.ascontiguousarray(xyz)
    base = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    t0 = time.perf_counter()
    counted = np.ones(len(xyz), dtype=bool)
    radius = auto_radius(xyz)
    mask = sparse_mask(xyz, counted, radius, DEFAULT_MIN_NEIGHBOURS)
    seconds = time.perf_counter() - t0
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print(
        json.dumps(
            {
                "seconds": seconds,
                "base_mib": base,
                "peak_mib": peak,
                "growth_mib": peak - base,
                "n": len(mask),
                "radius": radius,
                "selected": int(mask.sum()),
            }
        )
    )
    sys.stdout.flush()


if __name__ == "__main__":
    _child(json.loads(sys.argv[1]))
