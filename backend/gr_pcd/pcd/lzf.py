"""LZF decoder (liblzf format, as used by PCL binary_compressed)."""

from gr_pcd.pcd.errors import PcdError


def _bad(msg: str) -> PcdError:
    return PcdError("bad_compression", msg)


def lzf_decompress(data: bytes, out_size: int) -> bytes:
    out = bytearray()
    i = 0
    n = len(data)
    while i < n:
        ctrl = data[i]
        i += 1
        if ctrl < 32:
            run = ctrl + 1
            if i + run > n:
                raise _bad("literal run beyond end of stream")
            if len(out) + run > out_size:
                raise _bad("output overrun")
            out += data[i : i + run]
            i += run
            continue
        length = ctrl >> 5
        if length == 7:
            if i >= n:
                raise _bad("truncated length byte")
            length += data[i]
            i += 1
        if i >= n:
            raise _bad("truncated offset byte")
        ref = len(out) - ((ctrl & 0x1F) << 8) - data[i] - 1
        i += 1
        length += 2
        if ref < 0:
            raise _bad("back-reference before start of output")
        if len(out) + length > out_size:
            raise _bad("output overrun")
        dist = len(out) - ref
        if dist >= length:
            out += out[ref : ref + length]
        else:
            for k in range(length):
                out.append(out[ref + k])
    if len(out) != out_size:
        raise _bad(f"decoded {len(out)} bytes, expected {out_size}")
    return bytes(out)
