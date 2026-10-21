"""SPR-10: time and peak RSS growth of the sparse-point filter at 1M points, in a fresh process.

The bounds come from the part 13-0 measurement (0.50 s and 72 MiB growth on a 1M room, auto radius included; plan bounds 2.0 s and 150 MiB); raise them only with
a recorded measurement."""

from fixtures.sparse_rss import run_sparse


def test_spr_10_one_million_points_within_bounds():
    out = run_sparse(1_000_000)
    assert out["ok"], out.get("stderr")
    assert out["n"] == 1_000_000
    assert out["seconds"] <= 2.0, f"{out['seconds']:.2f}s > 2.0s"
    assert out["growth_mib"] <= 150, f"{out['growth_mib']:.0f} MiB growth > 150"
