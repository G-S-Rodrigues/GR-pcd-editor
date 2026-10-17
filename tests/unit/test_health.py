from pathlib import Path

from gr_pcd.health import readiness_problems
from gr_pcd.settings import Settings


def _settings(tmp_path: Path) -> Settings:
    data = tmp_path / "data"
    work = tmp_path / "work"
    static = tmp_path / "static"
    for d in (data, work, static):
        d.mkdir()
    (static / "index.html").write_text("<html></html>")
    return Settings(data_root=data, work_root=work, static_dir=static)


def test_be_06_ready_has_no_problems(tmp_path: Path) -> None:
    assert readiness_problems(_settings(tmp_path)) == []


def test_be_07_missing_or_unreadable_data_dir_named(tmp_path: Path) -> None:
    s = _settings(tmp_path)
    s.data_root.chmod(0)
    try:
        problems = readiness_problems(s)
    finally:
        s.data_root.chmod(0o755)
    assert len(problems) == 1 and "data" in problems[0]
    s.data_root.rmdir()
    assert any("data" in p for p in readiness_problems(s))


def test_be_08_unwritable_work_dir_named(tmp_path: Path) -> None:
    s = _settings(tmp_path)
    s.work_root.chmod(0o555)
    try:
        problems = readiness_problems(s)
    finally:
        s.work_root.chmod(0o755)
    assert len(problems) == 1 and "work" in problems[0]


def test_be_09_missing_static_index_named(tmp_path: Path) -> None:
    s = _settings(tmp_path)
    (s.static_dir / "index.html").unlink()
    problems = readiness_problems(s)
    assert len(problems) == 1 and "index.html" in problems[0]
