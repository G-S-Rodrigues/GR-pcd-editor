class GeometryError(ValueError):
    """A tool, filter or protection parameter is invalid."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
