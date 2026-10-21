"""NRM-07: time and peak RSS growth of the normals at 1M points, in a fresh process.

Bounds are the part 12-9 step 0 criteria (<= 1.0 s, <= 400 MiB over the loaded cloud); raise them only with a recorded
measurement.
"""

from fixtures.normals_rss import run_normals


def test_nrm_07_one_million_points_within_a_second_and_400_mib():
    out = run_normals(1_000_000)
    assert out["ok"], out.get("stderr")
    assert out["n"] == 1_000_000
    assert out["seconds"] <= 1.0, f"{out['seconds']:.2f}s > 1.0s"
    assert out["growth_mib"] <= 400, f"{out['growth_mib']:.0f} MiB growth > 400"
