"""Run one plane or thin call in a fresh process: seconds and RSS growth, under RLIMIT_AS (PLN-14/15, THN-13/14).

Parent: `run_case(kind, n)`. Child: this file run as a script (imports the code under test). The child resets the
kernel's peak-RSS counter after building the fixture, so the growth is the call's own.
"""

import json
import os
import subprocess
import sys
import time

LIMIT_AS = 3 * 1024**3
KINDS = ("detect", "plane", "dup", "voxel", "dupblob")


def run_case(kind, n, *, timeout=120):
    assert kind in KINDS
    env = dict(os.environ, PYTHONPATH=os.pathsep.join(p for p in sys.path if p))
    try:
        proc = subprocess.run(
            [
                sys.executable,
                os.path.abspath(__file__),
                json.dumps({"kind": kind, "n": n}),
            ],
            check=False,
            capture_output=True,
            text=True,
            env=env,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "stderr": f"timed out after {timeout}s"}
    if proc.returncode != 0:
        return {"ok": False, "stderr": proc.stderr[-2000:]}
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    out["ok"] = True
    return out


def _status_mib(key):
    with open("/proc/self/status") as f:
        for line in f:
            if line.startswith(key):
                return int(line.split()[1]) / 1024
    raise KeyError(key)


def _child(args):
    import resource

    import numpy as np

    resource.setrlimit(resource.RLIMIT_AS, (LIMIT_AS, LIMIT_AS))
    from fixtures.pcdgen import plane_room_rows, room_rows

    kind, n = args["kind"], args["n"]
    if kind in ("detect", "plane"):
        xyz, _ = plane_room_rows(n, 11)
    elif kind == "dupblob":  # 5 percent identical rows, the rest on a 1 cm grid
        side = int(np.ceil((n - n // 20) ** (1 / 3)))
        g = np.stack(np.meshgrid(*[np.arange(side)] * 3, indexing="ij"), -1)
        grid = g.reshape(-1, 3)[: n - n // 20] * 0.01
        xyz = np.vstack([np.full((n // 20, 3), 5.0), grid])
    else:  # half the rows are exact copies of the other half
        base, _ = room_rows(n // 2, 7)
        xyz = np.vstack([base, base])
    xyz = np.ascontiguousarray(xyz)
    eligible = np.ones(len(xyz), dtype=bool)
    extra = {}
    with open("/proc/self/clear_refs", "w") as f:
        f.write("5")  # reset VmHWM to the current RSS
    base_mib = _status_mib("VmRSS")
    t0 = time.perf_counter()
    if kind == "detect":
        from gr_pcd.editing.planes import PlaneDetectSpec, detect_planes

        res = len(detect_planes(xyz, eligible, PlaneDetectSpec()))
    elif kind == "plane":
        from gr_pcd.editing.planes import PlaneSpec, plane_mask

        res = int(
            (
                plane_mask(xyz, PlaneSpec((0.0, 0.0, 1.0), 0.0, 0.03))
                & eligible
            ).sum()
        )
    elif kind == "dupblob":
        from scipy.spatial import cKDTree

        from gr_pcd.editing.thin import duplicate_mask

        tree = cKDTree(xyz)
        pairs = int(tree.count_neighbors(tree, 1e-3 * (1 + 1e-12)))
        del tree
        budget = int(1.05 * pairs * 16)
        with open("/proc/self/clear_refs", "w") as f:
            f.write("5")
        base_mib = _status_mib("VmRSS")
        try:
            res = int(duplicate_mask(xyz, eligible, 1e-3, budget=budget).sum())
            code = None
        except Exception as exc:  # noqa: BLE001
            res, code = -1, getattr(exc, "code", type(exc).__name__)
        extra["budget_mib"] = budget / 1024**2
        extra["code"] = code
    elif kind == "dup":
        from gr_pcd.editing.thin import duplicate_mask

        res = int(duplicate_mask(xyz, eligible, 1e-3).sum())
    else:
        from gr_pcd.editing.thin import voxel_mask

        res = int(voxel_mask(xyz, eligible, 0.05).sum())
    seconds = time.perf_counter() - t0
    peak = _status_mib("VmHWM")
    print(
        json.dumps(
            {
                "kind": kind,
                "n": len(xyz),
                "seconds": seconds,
                "base_mib": base_mib,
                "peak_mib": peak,
                "growth_mib": peak - base_mib,
                "result": res,
                **extra,
            }
        )
    )
    sys.stdout.flush()


if __name__ == "__main__":
    _child(json.loads(sys.argv[1]))
