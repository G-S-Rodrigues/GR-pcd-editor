"""THN-13, THN-14: time and peak RSS growth of the thin tool at 1M points (half of them exact copies), fresh process.

Bounds are the worst of 3 runs of the committed code on the checks image, times 1.5 (the CLU-47 rule):
duplicates at eps 1e-3 2.96 s and 171 MiB growth -> 4.45 s and 257 MiB; voxel 0.05 0.81 s and 132.6 MiB -> 1.22 s
and 199 MiB. Raise a bound only with a recorded measurement."""

from fixtures.plane_rss import run_case


def test_thn_13_duplicates_on_one_million_points_within_bounds():
    out = run_case("dup", 1_000_000)
    assert out["ok"], out.get("stderr")
    assert out["n"] == 1_000_000 and out["result"] >= 500_000
    assert out["seconds"] <= 4.45, f"{out['seconds']:.2f}s > 4.45s"
    assert out["growth_mib"] <= 257, f"{out['growth_mib']:.0f} MiB growth > 257"


def test_thn_14_voxel_on_one_million_points_within_bounds():
    out = run_case("voxel", 1_000_000)
    assert out["ok"], out.get("stderr")
    assert out["n"] == 1_000_000 and out["result"] > 0
    assert out["seconds"] <= 1.22, f"{out['seconds']:.2f}s > 1.22s"
    assert out["growth_mib"] <= 199, f"{out['growth_mib']:.0f} MiB growth > 199"


def test_thn_pair_budget_holds_for_dense_blob():
    """200k rows, 10k of them identical, distance 1e-3, budget = 1.05 x pairs x 16: either the search is refused
    up front (memory_budget_exceeded) or its peak growth stays within the budget. It must not die in SciPy."""
    out = run_case("dupblob", 200_000)
    assert out["ok"], out.get("stderr")
    assert out["code"] == "memory_budget_exceeded" or (
        out["code"] is None and out["growth_mib"] <= out["budget_mib"]
    ), out
