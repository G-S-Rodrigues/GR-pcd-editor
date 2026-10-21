"""SES-40..43: cgroup-aware budget, job RSS guard, generic errors, orphan sweeper."""

import threading
import time

import numpy as np
import pytest

from fixtures.pcdgen import room_rows
from gr_pcd.editing.cluster import connected_component
from gr_pcd.session import budget
from gr_pcd.session.jobs import JobManager

GIB = 1024**3


def _write(tmp_path, name, text):
    p = tmp_path / name
    p.write_text(text)
    return str(p)


def _wait(job, timeout=10.0):
    end = time.time() + timeout
    while job.status in ("queued", "running") and time.time() < end:
        time.sleep(0.01)
    return job


def test_ses_40_default_budget_uses_the_container_limit(monkeypatch, tmp_path):
    monkeypatch.delenv("GR_PCD_MEMORY_BUDGET_BYTES", raising=False)
    meminfo = _write(
        tmp_path, "meminfo", f"MemAvailable: {64 * GIB // 1024} kB\n"
    )
    monkeypatch.setattr(budget, "MEMINFO", meminfo)
    monkeypatch.setattr(budget, "CGROUP_V1_LIMIT", str(tmp_path / "none-v1"))
    monkeypatch.setattr(
        budget, "CGROUP_V2_LIMIT", _write(tmp_path, "max", str(2 * GIB))
    )
    assert budget.memory_limit_bytes() == 2 * GIB
    assert budget.default_budget() == int(0.6 * 2 * GIB)
    # "max" means unlimited: the host figure applies (the old behaviour)
    monkeypatch.setattr(
        budget, "CGROUP_V2_LIMIT", _write(tmp_path, "max2", "max\n")
    )
    assert budget.memory_limit_bytes() is None
    assert budget.default_budget() == int(0.6 * 64 * GIB)
    # cgroup v1 fallback
    monkeypatch.setattr(budget, "CGROUP_V2_LIMIT", str(tmp_path / "none-v2"))
    monkeypatch.setattr(
        budget, "CGROUP_V1_LIMIT", _write(tmp_path, "v1", str(GIB))
    )
    assert budget.default_budget() == int(0.6 * GIB)


def test_ses_41_rss_guard_fails_the_job_and_the_process_survives(monkeypatch):
    monkeypatch.setattr(budget, "memory_limit_bytes", lambda: 1000)
    monkeypatch.setattr(budget, "GUARD_INTERVAL_S", 0.0)
    rss = {"v": 100}
    monkeypatch.setattr(budget, "rss_bytes", lambda: rss["v"])
    jobs = JobManager(sweep=False)

    def hog(ctx):
        for i in range(10_000):
            if i == 5:
                rss["v"] = 900  # > 0.85 * limit
            ctx.token.check()
            time.sleep(0.001)
        return {"done": True}

    job = _wait(jobs.submit("select", hog))
    assert job.status == "failed"
    assert job.error["code"] == "memory_guard"
    assert "memory" in job.error["message"]
    rss["v"] = 100  # a following job works
    ok = _wait(
        jobs.submit("select", lambda ctx: (ctx.token.check(), {"x": 1})[1])
    )
    assert ok.status == "complete"
    jobs.shutdown()


def test_ses_41b_guard_runs_inside_the_cluster_loop(monkeypatch):
    from gr_pcd.editing.cancel import CancelToken
    from gr_pcd.pcd.errors import PcdError

    token = CancelToken()
    hits = []

    def guard():
        hits.append(1)
        if len(hits) > 3:
            raise PcdError("memory_guard", "stop")

    token.guard = guard
    xyz, _ = room_rows(30_000, 3)
    with pytest.raises(PcdError):
        connected_component(xyz, np.ones(len(xyz), bool), 0, 1.0, token=token)


def test_ses_42_internal_error_message_is_generic():
    jobs = JobManager(sweep=False)

    def boom(ctx):
        raise RuntimeError("secret path /work/uploads/x.pcd")

    job = _wait(jobs.submit("export", boom))
    assert job.status == "failed"
    assert job.error == {"code": "internal_error", "message": "internal error"}
    jobs.shutdown()


def test_ses_42b_enospc_maps_to_storage_full():
    import errno

    jobs = JobManager(sweep=False)

    def full(ctx):
        raise OSError(errno.ENOSPC, "No space left on device")

    job = _wait(jobs.submit("export", full))
    assert job.error["code"] == "storage_full"
    jobs.shutdown()


def test_ses_43_orphan_sweeper_cancels_unpolled_select_jobs():
    now = {"t": 0.0}
    jobs = JobManager(orphan_s=20.0, clock=lambda: now["t"], sweep=False)
    gate = threading.Event()

    def slow(ctx):
        while not gate.is_set():
            ctx.token.check()
            time.sleep(0.005)
        return {}

    sel = jobs.submit("select", slow)
    exp = jobs.submit("export", lambda ctx: (gate.wait(5), {})[1])
    time.sleep(0.1)
    now["t"] = 15.0
    jobs.get(sel.id, touch=True)  # polled: stays alive
    now["t"] = 30.0
    jobs.sweep()
    assert not sel.token.cancelled  # 15 s since last poll
    now["t"] = 36.0
    jobs.sweep()
    assert sel.token.cancelled  # 21 s since last poll
    assert not exp.token.cancelled  # only select/candidate are swept
    _wait(sel)
    assert sel.status == "cancelled"
    gate.set()
    jobs.shutdown()


def test_ses_91_sweep_cancels_orphaned_planes_job():
    now = {"t": 0.0}
    jobs = JobManager(orphan_s=20.0, clock=lambda: now["t"], sweep=False)
    gate = threading.Event()

    def loop(ctx):
        while not gate.is_set():
            ctx.token.check()
            time.sleep(0.005)
        return {}

    job = jobs.submit("planes", loop)
    try:
        time.sleep(0.1)
        now["t"] = 21.0
        jobs.sweep()
        assert job.token.cancelled
        _wait(job)
        assert job.status == "cancelled"
    finally:
        gate.set()
        jobs.shutdown()
