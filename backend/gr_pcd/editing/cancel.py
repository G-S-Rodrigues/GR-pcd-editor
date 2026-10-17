"""Cooperative cancellation and chunked mask evaluation."""

import threading
from collections.abc import Callable

import numpy as np

CHUNK = 1_000_000


class Cancelled(Exception):
    """The operation observed its cancel token; no result exists."""


class CancelToken:
    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def check(self) -> None:
        if self._event.is_set():
            raise Cancelled()


def chunked_mask(
    n: int,
    fn: Callable[[int, int], np.ndarray],
    token: CancelToken | None = None,
    chunk: int = CHUNK,
) -> np.ndarray:
    """Evaluate `fn(lo, hi) -> bool[hi-lo]` chunk by chunk into one mask."""
    out = np.zeros(n, dtype=bool)
    for lo in range(0, n, chunk):
        if token is not None:
            token.check()
        hi = min(lo + chunk, n)
        out[lo:hi] = fn(lo, hi)
    if token is not None:
        token.check()
    return out
