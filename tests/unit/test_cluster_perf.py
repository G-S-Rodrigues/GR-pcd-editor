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
