import asyncio
import errno

import pytest
from starlette.requests import ClientDisconnect

from gr_pcd.files.uploads import (
    DuplicateUpload,
    StorageFull,
    UploadCancelled,
    UploadRegistry,
    UploadTooLarge,
    store_upload,
)

UID = "a" * 32


async def _chunks(*parts, then=None):
    for p in parts:
        yield p
    if then is not None:
        raise then


def _run(coro):
    return asyncio.run(coro)


def _entry(reg=None, uid=UID, total=None):
    return (reg or UploadRegistry()).register(uid, total)


def test_fil_08_store_writes_and_renames(tmp_path) -> None:
    dest = tmp_path / "u.pcd"
    entry = _entry(total=7)
    got = _run(store_upload(_chunks(b"abc", b"defg"), dest, 100, entry))
    assert got == 7 and entry.received == 7
    assert dest.read_bytes() == b"abcdefg"
    assert [p.name for p in tmp_path.iterdir()] == ["u.pcd"]


def test_fil_09_over_limit_removes_part(tmp_path) -> None:
    dest = tmp_path / "u.pcd"
    with pytest.raises(UploadTooLarge):
        _run(store_upload(_chunks(b"abc", b"defg"), dest, 5, _entry()))
    assert list(tmp_path.iterdir()) == []


def test_fil_10_cancel_flag_stops_and_cleans(tmp_path) -> None:
    dest = tmp_path / "u.pcd"
    entry = _entry()

    async def gen():
        yield b"abc"
        entry.cancel_requested = True
        yield b"def"

    with pytest.raises(UploadCancelled):
        _run(store_upload(gen(), dest, 100, entry))
    assert list(tmp_path.iterdir()) == []
    assert entry.status == "cancelled"


def test_fil_11_disconnect_propagates_and_cleans(tmp_path) -> None:
    dest = tmp_path / "u.pcd"
    entry = _entry()
    with pytest.raises(ClientDisconnect):
        _run(
            store_upload(
                _chunks(b"abc", then=ClientDisconnect()), dest, 100, entry
            )
        )
    assert list(tmp_path.iterdir()) == []


def test_fil_12_enospc_becomes_storage_full(tmp_path) -> None:
    dest = tmp_path / "u.pcd"

    class Full:
        def __init__(self, path, mode):
            path.touch()

        def write(self, data):
            raise OSError(errno.ENOSPC, "no space")

        def close(self):
            pass

    with pytest.raises(StorageFull):
        _run(store_upload(_chunks(b"abc"), dest, 100, _entry(), opener=Full))
    assert list(tmp_path.iterdir()) == []


def test_fil_13_registry_rules() -> None:
    reg = UploadRegistry()
    first = reg.register(UID, 10)
    with pytest.raises(DuplicateUpload):
        reg.register(UID, 10)
    assert first.status == "receiving"
    first.status = "done"
    reg.register(UID, 10)  # a finished id may be reused
    ids = [f"{i:032x}" for i in range(1, 40)]
    for i in ids[:15]:
        reg.register(i, None)
    assert len(reg.entries) == 16
    reg.get(ids[0]).status = "failed"
    reg.register(ids[15], None)  # evicts the finished entry first
    assert reg.get(ids[0]) is None and len(reg.entries) == 16
    assert reg.get(UID) is not None
