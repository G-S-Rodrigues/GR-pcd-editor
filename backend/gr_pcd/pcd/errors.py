"""Errors raised by PCD parsing, writing and the memory guard."""


class PcdError(Exception):
    """A PCD file or request is invalid; `code` is stable for the API."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
