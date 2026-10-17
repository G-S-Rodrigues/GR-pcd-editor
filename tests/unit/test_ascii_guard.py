"""PCD-60/61: the ASCII import is refused by an estimate, before it is parsed."""

import json
import os
import subprocess
import sys
import tracemalloc

import numpy as np
import pytest

from fixtures.pcdgen import build_pcd, xyz_fields
from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.header import parse_header
from gr_pcd.pcd.reader import read_pcd
from gr_pcd.session import budget


def _rows(n, seed=1):
    rng = np.random.default_rng(seed)
    return [tuple(float(v) for v in r) for r in rng.random((n, 3)) * 100]


def test_pcd_60_ascii_over_budget_is_refused_before_parsing(tmp_path):
    n = 200_000
    data = build_pcd(xyz_fields(4), _rows(n), "ascii")
    path = tmp_path / "a.pcd"
    path.write_bytes(data)
    header = parse_header(data[:4096])
    # the binary estimate fits; the ASCII expansion does not
    tight = budget.estimate_bytes(header) * 2
    assert tight > budget.estimate_bytes(header)
    tracemalloc.start()
    try:
        with pytest.raises(PcdError) as ei:
            read_pcd(path, budget=tight)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert ei.value.code == "memory_budget_exceeded"
    # the tokens alone would be several times the payload (the hash read buffer
    # of at most 8 MiB is all that was allocated)
    assert peak < 2 * len(data), (peak, len(data))
    # the same file with a generous budget still reads
    ok = read_pcd(path, budget=budget.ASCII_EXPANSION * len(data) * 4)
    assert ok.n == n


_CHILD = """
import json, os, resource, sys
from pathlib import Path
def rss():
    with open('/proc/self/statm') as f:
        return int(f.read().split()[1]) * os.sysconf('SC_PAGE_SIZE')
from gr_pcd.pcd.reader import read_pcd
from gr_pcd.pcd.header import parse_header
from gr_pcd.session import budget
p = Path(sys.argv[1])
head = p.read_bytes()[:4096]
est = budget.estimate_bytes(parse_header(head)) + budget.ASCII_EXPANSION * p.stat().st_size
base = rss()
cloud = read_pcd(p)
peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
print(json.dumps({'peak_over_base': peak - base, 'estimate': est, 'n': cloud.n}))
"""


def test_pcd_61_estimate_covers_the_measured_peak_of_a_1m_point_read(tmp_path):
    n = 1_000_000
    path = tmp_path / "big.pcd"
    path.write_bytes(build_pcd(xyz_fields(4), _rows(n), "ascii"))
    env = dict(os.environ, PYTHONPATH=os.pathsep.join(p for p in sys.path if p))
    proc = subprocess.run(
        [sys.executable, "-c", _CHILD, str(path)],
        capture_output=True,
        text=True,
        env=env,
        timeout=300,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert out["n"] == n
    assert out["peak_over_base"] <= out["estimate"], out
