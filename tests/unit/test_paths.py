import os
from pathlib import Path

import pytest

from gr_pcd.paths import PathEscapeError, resolve_data_path


def test_be_01_relative_path_resolves_under_root(tmp_path: Path) -> None:
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "a.pcd").write_text("x")
    got = resolve_data_path(tmp_path, "sub/a.pcd")
    assert got == (tmp_path / "sub" / "a.pcd").resolve()


def test_be_02_parent_traversal_rejected(tmp_path: Path) -> None:
    with pytest.raises(PathEscapeError):
        resolve_data_path(tmp_path, "../x")


def test_be_03_absolute_path_rejected(tmp_path: Path) -> None:
    with pytest.raises(PathEscapeError):
        resolve_data_path(tmp_path, "/etc/passwd")


def test_be_04_symlink_escape_rejected(tmp_path: Path) -> None:
    root = tmp_path / "root"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (outside / "f.pcd").write_text("x")
    os.symlink(outside / "f.pcd", root / "link.pcd")
    os.symlink(outside, root / "linkdir")
    with pytest.raises(PathEscapeError):
        resolve_data_path(root, "link.pcd")
    with pytest.raises(PathEscapeError):
        resolve_data_path(root, "linkdir/f.pcd")


def test_be_05_symlink_inside_root_allowed(tmp_path: Path) -> None:
    (tmp_path / "real.pcd").write_text("x")
    os.symlink(tmp_path / "real.pcd", tmp_path / "alias.pcd")
    got = resolve_data_path(tmp_path, "alias.pcd")
    assert got == (tmp_path / "real.pcd").resolve()
