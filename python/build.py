"""Vercel Python Function entrypoint — wraps build_and_export_glb.

Module-level imports stay warm across invocations on Vercel Fluid Compute,
so ifcopenshell + topologic_core + the homemaker-addon only pay their import
cost on cold start (then amortise across all subsequent requests served by
the same instance).

URL: /build (configured by routePrefix in vercel.json)
- POST → generate a building, return model/gltf-binary bytes
- GET  → cheap healthcheck (used by the Vercel Cron warmer)
"""

import json
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path

# Make `python/` importable so we can pull in generate.py from this module
# (Vercel sets cwd to the project root, not the entrypoint's directory).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate import build_and_export_glb  # noqa: E402


class handler(BaseHTTPRequestHandler):
    # --- health check -------------------------------------------------------
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    # --- generate -----------------------------------------------------------
    def do_POST(self):
        t0 = time.perf_counter()
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length > 0 else b"{}"
            params = json.loads(body.decode("utf-8"))
        except Exception as e:
            self._send_error(400, f"bad request: {e}")
            return

        try:
            glb = build_and_export_glb(params)
        except Exception as e:
            sys.stderr.write(traceback.format_exc())
            sys.stderr.flush()
            self._send_error(500, f"{type(e).__name__}: {e}")
            return

        ms = int((time.perf_counter() - t0) * 1000)
        self.send_response(200)
        self.send_header("Content-Type", "model/gltf-binary")
        self.send_header("Content-Length", str(len(glb)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Generation-Ms", str(ms))
        self.end_headers()
        self.wfile.write(glb)

    def _send_error(self, code: int, msg: str):
        body = json.dumps({"error": msg}).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
