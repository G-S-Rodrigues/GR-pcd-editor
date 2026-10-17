import os
from dataclasses import dataclass
from pathlib import Path


def _opt_int(name: str) -> int | None:
    value = os.environ.get(name)
    return int(value) if value else None


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value else default


@dataclass(frozen=True)
class Settings:
    data_root: Path
    work_root: Path
    static_dir: Path
    memory_budget_bytes: int | None = None
    max_source_bytes: int = 16 * 1024**3
    public_port: int = 8080
    upload_reserve_bytes: int = 256 * 1024**2
    download_ttl_seconds: int = 3600
    job_orphan_seconds: float = 20.0

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            data_root=Path(os.environ.get("GR_PCD_DATA_ROOT", "/data")),
            work_root=Path(os.environ.get("GR_PCD_WORK_ROOT", "/work")),
            static_dir=Path(os.environ.get("GR_PCD_STATIC_DIR", "/app/static")),
            memory_budget_bytes=_opt_int("GR_PCD_MEMORY_BUDGET_BYTES"),
            max_source_bytes=_opt_int("GR_PCD_MAX_SOURCE_BYTES")
            or 16 * 1024**3,
            public_port=_opt_int("GR_PCD_PUBLIC_PORT") or 8080,
            upload_reserve_bytes=_env_int(
                "GR_PCD_UPLOAD_RESERVE_BYTES", 256 * 1024**2
            ),
            download_ttl_seconds=_env_int("GR_PCD_DOWNLOAD_TTL_SECONDS", 3600),
        )
