"""Deletion history with undo/redo and revision tickets."""

import threading
from dataclasses import dataclass

import numpy as np

from gr_pcd.editing.errors import EditError

BYTES_PER_ID = 4


@dataclass(frozen=True)
class HistoryEntry:
    kind: str
    description: str
    ids: np.ndarray  # sorted unique uint32


class History:
    def __init__(self, budget_bytes: int | None = None) -> None:
        self.entries: list[HistoryEntry] = []
        self.cursor = 0
        self.budget_bytes = budget_bytes

    @property
    def can_undo(self) -> bool:
        return self.cursor > 0

    @property
    def can_redo(self) -> bool:
        return self.cursor < len(self.entries)

    def _bytes(self, entries) -> int:
        return sum(int(e.ids.nbytes) for e in entries)

    def push(self, kind: str, description: str, ids: np.ndarray) -> None:
        ids = np.asarray(ids, dtype=np.uint32)
        kept = self.entries[: self.cursor]
        if (
            self.budget_bytes is not None
            and self._bytes(kept) + len(ids) * BYTES_PER_ID > self.budget_bytes
        ):
            raise EditError(
                "history_budget_exceeded", "history would exceed its budget"
            )
        self.entries = kept + [HistoryEntry(kind, description, ids)]
        self.cursor = len(self.entries)

    def undo(self) -> HistoryEntry:
        if not self.can_undo:
            raise EditError("nothing_to_undo", "nothing to undo")
        self.cursor -= 1
        return self.entries[self.cursor]

    def redo(self) -> HistoryEntry:
        if not self.can_redo:
            raise EditError("nothing_to_redo", "nothing to redo")
        entry = self.entries[self.cursor]
        self.cursor += 1
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
