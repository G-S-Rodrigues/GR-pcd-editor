import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_root: Path
    work_root: Path
    static_dir: Path

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            data_root=Path(os.environ.get("GR_PCD_DATA_ROOT", "/data")),
            work_root=Path(os.environ.get("GR_PCD_WORK_ROOT", "/work")),
            static_dir=Path(os.environ.get("GR_PCD_STATIC_DIR", "/app/static")),
        )
