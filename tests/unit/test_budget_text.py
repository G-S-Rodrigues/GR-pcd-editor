import pytest

from gr_pcd.pcd.errors import PcdError
from gr_pcd.session.budget import check_budget, human_bytes


def test_bud_01_human_bytes():
    assert human_bytes(300 * 1024**2) == "300 MiB"
    assert human_bytes(5_814_000_000) == "5.4 GiB"
    assert human_bytes(3_865_470_566) == "3.6 GiB"
    assert human_bytes(512) == "512 bytes"


def test_bud_02_import_refusal_is_readable():
    with pytest.raises(PcdError) as ei:
        check_budget(5_814_000_000, 3_865_470_566)
    assert ei.value.code == "memory_budget_exceeded"
    assert str(ei.value) == (
        "import needs about 5.4 GiB of memory but the limit is 3.6 GiB. "
        "The file is not corrupt; it is too large for this server's memory."
    )


def test_bud_03_other_operations_keep_their_own_advice():
    with pytest.raises(PcdError) as ei:
        check_budget(
            2 * 1024**3, 1024**3, "cluster search", "Try a smaller region."
        )
    msg = str(ei.value)
    assert msg.startswith("cluster search needs about 2.0 GiB")
    assert "Try a smaller region." in msg and "not corrupt" not in msg
