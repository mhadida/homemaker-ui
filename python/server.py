"""Long-running stdio server.

Protocol (binary, length-prefixed):
- Request: 4-byte little-endian length, then JSON bytes.
- Response: 1-byte kind (0=ok, 1=error), 4-byte little-endian length, then payload.
  kind=0 payload is a binary glb. kind=1 payload is a utf-8 error message.

Stderr is used for diagnostics. The line "READY\\n" on stderr signals that
imports are complete and the first request can be sent.
"""

import json
import struct
import sys
import time
import traceback

from generate import build_and_export_glb


def _read_exact(n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sys.stdin.buffer.read(n - len(buf))
        if not chunk:
            return b""
        buf += chunk
    return buf


def _write_response(kind: int, payload: bytes) -> None:
    sys.stdout.buffer.write(struct.pack("<BI", kind, len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def main() -> int:
    sys.stderr.write("READY\n")
    sys.stderr.flush()

    while True:
        header = _read_exact(4)
        if not header:
            return 0
        (length,) = struct.unpack("<I", header)
        body = _read_exact(length)
        if len(body) != length:
            sys.stderr.write(f"truncated request: expected {length}, got {len(body)}\n")
            return 1
        t0 = time.perf_counter()
        try:
            params = json.loads(body)
            glb = build_and_export_glb(params)
            dt_ms = int((time.perf_counter() - t0) * 1000)
            sys.stderr.write(f"req: {dt_ms}ms, {len(glb)}B\n")
            sys.stderr.flush()
            _write_response(0, glb)
        except Exception as e:
            tb = traceback.format_exc()
            sys.stderr.write(tb)
            sys.stderr.flush()
            msg = f"{type(e).__name__}: {e}\n{tb}"
            _write_response(1, msg.encode("utf-8"))


if __name__ == "__main__":
    sys.exit(main())
