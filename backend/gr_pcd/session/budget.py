"""Memory guard: estimates are made from the header, before allocating."""

import os

from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.header import PcdHeader

# per-point extras: xyz64 (24) + valid + active + selection + 3 scratch masks
PER_POINT_EXTRA = 24 + 1 + 1 + 1 + 3
CLUSTER_BYTES_PER_POINT = 40
HISTORY_BYTES_PER_ID = 4
HISTORY_FRACTION = 0.25
DEFAULT_FALLBACK = 4 * 1024**3


def estimate_bytes(header: PcdHeader) -> int:
    n = header.points
    total = n * (header.itemsize + PER_POINT_EXTRA)
    if header.encoding == "binary_compressed":
        total += n * header.itemsize
    return total


def default_budget() -> int:
    env = os.environ.get("GR_PCD_MEMORY_BUDGET_BYTES")
    if env:
        return int(env)
    try:
        with open("/proc/meminfo") as fh:
            for line in fh:
                if line.startswith("MemAvailable:"):
                    return int(int(line.split()[1]) * 1024 * 0.6)
    except OSError:
        pass
    return DEFAULT_FALLBACK


def check_budget(estimate: int, budget: int, what: str = "import") -> None:
    if estimate > budget:
        raise PcdError(
            "memory_budget_exceeded",
            f"{what} needs about {estimate} bytes, budget is {budget} bytes",
        )
