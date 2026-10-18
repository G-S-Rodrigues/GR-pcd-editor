"""Deletion history with undo/redo and revision tickets."""

import threading
from dataclasses import dataclass, replace

import numpy as np

from gr_pcd.editing.errors import EditError

BYTES_PER_ID = 4
MAX_STEPS = 500
# step ids stay below this (the archive loader and the JS client rely on it)
MAX_SID = 2**31
MAX_NAME = 80
TOOLS = ("box", "polygon", "cluster", "filter", "selection", "invalid")


@dataclass(frozen=True)
class HistoryEntry:
    kind: str
    description: str
    ids: np.ndarray  # sorted unique uint32
    sid: int = -1  # stable step id, assigned by History.push
    tool: str = "selection"
    name: str | None = None


def clean_name(name: str | None) -> str | None:
    """A step name: stripped, at most 80 chars, no control characters.
    None or blank clears it (the default label is used)."""
    if name is None:
        return None
    if not isinstance(name, str):
        raise EditError("invalid_name", "a step name must be text")
    name = name.strip()
    if len(name) > MAX_NAME:
        raise EditError(
            "invalid_name", f"a step name has at most {MAX_NAME} characters"
        )
    if any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise EditError("invalid_name", "a step name has no control characters")
    return name or None


class History:
    """Deletion steps. Each step is exactly its id set; the sets are pairwise
    disjoint (every push is a subset of the points active at that moment and
    the redo tail is discarded), so rollback and step deletion are plain set
    arithmetic and no selection is ever recomputed."""

    def __init__(self, budget_bytes: int | None = None) -> None:
        self.entries: list[HistoryEntry] = []
        self.cursor = 0
        self.budget_bytes = budget_bytes
        self.next_sid = 0

    @property
    def can_undo(self) -> bool:
        return self.cursor > 0

    @property
    def can_redo(self) -> bool:
        return self.cursor < len(self.entries)

    def _bytes(self, entries) -> int:
        return sum(int(e.ids.nbytes) for e in entries)

    def push(
        self,
        kind: str,
        description: str,
        ids: np.ndarray,
        tool: str = "selection",
    ) -> None:
        ids = np.asarray(ids, dtype=np.uint32)
        kept = self.entries[: self.cursor]
        if len(kept) >= MAX_STEPS:
            raise EditError(
                "too_many_steps", f"history is limited to {MAX_STEPS} steps"
            )
        if self.next_sid >= MAX_SID:
            raise EditError("too_many_steps", "step ids are used up")
        if (
            self.budget_bytes is not None
            and self._bytes(kept) + len(ids) * BYTES_PER_ID > self.budget_bytes
        ):
            raise EditError(
                "history_budget_exceeded", "history would exceed its budget"
            )
        entry = HistoryEntry(kind, description, ids, self.next_sid, tool)
        self.next_sid += 1
        self.entries = kept + [entry]
        self.cursor = len(self.entries)

    def rollback(self, cursor: int) -> tuple[list[HistoryEntry], bool]:
        """Move the marker. Returns the entries whose points flip and whether
        the move was backwards (points return) or forwards (deleted again)."""
        if not isinstance(cursor, int) or not 0 <= cursor <= len(self.entries):
            raise EditError(
                "invalid_cursor", "the marker position is out of range"
            )
        old = self.cursor
        self.cursor = cursor
        if cursor < old:
            return self.entries[cursor:old], True
        return self.entries[old:cursor], False

    def undo(self) -> HistoryEntry:
        if not self.can_undo:
            raise EditError("nothing_to_undo", "nothing to undo")
        return self.rollback(self.cursor - 1)[0][0]

    def redo(self) -> HistoryEntry:
        if not self.can_redo:
            raise EditError("nothing_to_redo", "nothing to redo")
        return self.rollback(self.cursor + 1)[0][0]

    def _index(self, sid: int) -> int:
        for i, e in enumerate(self.entries):
            if e.sid == sid:
                return i
        raise EditError("no_such_step", f"there is no step {sid}")

    def entry(self, sid: int) -> HistoryEntry:
        return self.entries[self._index(sid)]

    def delete_step(self, sid: int) -> tuple[HistoryEntry, bool]:
        """Remove one step only. Returns it and whether it was applied (its
        points were deleted and must come back)."""
        i = self._index(sid)
        entry = self.entries[i]
        applied = i < self.cursor
        self.entries = self.entries[:i] + self.entries[i + 1 :]
        if applied:
            self.cursor -= 1
        return entry, applied

    def rename_step(self, sid: int, name: str | None) -> HistoryEntry:
        i = self._index(sid)
        cleaned = clean_name(name)
        entry = replace(self.entries[i], name=cleaned)
        self.entries = self.entries[:i] + [entry] + self.entries[i + 1 :]
        return entry


class RevisionClock:
    """cloud revision bumps both counters; params bumps only itself."""

    def __init__(self, cloud: int = 1, params: int = 1) -> None:
        self.cloud = cloud
        self.params = params
        self._lock = threading.Lock()

    def ticket(self) -> tuple[int, int]:
        with self._lock:
            return (self.cloud, self.params)

    def bump_params(self) -> None:
        with self._lock:
            self.params += 1

    def bump_cloud(self) -> None:
        with self._lock:
            self.cloud += 1
            self.params += 1

    def is_current(self, ticket: tuple[int, int]) -> bool:
        return self.ticket() == tuple(ticket)


def with_ids(active: np.ndarray, ids: np.ndarray, value: bool) -> np.ndarray:
    """Copy-on-write: a new mask with `ids` set to `value`."""
    out = active.copy()
    out[ids] = value
    out.flags.writeable = False
    return out
