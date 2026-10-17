import os
from pathlib import Path

import pytest

from gr_pcd.files.mounted import MAX_ENTRIES, list_mounted
from gr_pcd.paths import PathEscapeError


def _tree(root: Path) -> None:
    (root / "zeta").mkdir()
    (root / "alpha").mkdir()
    (root / "b.PCD").write_bytes(b"12345")
    (root / "a.pcdsession").write_bytes(b"123")
    (root / "notes.txt").write_text("x")
    (root / "zeta" / "c.pcd").write_bytes(b"1")


def test_fil_01_root_listing_sorted_filtered(tmp_path) -> None:
    _tree(tmp_path)
    got = list_mounted(tmp_path, "")
    assert got["path"] == ""
    assert got["truncated"] is False
    assert [(e["name"], e["type"]) for e in got["entries"]] == [
        ("alpha", "dir"),
        ("zeta", "dir"),
        ("a.pcdsession", "file"),
        ("b.PCD", "file"),
    ]
    files = {e["name"]: e for e in got["entries"] if e["type"] == "file"}
    assert files["b.PCD"]["kind"] == "pcd"
    assert files["b.PCD"]["size"] == 5
    assert files["a.pcdsession"]["kind"] == "session"


def test_fil_02_subdir_listing_has_relative_path(tmp_path) -> None:
    _tree(tmp_path)
    got = list_mounted(tmp_path, "zeta")
    assert got["path"] == "zeta"
    assert [e["name"] for e in got["entries"]] == ["c.pcd"]


@pytest.mark.parametrize("bad", ["..", "../x", "/etc", "a\0b", "a\\b"])
def test_fil_03_escapes_rejected(tmp_path, bad) -> None:
    with pytest.raises(PathEscapeError):
        list_mounted(tmp_path, bad)


def test_fil_04_symlinks_leaving_root_are_skipped(tmp_path) -> None:
    root = tmp_path / "root"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (outside / "o.pcd").write_bytes(b"1")
    (root / "real.pcd").write_bytes(b"1")
    (root / "inside").symlink_to(root / "real.pcd")
    (root / "out_dir").symlink_to(outside)
    (root / "out_file.pcd").symlink_to(outside / "o.pcd")
    (root / "broken.pcd").symlink_to(root / "missing.pcd")
    names = [e["name"] for e in list_mounted(root, "")["entries"]]
    assert names == ["real.pcd"]
    (root / "inside2.pcd").symlink_to(root / "real.pcd")
    names = [e["name"] for e in list_mounted(root, "")["entries"]]
    assert names == ["inside2.pcd", "real.pcd"]


@pytest.mark.skipif(os.getuid() == 0, reason="root ignores chmod 000")
def test_fil_05_unreadable_dir_raises_permission_error(tmp_path) -> None:
    d = tmp_path / "locked"
    d.mkdir()
    d.chmod(0)
    try:
        with pytest.raises(PermissionError):
            list_mounted(tmp_path, "locked")
    finally:
        d.chmod(0o755)


def test_fil_01b_truncates_at_limit(tmp_path) -> None:
    for i in range(MAX_ENTRIES + 1):
        (tmp_path / f"f{i:05d}.pcd").write_bytes(b"")
    got = list_mounted(tmp_path, "")
    assert got["truncated"] is True
    assert len(got["entries"]) == MAX_ENTRIES
