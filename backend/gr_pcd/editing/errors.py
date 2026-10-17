class EditError(ValueError):
    """An editing request is invalid in the current state."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
