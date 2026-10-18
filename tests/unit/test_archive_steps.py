"""SES-60..66 and HST-21: the timeline in the session archive."""

import json
import zipfile

import numpy as np
import pytest
from test_engine_steps import (
    CORNER,
    CORNER_BOX,
    GHOST_BOX,
    MIDDLE,
    MIDDLE_BOX,
    del_box,
    gone,
)
from test_history_property import check, run_sequence

from fixtures.pcdgen import SCENE_GHOST
from fixtures.sessions import fixture_dir, make_settings, wait, write_scene
from gr_pcd.pcd.errors import PcdError
from gr_pcd.session import archive as arc
from gr_pcd.session.engine import SelectSpec
from gr_pcd.session.manager import SessionManager


@pytest.fixture
def mgr(tmp_path):
    settings = make_settings(tmp_path)
    write_scene(settings)
    m = SessionManager(settings)
    m.open_pcd(fixture_dir(settings) / "scene.pcd", "scene.pcd")
    yield m
    m.jobs.shutdown()


def save(mgr):
    job = wait(mgr.submit_save())
    assert job.status == "complete", job.error
    return mgr.downloads[job.result["archive_id"]].path


def reopen(tmp_path, path, name="other"):
    fresh = SessionManager(make_settings(tmp_path / name))
    return fresh, fresh.open_archive(path)


def strip(s):
    h = s.state()["history"]
    return h["cursor"], [
        (
            e["sid"],
            e["tool"],
            e["name"],
            e["kind"],
            e["description"],
            e["count"],
        )
        for e in h["entries"]
    ]


def rewrite_manifest(src, dst, mutate):
    with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, "w") as zo:
        for info in zi.infolist():
            data = zi.read(info)
            if info.filename == "manifest.json":
                m = json.loads(data)
                mutate(m)
                data = json.dumps(m).encode()
            zo.writestr(info.filename, data)


def load(tmp_path, path):
    return arc.load_archive(path, tmp_path / "dest.pcd", 1 << 30, 1 << 30)


def steps_session(mgr):
    s = del_box(mgr, CORNER_BOX)
    del_box(mgr, GHOST_BOX)
    del_box(mgr, MIDDLE_BOX)
    s.rename_step(s.history.entries[0].sid, "corner cut")
    return s


def test_ses_60_round_trip_keeps_sid_name_tool_next_sid_cursor(mgr, tmp_path):
    s = steps_session(mgr)
    s.delete_step(s.clock.cloud, s.history.entries[1].sid)  # next_sid stays 3
    s.undo(s.clock.cloud)
    path = save(mgr)
    with zipfile.ZipFile(path) as zf:
        h = json.loads(zf.read("manifest.json"))["history"]
    assert h["next_sid"] == 3 and h["cursor"] == 1
    assert [(e["sid"], e["tool"], e["name"]) for e in h["entries"]] == [
        (0, "box", "corner cut"),
        (2, "box", None),
    ]
    fresh, r = reopen(tmp_path, path)
    try:
        assert strip(r) == strip(s)
        assert r.history.next_sid == 3
        r.redo(r.clock.cloud)
        assert gone(r) == CORNER | MIDDLE
    finally:
        fresh.jobs.shutdown()


def test_ses_61_rolled_back_deleted_middle_reopens_identically(mgr, tmp_path):
    s = steps_session(mgr)
    s.rollback(s.clock.cloud, 2)
    s.delete_step(s.clock.cloud, s.history.entries[0].sid)
    fresh, r = reopen(tmp_path, save(mgr))
    try:
        assert strip(r) == strip(s)
        assert np.array_equal(r.active, s.active)
        assert gone(r) == SCENE_GHOST
        del_box(fresh, MIDDLE_BOX)
        assert [e.sid for e in r.history.entries] == [1, 3]
    finally:
        fresh.jobs.shutdown()


def old_style(mgr, tmp_path, descriptions):
    s = mgr.require()
    boxes = [CORNER_BOX, GHOST_BOX, MIDDLE_BOX]
    for box, text in zip(boxes, descriptions, strict=True):
        job = wait(mgr.submit_select(SelectSpec("replace", "active", box)))
        s.apply(job.result["candidate"]["candidate_id"], s.clock.cloud, text)
    s.remove_invalid(s.clock.cloud)
    s.undo(s.clock.cloud)  # a rolled-back old archive keeps its marker
    src = save(mgr)
    dst = tmp_path / "old.pcdsession"

    def strip_new(m):
        for e in m["history"]["entries"]:
            for k in ("sid", "tool", "name"):
                e.pop(k, None)
        m["history"].pop("next_sid", None)

    rewrite_manifest(src, dst, strip_new)
    return s, dst


def test_ses_62_old_manifest_reconstructs_the_strip(mgr, tmp_path):
    _s, old = old_style(
        mgr,
        tmp_path,
        [
            "Delete 4 points (polygon)",
            "Delete 27 points (prism)  ",
            "free text",
        ],
    )
    loaded = load(tmp_path, old)
    assert [e.sid for e in loaded.entries] == [0, 1, 2, 3]
    assert [e.tool for e in loaded.entries] == [
        "polygon",
        "polygon",
        "selection",
        "invalid",
    ]
    assert all(e.name is None for e in loaded.entries)
    assert loaded.cursor == 3 and loaded.next_sid == 4
    fresh, r = reopen(tmp_path, old)
    try:
        assert r.state()["history"]["cursor"] == 3
        assert len(r.state()["history"]["entries"]) == 4
    finally:
        fresh.jobs.shutdown()


def hostile(mgr, tmp_path, mutate):
    steps_session(mgr)
    bad = tmp_path / "bad.pcdsession"
    rewrite_manifest(save(mgr), bad, mutate)
    with pytest.raises(PcdError) as exc:
        load(tmp_path, bad)
    return exc.value


@pytest.mark.parametrize(
    "mutate",
    [
        lambda m: m["history"]["entries"][1].update(sid=0),
        lambda m: m["history"]["entries"][0].update(sid=-1),
        lambda m: m["history"]["entries"][0].update(sid=2**31),
        lambda m: m["history"]["entries"][0].update(sid="0"),
        lambda m: m["history"]["entries"][0].update(sid=True),
        lambda m: m["history"]["entries"][0].update(tool="laser"),
        lambda m: m["history"]["entries"][0].update(tool=3),
        lambda m: m["history"]["entries"][0].update(name="x" * 81),
        lambda m: m["history"]["entries"][0].update(name="a\nb"),
        lambda m: m["history"]["entries"][0].update(name=5),
        lambda m: m["history"]["entries"][2].pop("sid"),  # mixed formats
        lambda m: m["history"].update(next_sid="3"),
        lambda m: m["history"].update(entries={"a": 1}),
    ],
)
def test_ses_63_hostile_fields_are_bad_archive(mgr, tmp_path, mutate):
    err = hostile(mgr, tmp_path, mutate)
    assert err.code == "bad_archive"


def test_ses_63b_low_next_sid_is_corrected_upward(mgr, tmp_path):
    steps_session(mgr)
    low = tmp_path / "low.pcdsession"
    rewrite_manifest(save(mgr), low, lambda m: m["history"].update(next_sid=0))
    assert load(tmp_path, low).next_sid == 3


def test_ses_64_no_new_zip_entry_names(mgr, tmp_path):
    steps_session(mgr)
    path = save(mgr)
    with zipfile.ZipFile(path) as zf:
        names = sorted(zf.namelist())
    assert names == [
        "history/0.bin",
        "history/1.bin",
        "history/2.bin",
        "manifest.json",
        "selection.bin",
        "source.pcd",
    ]
    for extra in ("timeline.json", "history/x.bin"):
        bad = tmp_path / "extra.pcdsession"
        with zipfile.ZipFile(path) as zi, zipfile.ZipFile(bad, "w") as zo:
            for info in zi.infolist():
                zo.writestr(info.filename, zi.read(info))
            zo.writestr(extra, b"{}")
        with pytest.raises(PcdError) as exc:
            load(tmp_path, bad)
        assert exc.value.code == "bad_archive"


def test_ses_65_overlap_and_hash_checks_after_delete_step(mgr, tmp_path):
    s = steps_session(mgr)
    s.delete_step(s.clock.cloud, s.history.entries[0].sid)
    path = save(mgr)
    load(tmp_path, path)  # still valid
    bad = tmp_path / "overlap.pcdsession"
    with zipfile.ZipFile(path) as zi, zipfile.ZipFile(bad, "w") as zo:
        for info in zi.infolist():
            data = zi.read(info)
            if info.filename == "history/1.bin":
                data = zi.read("history/0.bin")  # same ids twice
            zo.writestr(info.filename, data)
    with pytest.raises(PcdError) as exc:
        load(tmp_path, bad)
    assert exc.value.code == "bad_archive"
    flipped = tmp_path / "hash.pcdsession"
    rewrite_manifest(
        path, flipped, lambda m: m["source"].update(sha256="0" * 64)
    )
    with pytest.raises(PcdError) as exc:
        load(tmp_path, flipped)
    assert exc.value.code == "source_hash_mismatch"


def test_ses_66_old_reader_keys_are_all_still_present(mgr, tmp_path):
    steps_session(mgr)
    with zipfile.ZipFile(save(mgr)) as zf:
        m = json.loads(zf.read("manifest.json"))
    for i, e in enumerate(m["history"]["entries"]):
        assert {"kind", "description", "count", "file"} <= set(e)
        assert e["file"] == f"history/{i}.bin"
    assert "cursor" in m["history"] and m["version"] == 1


def test_hst_21_archive_round_trip_after_every_sequence(tmp_path):
    for seed in range(1000, 1060):
        m, s, o = run_sequence(tmp_path / f"s{seed}", seed)
        fresh = SessionManager(make_settings(tmp_path / f"r{seed}"))
        try:
            r = fresh.open_archive(save(m))
            check(r, o)
            assert r.history.next_sid == s.history.next_sid
        finally:
            fresh.jobs.shutdown()
            m.jobs.shutdown()


@pytest.mark.parametrize("bad", [2**31, 2**31 + 5, 2**53 + 1, -1, 1.5, None])
def test_ses_67_hostile_next_sid_is_bad_archive(mgr, tmp_path, bad):
    err = hostile(mgr, tmp_path, lambda m: m["history"].update(next_sid=bad))
    assert err.code == "bad_archive"


def test_ses_67b_largest_valid_next_sid_loads_and_a_push_is_refused(
    mgr, tmp_path
):
    from gr_pcd.editing.errors import EditError
    from gr_pcd.editing.history import MAX_SID, History

    steps_session(mgr)
    ok = tmp_path / "top.pcdsession"
    rewrite_manifest(
        save(mgr), ok, lambda m: m["history"].update(next_sid=MAX_SID - 1)
    )
    assert load(tmp_path, ok).next_sid == MAX_SID - 1
    h = History()
    h.next_sid = MAX_SID
    with pytest.raises(EditError):
        h.push("delete", "d", np.array([1], dtype=np.uint32))
    assert h.entries == []


def test_ses_68_more_than_max_steps_entries_is_bad_archive(mgr, tmp_path):
    from gr_pcd.editing.history import MAX_STEPS

    def grow(m):
        first = m["history"]["entries"][0]
        m["history"]["entries"] = [
            dict(first, sid=i, file=f"history/{i}.bin")
            for i in range(MAX_STEPS + 1)
        ]

    err = hostile(mgr, tmp_path, grow)
    assert err.code == "bad_archive"
    assert f"limited to {MAX_STEPS}" in err.message


def test_ses_69_old_format_huge_next_sid_is_clamped(mgr, tmp_path):
    steps_session(mgr)
    old = tmp_path / "old.pcdsession"

    def strip(m):
        for e in m["history"]["entries"]:
            for k in ("sid", "tool", "name"):
                e.pop(k, None)
        m["history"]["next_sid"] = 2**40

    rewrite_manifest(save(mgr), old, strip)
    assert load(tmp_path, old).next_sid == 3
