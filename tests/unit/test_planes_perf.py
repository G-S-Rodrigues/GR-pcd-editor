"""PLN-14, PLN-15: time and peak RSS growth of plane detection and plane membership at 1M points, fresh process.

Bounds are the worst of 3 runs of the committed code on the checks image, times 1.5 (the CLU-47 rule):
detect 1.50 s and 96.2 MiB growth -> 2.25 s and 145 MiB; plane membership 14.6 MiB -> 22 MiB. Its time (0.03 s)
is below timer and load noise, so its bound is 0.5 s. Raise a bound only with a recorded measurement."""

from fixtures.plane_rss import run_case


def test_pln_14_detect_on_one_million_points_within_bounds():
    out = run_case("detect", 1_000_000)
    assert out["ok"], out.get("stderr")
    assert out["n"] == 1_000_000 and out["result"] == 2
    assert out["seconds"] <= 2.25, f"{out['seconds']:.2f}s > 2.25s"
    assert out["growth_mib"] <= 145, f"{out['growth_mib']:.0f} MiB growth > 145"


def test_pln_15_plane_membership_on_one_million_points_within_bounds():
    out = run_case("plane", 1_000_000)
    assert out["ok"], out.get("stderr")
    assert out["n"] == 1_000_000 and out["result"] > 0
    assert out["seconds"] <= 0.5, f"{out['seconds']:.2f}s > 0.5s"
    assert out["growth_mib"] <= 22, f"{out['growth_mib']:.0f} MiB growth > 22"
