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


class NoSuchLayer(NotFoundError):
    code = "no_such_layer"

    def __init__(self, layer_id: int) -> None:
        super().__init__(f"there is no layer {layer_id}")


class ReplaceConflict(Exception):
    code = "unsaved_work"
    message = (
        "the open session has unsaved edits; save it or confirm the replacement"
    )


class SessionChanged(Exception):
    """The request names a session that is no longer the open one."""

    code = "session_changed"
    message = "the open session is not the one this request was made for"

    def __init__(self, current: str | None) -> None:
        super().__init__(self.message)
        self.current = current
