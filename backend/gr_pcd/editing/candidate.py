"""Deletion candidate: D = (A & S) & ~P, with the counts the UI reports."""

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class CandidateResult:
    ids: np.ndarray  # sorted uint32 original indices
    selected_active: int
    protected_retained: int
    candidates: int
    selected_outside_display_filter: int
    bounds: tuple[tuple[float, ...], tuple[float, ...]] | None


def candidate_deletion(
    xyz: np.ndarray,
    active: np.ndarray,
    valid: np.ndarray,
    selection: np.ndarray,
    protected: np.ndarray,
    display: np.ndarray,
) -> CandidateResult:
    sel = selection & active & valid
    protected = protected & valid
    deletion = sel & ~protected
    ids = np.flatnonzero(deletion).astype(np.uint32)
    bounds = None
    if len(ids):
        pts = xyz[ids]
        bounds = (tuple(pts.min(axis=0)), tuple(pts.max(axis=0)))
    return CandidateResult(
        ids=ids,
        selected_active=int(sel.sum()),
        protected_retained=int((sel & protected).sum()),
        candidates=len(ids),
        selected_outside_display_filter=int((sel & ~display).sum()),
        bounds=bounds,
    )
