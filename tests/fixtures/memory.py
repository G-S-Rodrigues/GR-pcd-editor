"""Hand freed heap back to the OS after a heavy test module.

PCD-61 measures a child process that inherits the parent's resident peak, so a
module that leaves a fragmented heap behind can tip it over its estimate.
"""

import ctypes
import gc


def trim() -> None:
    gc.collect()
    ctypes.CDLL("libc.so.6").malloc_trim(0)
