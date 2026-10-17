"""Memory guard: estimates are made from the header, before allocating."""

import errno
import os
import shutil
import time
from collections.abc import Callable

from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.header import PcdHeader

# per-point extras: xyz64 (24) + valid + active + selection + 3 scratch masks
PER_POINT_EXTRA = 24 + 1 + 1 + 1 + 3
# measured 7c-1: ~120 B/point of engine arrays (pts, cell ids, keys, inverse,
# order, sorted copy, unique temps); 993k peaked at 177 MiB in all
CLUSTER_BYTES_PER_POINT = 128
HISTORY_FRACTION = 0.25
DEFAULT_FALLBACK = 4 * 1024**3
# ASCII parse: the payload, one bytes object per token, the string table and
# the float copy, as a multiple of the payload size (calibrated by PCD-61)
ASCII_EXPANSION = 10


def estimate_bytes(header: PcdHeader) -> int:
    n = header.points
    total = n * (header.itemsize + PER_POINT_EXTRA)
    if header.encoding == "binary_compressed":
        total += n * header.itemsize
    return total


MEMINFO = "/proc/meminfo"
CGROUP_V2_LIMIT = "/sys/fs/cgroup/memory.max"
CGROUP_V1_LIMIT = "/sys/fs/cgroup/memory/memory.limit_in_bytes"
STATM = "/proc/self/statm"
BUDGET_FRACTION = 0.6
GUARD_FRACTION = 0.85
GUARD_INTERVAL_S = 0.1
_NO_LIMIT = 1 << 60  # cgroup v1 reports a huge number for "unlimited"


def memory_limit_bytes() -> int | None:
    """The container memory limit (cgroup v2, then v1); None when unlimited."""
    for path in (CGROUP_V2_LIMIT, CGROUP_V1_LIMIT):
        try:
            with open(path) as fh:
                raw = fh.read().strip()
        except OSError:
            continue
        if raw.isdigit() and int(raw) < _NO_LIMIT:
            return int(raw)
    return None


def _mem_available() -> int | None:
    try:
        with open(MEMINFO) as fh:
            for line in fh:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
    except OSError:
        pass
    return None


def default_budget() -> int:
    env = os.environ.get("GR_PCD_MEMORY_BUDGET_BYTES")
    if env:
        return int(env)
    avail = _mem_available()
    limit = memory_limit_bytes()
    known = [v for v in (avail, limit) if v is not None]
    if not known:
        return DEFAULT_FALLBACK
    return int(min(known) * BUDGET_FRACTION)


def rss_bytes() -> int:
    """Resident set size of this process."""
    with open(STATM) as fh:
        return int(fh.read().split()[1]) * os.sysconf("SC_PAGE_SIZE")


def make_rss_guard() -> Callable[[], None]:
    """A watchdog for a job's cancel token: raises when this process nears the
    container limit, so the job fails instead of the process being OOM-killed.
    Throttled; reads `rss_bytes`/`memory_limit_bytes` at call time."""
    state = {"next": 0.0}

    def guard() -> None:
        now = time.monotonic()
        if now < state["next"]:
            return
        state["next"] = now + GUARD_INTERVAL_S
        limit = memory_limit_bytes()
        if limit is None:
            return
        used = rss_bytes()
        if used > GUARD_FRACTION * limit:
            raise PcdError(
                "memory_guard",
                f"the server is close to its memory limit ({used >> 20} MiB "
                f"of {limit >> 20} MiB); the operation was stopped to keep "
                "your session alive. Try a smaller region or a larger radius.",
            )

    return guard


def check_budget(estimate: int, budget: int, what: str = "import") -> None:
    if estimate > budget:
        raise PcdError(
            "memory_budget_exceeded",
            f"{what} needs about {estimate} bytes, budget is {budget} bytes",
        )


def ensure_free_space(directory, need: int) -> None:
    """Refuse (ENOSPC, mapped to storage_full) before writing `need` bytes."""
    if shutil.disk_usage(directory).free < need:
        raise OSError(errno.ENOSPC, "not enough free space")
