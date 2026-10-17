"""In-memory job manager: one worker, cooperative cancellation."""

import errno
import logging
import threading
import time
import uuid
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from gr_pcd.editing.cancel import Cancelled, CancelToken
from gr_pcd.editing.cluster import ComponentLimitReached
from gr_pcd.editing.errors import EditError
from gr_pcd.geometry.errors import GeometryError
from gr_pcd.pcd.errors import PcdError
from gr_pcd.session.budget import make_rss_guard

log = logging.getLogger(__name__)

MAX_JOBS = 200
SUPERSEDED = ("select", "candidate")
JOB_ORPHAN_S = 20.0
SWEEP_TICK_S = 1.0


class Stale(Exception):
    """The job's revision ticket is obsolete; nothing was mutated."""


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"
    progress: float = 0.0
    message: str = ""
    result: dict | None = None
    error: dict | None = None
    token: CancelToken = field(default_factory=CancelToken)
    last_seen: float = 0.0

    def to_dict(self) -> dict:
        out = {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "complete": self.status == "complete",
        }
        if self.status == "complete":
            out["result"] = self.result
        if self.status == "failed":
            out["error"] = self.error
        return out


class JobContext:
    def __init__(self, job: Job) -> None:
        self.job = job
        self.token = job.token

    def progress(self, fraction: float, message: str = "") -> None:
        self.job.progress = max(0.0, min(1.0, fraction))
        if message:
            self.job.message = message


_DONE = ("complete", "cancelled", "stale", "failed")


class JobManager:
    def __init__(
        self,
        orphan_s: float = JOB_ORPHAN_S,
        clock: Callable[[], float] = time.monotonic,
        sweep: bool = True,
    ) -> None:
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="job")
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._lock = threading.Lock()
        self._orphan_s = orphan_s
        self._clock = clock
        self._stop = threading.Event()
        if sweep:
            threading.Thread(
                target=self._sweeper, name="job-sweeper", daemon=True
            ).start()

    def _sweeper(self) -> None:
        while not self._stop.wait(SWEEP_TICK_S):
            self.sweep()

    def sweep(self) -> None:
        """Cancel select/candidate jobs whose client stopped polling."""
        now = self._clock()
        for job in list(self._jobs.values()):
            if (
                job.kind in SUPERSEDED
                and job.status in ("queued", "running")
                and now - job.last_seen > self._orphan_s
            ):
                self.cancel(job.id)

    def submit(self, kind: str, fn: Callable[[JobContext], dict]) -> Job:
        job = Job(id=uuid.uuid4().hex, kind=kind, last_seen=self._clock())
        with self._lock:
            self._jobs[job.id] = job
            while len(self._jobs) > MAX_JOBS:
                oldest = next(iter(self._jobs))
                if self._jobs[oldest].status not in _DONE:
                    break
                self._jobs.pop(oldest)
        self._pool.submit(self._run, job, fn)
        return job

    def _run(self, job: Job, fn: Callable[[JobContext], dict]) -> None:
        if job.token.cancelled:
            job.status = "cancelled"
            return
        job.status = "running"
        job.token.guard = make_rss_guard()
        try:
            job.result = fn(JobContext(job))
            job.progress = 1.0
            job.status = "complete"
        except Cancelled:
            job.status = "cancelled"
        except Stale:
            job.status = "stale"
        except ComponentLimitReached as exc:
            job.error = {
                "code": "component_limit_reached",
                "message": str(exc),
                "partial_count": exc.partial_count,
            }
            job.status = "failed"
        except (PcdError, EditError, GeometryError) as exc:
            job.error = {"code": exc.code, "message": exc.message}
            job.status = "failed"
        except OSError as exc:
            if exc.errno == errno.ENOSPC:
                job.error = {
                    "code": "storage_full",
                    "message": "the work volume has no space left",
                }
            else:
                log.exception("job %s (%s) failed", job.id, job.kind)
                job.error = {
                    "code": "internal_error",
                    "message": "internal error",
                }
            job.status = "failed"
        except Exception:
            log.exception("job %s (%s) failed", job.id, job.kind)
            job.error = {"code": "internal_error", "message": "internal error"}
            job.status = "failed"

    def get(self, job_id: str, touch: bool = False) -> Job | None:
        job = self._jobs.get(job_id)
        if job is not None and touch:
            job.last_seen = self._clock()
        return job

    def cancel(self, job_id: str) -> Job | None:
        job = self.get(job_id)
        if job is not None and job.status in ("queued", "running"):
            job.token.cancel()
            if job.status == "queued":
                job.status = "cancelled"
        return job

    def cancel_kinds(self, kinds: tuple[str, ...]) -> None:
        for job in list(self._jobs.values()):
            if job.kind in kinds and job.status in ("queued", "running"):
                job.token.cancel()

    def cancel_all(self) -> None:
        for job in list(self._jobs.values()):
            if job.status in ("queued", "running"):
                job.token.cancel()

    def shutdown(self) -> None:
        self._stop.set()
        self.cancel_all()
        self._pool.shutdown(wait=False)
