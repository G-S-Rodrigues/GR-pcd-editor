import numpy as np


def invalid_active_ids(active: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Active records with non-finite XYZ, ascending, as uint32."""
    return np.flatnonzero(active & ~valid).astype(np.uint32)


def remove_invalid(active, valid, history):
    """Delete every active invalid record as one undoable entry."""
    from gr_pcd.editing.errors import EditError
    from gr_pcd.editing.history import with_ids

    ids = invalid_active_ids(active, valid)
    if len(ids) == 0:
        raise EditError("nothing_to_remove", "no invalid points to remove")
    history.push("remove_invalid", f"Removed {len(ids)} invalid points", ids)
    return with_ids(active, ids, False)
