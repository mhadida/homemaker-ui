"""Generate public/default.glb — the canonical default building.

Run with: python3 python/build_default.py

The params here MUST match DEFAULT_PARAMS in src/lib/building/types.ts.
Re-run whenever DEFAULT_PARAMS or the generator pipeline changes.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "python"))

from generate import build_and_export_glb  # noqa: E402


DEFAULT_PARAMS = {
    "footprint": [[-5, -4], [5, -4], [5, 4], [-5, 4]],
    "storeys": 2,
    "storeyHeight": 3.0,
    # classicalStoreyHeights(2, 3.0) → ratios [1.0, 0.9], scaled to avg 3.0
    "storeyHeights": [3.16, 2.84],
    "style": "default",
    "roof": "pitched",
    "ridgeHeight": 3.0,
    "rooms": [],
    "wallColor": "#c7bca8",
    "roofColor": "#a64b32",
}


def main() -> None:
    glb = build_and_export_glb(DEFAULT_PARAMS)
    out = REPO_ROOT / "public" / "default.glb"
    out.write_bytes(glb)
    print(f"wrote {out} ({len(glb)} bytes)")


if __name__ == "__main__":
    main()
