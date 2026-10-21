"""CLU-40..43: time and peak RSS bounds, each in a fresh process.

Bounds are provisional; raise them only with a recorded measurement.
"""

import pytest

from fixtures.rss import run_cluster


def _check(out, seconds, rss_mib):
    assert out["ok"], out.get("stderr")
    assert out["seconds"] <= seconds, f"{out['seconds']:.1f}s > {seconds}s"
    assert out["rss_mib"] <= rss_mib, f"{out['rss_mib']:.0f} MiB > {rss_mib}"


def test_clu_40_whole_room_331k_r05():
    _check(run_cluster(331_000, 0.5), 3.0, 700)


@pytest.mark.parametrize("radius,seconds", [(1.0, 4.0), (2.0, 6.0), (5.0, 8.0)])
def test_clu_41_whole_room_331k_larger_radii(radius, seconds):
    _check(run_cluster(331_000, radius), seconds, 700)


def test_clu_42_993k_default_radius():
    _check(run_cluster(993_000, 0.5), 10.0, 1229)


def test_clu_43_cancel_latency_at_993k():
    out = run_cluster(993_000, 0.5, cancel_after=1.0)
    assert out["ok"], out.get("stderr")
    if out["cancel_latency"] is not None:  # finished before the cancel: fine
        assert out["cancel_latency"] <= 1.0, out["cancel_latency"]


# CLU-47: exact Max points cap (nearest-first point BFS). NEW bounds: RSS 1.5x, CPU seconds 2.5x
# (1.5x flaked at machine load 10-16: chain 13-16 s against 7.8 s quiet), each
# 1.5x the final measurement on the checks image (3 runs, stable):
#   room 331k r 0.5, K=500: 0.10-0.15 s, 103 MiB (HEAD, overshooting: 0.158 s)
#   room 331k r 0.5, K=165k (half): 7.05-7.6 s, 260 MiB (VmHWM) (HEAD, overshooting K=150k: 1.4 s)
#   chain 20k points spaced 0.9 r, K=10k: 7.8 s, 68 MiB (HEAD: 16 s)
# The plan's 200k chain was replaced: HEAD alone needs 124 s there (cell BFS).
def _check_hwm(out, seconds, rss_mib):
    # VmHWM of the fresh process: ru_maxrss would include the pytest parent's peak
    assert out["ok"], out.get("stderr")
    # process CPU seconds: wall time doubles on a loaded machine, CPU time does not
    assert out["cpu_seconds"] <= seconds, (
        f"{out['cpu_seconds']:.1f}s > {seconds}s"
    )
    assert out["hwm_mib"] <= rss_mib, f"{out['hwm_mib']:.0f} MiB > {rss_mib}"


def test_clu_47_exact_cap_k500_on_the_room():
    out = run_cluster(331_000, 0.5, max_points=500)
    _check_hwm(out, 0.4, 155)
    assert out["size"] == 500


def test_clu_47_exact_cap_half_the_room():
    out = run_cluster(331_000, 0.5, max_points=165_000, timeout=240)
    _check_hwm(out, 19.0, 400)
    assert out["size"] == 165_000


def test_clu_47_exact_cap_on_a_chain_of_many_levels():
    out = run_cluster(20_000, 0.5, max_points=10_000, fixture="chain")
    _check_hwm(out, 19.5, 105)
    assert out["size"] == 10_000
