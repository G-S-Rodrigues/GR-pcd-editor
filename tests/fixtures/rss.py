"""Run one cluster call in a fresh process: seconds, peak RSS, optional RLIMIT_AS.

Parent side: `run_cluster(...)`. Child side: this file run as a script. No
production code is imported by the parent; the child imports the engine under test.
"""

import json
import os
import resource
import subprocess
import sys
import time

MIB = 1024 * 1024


def run_cluster(
    n,
    radius,
    *,
    seed=7,
    limit_as=3 * 1024**3,
    cancel_after=None,
    scene_seed=7,
    timeout=600,
):
    args = {
        "n": n,
        "radius": radius,
        "seed": scene_seed,
        "limit_as": limit_as,
        "cancel_after": cancel_after,
    }
    env = dict(os.environ, PYTHONPATH=os.pathsep.join(p for p in sys.path if p))
    proc = subprocess.run(
        [sys.executable, os.path.abspath(__file__), json.dumps(args)],
        check=False,
        capture_output=True,
        text=True,
        env=env,
        timeout=timeout,
    )
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024
    if proc.returncode != 0:
        return {"ok": False, "stderr": proc.stderr[-2000:], "rss_mib": rss}
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    out["ok"] = True
    out["rss_mib"] = out["peak_rss_mib"]
    return out


def _child(args):
    import threading

    import numpy as np

    if args["limit_as"]:
        resource.setrlimit(
            resource.RLIMIT_AS, (args["limit_as"], args["limit_as"])
        )
    from fixtures.pcdgen import ROOM_GHOST, room_rows
    from gr_pcd.editing.cancel import Cancelled, CancelToken
    from gr_pcd.editing.cluster import connected_component

    xyz, lab = room_rows(args["n"], args["seed"])
    seed_id = int(np.flatnonzero(lab == ROOM_GHOST)[0])
    eligible = np.ones(len(xyz), dtype=bool)
    token = CancelToken()
    t0 = time.perf_counter()
    cancelled_at = None
    if args["cancel_after"] is not None:
        threading.Timer(args["cancel_after"], token.cancel).start()
    result = {"cancel_latency": None, "size": None}
    try:
        res = connected_component(
            xyz,
            eligible,
            seed_id,
            args["radius"],
            token=token,
            on_limit="partial",
        )
        result["size"] = len(res.ids)
    except Cancelled:
        cancelled_at = time.perf_counter() - t0
        result["cancel_latency"] = cancelled_at - args["cancel_after"]
    result["seconds"] = time.perf_counter() - t0
    result["peak_rss_mib"] = (
        resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    )
    print(json.dumps(result))
    sys.stdout.flush()
    os._exit(0)  # a Timer thread may still be alive


if __name__ == "__main__":
    _child(json.loads(sys.argv[1]))
