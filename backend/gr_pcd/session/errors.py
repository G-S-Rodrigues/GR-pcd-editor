"""Session-level errors (mapped to HTTP statuses by the API layer)."""


class StaleRevision(Exception):
    """The request used an obsolete revision or candidate."""

    code = "stale_revision"

    def __init__(self, message: str, current: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.current = current or {}


class NoSessionError(Exception):
    code = "no_session"
    message = "no session is open"


class NotFoundError(Exception):
    code = "not_found"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ReplaceConflict(Exception):
    code = "unsaved_work"
    message = (
        "the open session has unsaved edits; save it or confirm the replacement"
    )
