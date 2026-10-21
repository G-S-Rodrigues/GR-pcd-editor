"""SessionManager: at most one open session, its jobs and downloads."""

import os
import shutil
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

from gr_pcd.files.uploads import UploadRegistry
from gr_pcd.files.workdir import ensure_dir
from gr_pcd.pcd.errors import PcdError
from gr_pcd.pcd.reader import read_pcd
from gr_pcd.session.archive import load_archive, save_archive
from gr_pcd.session.budget import default_budget
from gr_pcd.session.engine import EditingSession, SelectSpec
from gr_pcd.session.errors import (
    NoSessionError,
    NotFoundError,
    ReplaceConflict,
)
from gr_pcd.session.exporter import export_per_layer, export_session
from gr_pcd.session.jobs import CANCELS, JobManager
from gr_pcd.settings import Settings


@dataclass
class Download:
    path: Path
    filename: str
    edit_counter: int = 0
    session_id: str = ""
    kind: str = ""  # the work sub folder asked of ensure_dir, not a dir name


class SessionManager:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.jobs = JobManager(orphan_s=settings.job_orphan_seconds)
        self.session: EditingSession | None = None
        self.downloads: dict[str, Download] = {}
        self.uploads = UploadRegistry()
        self._lock = threading.RLock()
        self._open_lock = threading.Lock()  # one import at a time

    # ---- directories (created lazily, never at import) -----------------
    def _dir(self, *parts: str) -> Path:
        return ensure_dir(self.settings.work_root, *parts)

    def uploads_dir(self) -> Path:
        return self._dir("uploads")

    @property
    def budget(self) -> int:
        b = self.settings.memory_budget_bytes
        return default_budget() if b is None else b

    # ---- open / close --------------------------------------------------
    def require(self) -> EditingSession:
        session = self.session
        if session is None:
            raise NoSessionError()
        return session

    def require_replaceable(self, replace: bool) -> None:
        """Refuse to replace a session that has unsaved edits."""
        session = self.session
        if session is not None and session.unsaved and not replace:
            raise ReplaceConflict()

    def _retain_source(self, path: Path, session_id: str) -> Path:
        dest = self._dir("sessions", session_id) / "source.pcd"
        try:
            os.link(path, dest)
        except OSError:
            shutil.copyfile(path, dest)
        return dest

    def _swap(self, new: EditingSession) -> None:
        with self._lock:
            old, self.session = self.session, new
            self.jobs.cancel_all()
        if old is not None:
            shutil.rmtree(old.source_path.parent, ignore_errors=True)

    def open_pcd(self, path: Path, display_name: str) -> EditingSession:
        with self._open_lock:
            return self._open_pcd(path, display_name)

    def _open_pcd(self, path: Path, display_name: str) -> EditingSession:
        path = Path(path)
        if path.stat().st_size > self.settings.max_source_bytes:
            raise PcdError("source_too_large", "file exceeds the size limit")
        sid = uuid.uuid4().hex
        try:
            retained = self._retain_source(path, sid)
            cloud = read_pcd(retained, budget=self.budget)
            new = EditingSession(
                cloud, retained, display_name, self.budget, path, sid
            )
        except BaseException:
            shutil.rmtree(self._dir("sessions", sid), ignore_errors=True)
            raise
        self._swap(new)
        return new

    def open_archive(self, path: Path) -> EditingSession:
        with self._open_lock:
            return self._open_archive(path)

    def _open_archive(self, path: Path) -> EditingSession:
        sid = uuid.uuid4().hex
        dest = self._dir("sessions", sid) / "source.pcd"
        try:
            loaded = load_archive(
                Path(path), dest, self.budget, self.settings.max_source_bytes
            )
            new = EditingSession(
                loaded.cloud, dest, loaded.filename, self.budget, dest, sid
            )
            new.restore(loaded)
        except BaseException:
            shutil.rmtree(self._dir("sessions", sid), ignore_errors=True)
            raise
        self._swap(new)
        return new

    def close(self) -> None:
        with self._lock:
            old, self.session = self.session, None
            self.jobs.cancel_all()
        if old is not None:
            shutil.rmtree(old.source_path.parent, ignore_errors=True)

    # ---- jobs ----------------------------------------------------------
    def _submit(self, kind: str, body):
        """`body(session, ctx, ticket)`; supersedes older select/candidate."""
        with self._lock:
            session = self.require()
            if kind in CANCELS:
                self.jobs.cancel_kinds(CANCELS[kind])
            ticket = session.clock.ticket()
            return self.jobs.submit(
                kind, lambda ctx: body(session, ctx, ticket)
            )

    def submit_select(self, spec: SelectSpec):
        return self._submit(
            "select",
            lambda s, ctx, t: s.run_select(spec, t, ctx.token, ctx.progress),
        )

    def submit_preview(self, spec: SelectSpec):
        return self._submit(
            "preview",
            lambda s, ctx, t: s.run_preview(spec, t, ctx.token, ctx.progress),
        )

    def submit_commit(self, preview_id: str, evaluate_candidate: bool = True):
        return self._submit(
            "select",
            lambda s, ctx, t: s.commit_pending(
                preview_id, t, ctx.token, evaluate_candidate
            ),
        )

    def submit_candidate(self):
        return self._submit(
            "candidate",
            lambda s, ctx, t: s.run_candidate(t, ctx.token, ctx.progress),
        )

    def submit_export(
        self,
        fmt: str,
        scope: str,
        layers: list[int] | None = None,
        per_layer: bool = False,
    ):
        export_id = uuid.uuid4().hex

        def per_layer_body(session, ctx, _ticket):
            summary = export_per_layer(
                session, self._dir("exports"), fmt, scope, ctx.token, layers
            )
            for f in summary["files"]:
                self.downloads[f["export_id"]] = Download(
                    f.pop("path"), f["filename"], kind="exports"
                )
            return summary

        def body(session, ctx, _ticket):
            dest = self._dir("exports") / f"{export_id}.pcd"
            summary = export_session(
                session, dest, fmt, scope, ctx.token, layers=layers
            )
            self.downloads[export_id] = Download(
                dest, summary["filename"], kind="exports"
            )
            return {"export_id": export_id, **summary}

        return self._submit("export", per_layer_body if per_layer else body)

    def submit_save(self):
        archive_id = uuid.uuid4().hex

        def body(session, ctx, _ticket):
            dest = self._dir("session-archives") / f"{archive_id}.pcdsession"
            summary = save_archive(session, dest, ctx.token)
            counter = summary.pop("edit_counter")
            self.downloads[archive_id] = Download(
                dest,
                summary["filename"],
                counter,
                session.id,
                "session-archives",
            )
            return {"archive_id": archive_id, **summary}

        return self._submit("save", body)

    def download(self, download_id: str, kind_dir: str) -> Download:
        d = self.downloads.get(download_id)
        # the folder may be `<kind>.u<uid>` (workdir fallback), so the kind is
        # recorded when the file is made instead of read from the folder name
        if d is None or d.kind != kind_dir or not d.path.exists():
            raise NotFoundError("no such download")
        return d

    def mark_saved(self, archive_id: str) -> EditingSession:
        session = self.require()
        d = self.download(archive_id, "session-archives")
        if d.session_id == session.id:
            session.mark_saved(d.edit_counter)
        return session
