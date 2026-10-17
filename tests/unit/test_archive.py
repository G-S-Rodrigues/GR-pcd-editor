"""SES-22..27: session archive round trip and hostile inputs."""

import hashlib
import json
import shutil
import zipfile

import numpy as np
import pytest

from fixtures.pcdgen import SCENE_GHOST, build_pcd, xyz_fields
from fixtures.sessions import (
    box_all_ghost,
    delete_ghost,
    fixture_dir,
    make_settings,
    select_box,
    wait,
    write_scene,
)
from gr_pcd.editing.cancel import Cancelled, CancelToken
from gr_pcd.editing.protection import (
    Interval,
    OperationProtection,
    ProtectionState,
)
from gr_pcd.geometry.filters import AxisRange, DisplayFilter
from gr_pcd.pcd.errors import PcdError
from gr_pcd.session import archive as arc
from gr_pcd.session.manager import SessionManager


@pytest.fixture
def env(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    mgr = SessionManager(settings)
    mgr.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    yield mgr
    mgr.jobs.shutdown()


def saved_archive(mgr, tmp_path):
    s = mgr.require()
    delete_ghost(mgr)
    s.undo(s.clock.cloud)  # leaves a redo tail
    select_box(mgr, box_all_ghost())
    s.set_display_filter(DisplayFilter(z=AxisRange(True, -1.0, 5.0)))
    s.set_protection(
        ProtectionState(
            Interval(True, 0.0, 0.5),
            OperationProtection("add_local", (1.0, 1.5)),
        )
    )
    s.set_client_state({"camera": {"pos": [1, 2, 3]}})
    job = wait(mgr.submit_save())
    assert job.status == "complete", job.error
    return mgr.downloads[job.result["archive_id"]].path, job.result


def rewrite(src, dst, mutate):
    """Copy an archive entry by entry; mutate(name, data) -> data|None."""
    with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, "w") as zo:
        for info in zi.infolist():
            data = mutate(info.filename, zi.read(info))
            if data is not None:
                zo.writestr(info.filename, data)


def load(tmp_path, path, budget=1 << 30):
    dest = tmp_path / "dest-source.pcd"
    return arc.load_archive(path, dest, budget, 1 << 30), dest


def test_ses_22_round_trip(env, tmp_path):
    path, result = saved_archive(env, tmp_path)
    assert result["filename"] == "scene_session_v1.pcdsession"
    fresh = SessionManager(make_settings(tmp_path / "other"))
    s = fresh.open_archive(path)
    assert s.unsaved is False
    st = s.state()
    assert st["history"]["cursor"] == 0 and st["history"]["can_redo"]
    assert st["counts"]["deleted"] == 0
    assert set(np.flatnonzero(s.selection)) == SCENE_GHOST
    assert st["display_filter"]["z"] == {
        "enabled": True,
        "min": -1.0,
        "max": 5.0,
    }
    assert st["protection"]["operation"]["local"] == {"min": 1.0, "max": 1.5}
    assert st["protection"]["global"]["max"] == 0.5
    assert st["client_state"] == {"camera": {"pos": [1, 2, 3]}}
    assert st["revision"] == {"cloud": 1, "params": 1}
    s.redo(1)
    assert set(np.flatnonzero(~s.active)) == SCENE_GHOST
    fresh.jobs.shutdown()


def test_ses_23_archive_embeds_source(env, tmp_path):
    path, _ = saved_archive(env, tmp_path)
    original = (fixture_dir(env.settings) / "scene.pcd").read_bytes()
    with zipfile.ZipFile(path) as zf:
        assert hashlib.sha256(zf.read("source.pcd")).hexdigest() == (
            hashlib.sha256(original).hexdigest()
        )
        assert sorted(zf.namelist()) == [
            "history/0.bin",
            "manifest.json",
            "selection.bin",
            "source.pcd",
        ]
    keep = tmp_path / "keep.pcdsession"
    shutil.copy(path, keep)
    shutil.rmtree(env.settings.work_root)
    (fixture_dir(env.settings) / "scene.pcd").unlink()
    fresh = SessionManager(make_settings(tmp_path / "new"))
    assert fresh.open_archive(keep).state()["counts"]["original"] == 129
    fresh.jobs.shutdown()


def test_ses_24_tamper_and_mismatch(env, tmp_path):
    path, _ = saved_archive(env, tmp_path)
    bad = tmp_path / "tampered.pcdsession"

    def flip(name, data):
        if name == "source.pcd":
            b = bytearray(data)
            b[-1] ^= 1
            return bytes(b)
        return data

    rewrite(path, bad, flip)
    with pytest.raises(PcdError) as err:
        load(tmp_path, bad)
    assert err.value.code == "source_hash_mismatch"
    other = build_pcd(xyz_fields(8), [(1.0, 2.0, 3.0)], "binary")

    def swap(name, data):
        if name == "source.pcd":
            return other
        if name == "manifest.json":
            m = json.loads(data)
            m["source"]["sha256"] = hashlib.sha256(other).hexdigest()
            return json.dumps(m)
        return data

    mism = tmp_path / "mismatch.pcdsession"
    rewrite(path, mism, swap)
    with pytest.raises(PcdError) as err:
        load(tmp_path, mism)
    assert err.value.code == "schema_mismatch"


def manifest_edit(fn):
    def mutate(name, data):
        if name == "manifest.json":
            m = json.loads(data)
            fn(m)
            return json.dumps(m)
        return data

    return mutate


def test_ses_25_hostile_archives(env, tmp_path):
    path, _ = saved_archive(env, tmp_path)
    dest_dir = tmp_path
    before = sorted(p.name for p in dest_dir.iterdir())

    def add(name, data=b"x"):
        def mutate(n, d):
            return d

        out = tmp_path / f"h-{abs(hash(name))}.pcdsession"
        rewrite(path, out, mutate)
        with zipfile.ZipFile(out, "a") as zf:
            zf.writestr(name, data)
        return out

    cases = {
        "../evil": add("../evil"),
        "/abs": add("/abs"),
        "back\\slash": add("back\\slash"),
        "unexpected.txt": add("unexpected.txt"),
        "history/01.bin": add("history/01.bin"),
    }
    dup = tmp_path / "dup.pcdsession"
    rewrite(path, dup, lambda n, d: d)
    with zipfile.ZipFile(dup, "a") as zf, pytest.warns(UserWarning):
        zf.writestr("selection.bin", b"")
    cases["duplicate"] = dup
    link = tmp_path / "link.pcdsession"
    rewrite(path, link, lambda n, d: None if n == "selection.bin" else d)
    with zipfile.ZipFile(link, "a") as zf:
        info = zipfile.ZipInfo("selection.bin")
        info.external_attr = (0o120777) << 16
        zf.writestr(info, b"/etc/passwd")
    cases["symlink"] = link
    cases["bad_length"] = tmp_path / "len.pcdsession"
    rewrite(
        path,
        cases["bad_length"],
        lambda n, d: b"\x00\x00\x00" if n == "selection.bin" else d,
    )
    cases["id_oob"] = tmp_path / "oob.pcdsession"
    rewrite(
        path,
        cases["id_oob"],
        lambda n, d: (
            np.array([500], "<u4").tobytes() if n == "selection.bin" else d
        ),
    )
    cases["twice"] = tmp_path / "twice.pcdsession"
    rewrite(
        path,
        cases["twice"],
        manifest_edit(
            lambda m: m["history"]["entries"].append(
                dict(m["history"]["entries"][0], file="history/1.bin")
            )
        ),
    )
    with zipfile.ZipFile(cases["twice"], "a") as zf:
        zf.writestr("history/1.bin", np.arange(100, 103, dtype="<u4").tobytes())
    cases["garbage"] = tmp_path / "garbage.pcdsession"
    cases["garbage"].write_bytes(b"not a zip")
    for name, p in cases.items():
        with pytest.raises(PcdError) as err:
            load(tmp_path, p)
        assert err.value.code == "bad_archive", name
    v2 = tmp_path / "v2.pcdsession"
    rewrite(path, v2, manifest_edit(lambda m: m.update(version=2)))
    with pytest.raises(PcdError) as err:
        load(tmp_path, v2)
    assert err.value.code == "unsupported_session_version"
    after = sorted(p.name for p in dest_dir.iterdir())
    assert [
        n for n in after if n not in before and not n.endswith(".pcdsession")
    ] == []


def test_ses_26_zip_bomb_cap(env, tmp_path):
    path, _ = saved_archive(env, tmp_path)
    with zipfile.ZipFile(path) as zf:
        info = zf.getinfo("manifest.json")
        with pytest.raises(PcdError) as err:
            arc._read_all(zf, info, 10)  # stream longer than the cap
    assert err.value.code == "bad_archive"
    # a lying header: declared size smaller than the data fails the read
    lie = tmp_path / "lie.pcdsession"
    shutil.copy(path, lie)
    raw = bytearray(lie.read_bytes())
    marker = b"PK\x01\x02"
    i = raw.find(marker)  # first central directory record: manifest.json
    size_off = i + 24
    raw[size_off : size_off + 4] = (4).to_bytes(4, "little")
    lie.write_bytes(bytes(raw))
    with pytest.raises(PcdError) as err:
        load(tmp_path, lie)
    assert err.value.code == "bad_archive"


def test_ses_27_save_cancel_and_atomic(env, tmp_path):
    s = env.require()
    token = CancelToken()
    token.cancel()
    out = tmp_path / "x.pcdsession"
    with pytest.raises(Cancelled):
        arc.save_archive(s, out, token)
    assert not out.exists()
    assert not list(tmp_path.glob(".archive-*"))
    arc.save_archive(s, out, CancelToken())
    assert out.exists() and not list(tmp_path.glob(".archive-*"))
