from gr_pcd.files.names import safe_filename
from gr_pcd.session.archive import archive_filename
from gr_pcd.session.exporter import cleaned_filename

BAD = '"\\/:*?<>|\r\n\0'


def test_fil_06_safe_filename_strips_hostile_characters() -> None:
    got = safe_filename('a"b/../c\r\n.pcd')
    assert not any(ch in got for ch in BAD)
    assert got.endswith(".pcd")
    assert safe_filename("") == "upload"
    assert safe_filename("..") == "upload"
    assert len(safe_filename("x" * 300 + ".pcd")) <= 200
    assert safe_filename("C:\\dir\\scan.pcd") == "scan.pcd"


def test_fil_07_download_names_are_sanitised() -> None:
    assert '"' not in cleaned_filename('x"y.pcd')
    assert cleaned_filename('x"y.pcd').endswith("_cleaned.pcd")
    assert '"' not in archive_filename('x"y.pcd')
    assert archive_filename("scan.pcd") == "scan_session_v1.pcdsession"
