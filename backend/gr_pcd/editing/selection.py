"""Selection algebra over boolean masks (pure functions)."""

import numpy as np

from gr_pcd.editing.errors import EditError


def scope_mask(
    scope: str, active: np.ndarray, valid: np.ndarray, display: np.ndarray
) -> np.ndarray:
    """`displayed` = active & valid & F; `active` = active & valid."""
    base = active & valid
    if scope == "displayed":
        return base & display
    if scope == "active":
        return base
    raise EditError("invalid_scope", f"unknown scope {scope}")


def filter_operand(
    active: np.ndarray, valid: np.ndarray, display: np.ndarray
) -> np.ndarray:
    """'Select displayed' operand: every displayed point, no sampling."""
    return active & valid & display


def combine_selection(
    current: np.ndarray, operand: np.ndarray, op: str, scope: np.ndarray
) -> np.ndarray:
    """Combine; the operand is clipped to scope first. Invert ignores it."""
    operand = operand & scope
    if op == "replace":
        return operand
    if op == "add":
        return current | operand
    if op == "subtract":
        return current & ~operand
    if op == "intersect":
        return current & operand
    if op == "invert":
        return scope & ~current
    raise EditError("invalid_op", f"unknown selection op {op}")


def read_selection(
    selection: np.ndarray, active: np.ndarray, valid: np.ndarray
) -> np.ndarray:
    """The selection is always clipped to active, valid points when read."""
    return selection & active & valid
