"""Streamed upload storage and the in-memory upload registry."""

import errno
import threading
from dataclasses import dataclass
from pathlib import Path

MAX_ENTRIES = 16
FINISHED = ("done", "failed", "cancelled")


class UploadError(Exception):
    code = "upload_error"
    status = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class UploadTooLarge(UploadError):
    code = "upload_too_large"
    status = 413


class StorageFull(UploadError):
    code = "storage_full"
    status = 507


class UploadCancelled(UploadError):
    code = "upload_cancelled"
    status = 409


class UploadIncomplete(UploadError):
    code = "upload_incomplete"
    status = 400


class DuplicateUpload(UploadError):
    code = "duplicate_upload"
    status = 409


class InvalidUploadId(UploadError):
    code = "invalid_upload_id"
    status = 422


class TooManyUploads(UploadError):
    code = "too_many_uploads"
    status = 429


@dataclass
class UploadEntry:
    upload_id: str
    total: int | None
    status: str = "receiving"
    received: int = 0
    error: dict | None = None
    cancel_requested: bool = False

    def to_dict(self) -> dict:
        out = {
            "upload_id": self.upload_id,
            "status": self.status,
            "received": self.received,
            "total": self.total,
        }
        if self.error is not None:
            out["error"] = self.error
        return out


class UploadRegistry:
    def __init__(self) -> None:
        self.entries: dict[str, UploadEntry] = {}
        self._lock = threading.Lock()

    def register(self, upload_id: str, total: int | None) -> UploadEntry:
        with self._lock:
            old = self.entries.get(upload_id)
            if old is not None and old.status not in FINISHED:
                raise DuplicateUpload("an upload with this id is active")
            self.entries.pop(upload_id, None)
            if len(self.entries) >= MAX_ENTRIES:
                for key, e in list(self.entries.items()):
                    if e.status in FINISHED:
                        del self.entries[key]
                        break
                else:
                    raise TooManyUploads("too many uploads in progress")
            entry = UploadEntry(upload_id, total)
            self.entries[upload_id] = entry
            return entry

    def get(self, upload_id: str) -> UploadEntry | None:
        return self.entries.get(upload_id)

    def active_ids(self) -> set[str]:
        return {k for k, e in self.entries.items() if e.status not in FINISHED}


async def store_upload(chunks, dest: Path, limit: int, entry, opener=open):
    """Stream `chunks` to `dest` via `<dest>.part`; return bytes written."""
    dest = Path(dest)
    part = dest.with_name(dest.name + ".part")
    part.parent.mkdir(parents=True, exist_ok=True)
    fh = None
    try:
        fh = opener(part, "wb")
        async for chunk in chunks:
            if entry.cancel_requested:
                entry.status = "cancelled"
                raise UploadCancelled("the upload was cancelled")
            if entry.received + len(chunk) > limit:
                raise UploadTooLarge(
                    f"file exceeds the {limit / 1024**3:g} GiB limit"
                )
            try:
                fh.write(chunk)
            except OSError as exc:
                if exc.errno == errno.ENOSPC:
                    raise StorageFull("the work volume is full") from exc
                raise
            entry.received += len(chunk)
        fh.close()
        fh = None
        part.replace(dest)
        return entry.received
    except BaseException:
        if fh is not None:
            try:
                fh.close()
            except OSError:
                pass
        part.unlink(missing_ok=True)
        raise
