from gr_pcd.settings import Settings


def _env(monkeypatch, **kw):
    for k in (
        "GR_PCD_PUBLIC_PORT",
        "GR_PCD_UPLOAD_RESERVE_BYTES",
        "GR_PCD_DOWNLOAD_TTL_SECONDS",
    ):
        monkeypatch.delenv(k, raising=False)
    for k, v in kw.items():
        monkeypatch.setenv(k, v)


def test_fil_00_defaults(monkeypatch) -> None:
    _env(monkeypatch)
    s = Settings.from_env()
    assert s.public_port == 8080
    assert s.upload_reserve_bytes == 256 * 1024**2
    assert s.download_ttl_seconds == 3600


def test_fil_00_env_parsing(monkeypatch) -> None:
    _env(
        monkeypatch,
        GR_PCD_PUBLIC_PORT="9001",
        GR_PCD_UPLOAD_RESERVE_BYTES="5",
        GR_PCD_DOWNLOAD_TTL_SECONDS="7",
    )
    s = Settings.from_env()
    assert (s.public_port, s.upload_reserve_bytes) == (9001, 5)
    assert s.download_ttl_seconds == 7


def test_be_14_no_data_root_setting(monkeypatch, tmp_path) -> None:
    _env(monkeypatch, GR_PCD_DATA_ROOT=str(tmp_path / "ignored"))
    s = Settings.from_env()
    assert not hasattr(s, "data_root")
    assert "data_root" not in Settings.__dataclass_fields__
