"""Headless Homemaker pipeline: params (stdin JSON) -> IFC -> glb (stdout).

Replicates `create_building_mesh` from mcp_server.py in pure Python, then runs
Molior directly (no Blender, no Bonsai), extracts geometry with
ifcopenshell.geom, and serializes a binary glTF (.glb) to stdout.

Usage:
    echo '{"footprint": [[...]], "storeys": 2, ...}' | python generate.py > out.glb
"""

from __future__ import annotations

import json
import math
import os
import struct
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
# homemaker-addon is vendored as a Git submodule at python/vendor/homemaker-addon
# (pinned commit, repos kept independent). Falls back to the sibling-repo path
# for local dev convenience if a developer hasn't initialised the submodule.
_VENDORED_ADDON = REPO_ROOT / "python" / "vendor" / "homemaker-addon"
_SIBLING_ADDON = REPO_ROOT.parent / "homemaker-addon"
ADDON_ROOT = _VENDORED_ADDON if _VENDORED_ADDON.exists() else _SIBLING_ADDON
SHARE_DIR = str(ADDON_ROOT / "share")
sys.path.insert(0, str(ADDON_ROOT))

import numpy as np
import ifcopenshell
import ifcopenshell.geom
import pygltflib
from topologic_core import Vertex, Face
from molior import Molior
from molior.ifc import init


# ── Right-angle wing decomposition (ported from lib/building/geometry.ts) ──


def _unique_sorted(values: list[float]) -> list[float]:
    s: set[float] = set()
    for v in values:
        s.add(round(v * 1000) / 1000)
    return sorted(s)


def _point_in_polygon(p: tuple[float, float], poly: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        intersect = ((yi > p[1]) != (yj > p[1])) and (
            p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


def _point_in_region(
    p: tuple[float, float],
    outer: list[tuple[float, float]],
    holes: list[list[tuple[float, float]]] = (),
) -> bool:
    """Inside outer ring AND outside every hole."""
    if not _point_in_polygon(p, outer):
        return False
    for hole in holes:
        if _point_in_polygon(p, hole):
            return False
    return True


def _pick_ridge_axis(width: float, depth: float) -> str:
    return "y" if depth > width else "x"


def decompose_into_wings(
    footprint: list[tuple[float, float]],
    holes: list[list[tuple[float, float]]] = (),
) -> list[dict]:
    """Greedy max-area rectangle decomposition of an orthogonal polygon.

    Returns a list of dicts: {minX, maxX, minY, maxY, ridgeAxis}.
    Each rectangle covers a sub-region of the footprint; their union equals
    the footprint area exactly for axis-aligned right-angle polygons.
    Holes (e.g. courtyard voids) are excluded from the decomposition.
    """
    all_xs = [p[0] for p in footprint] + [p[0] for h in holes for p in h]
    all_ys = [p[1] for p in footprint] + [p[1] for h in holes for p in h]
    xs = _unique_sorted(all_xs)
    ys = _unique_sorted(all_ys)

    if not holes and len(xs) == 2 and len(ys) == 2:
        return [
            {
                "minX": xs[0], "maxX": xs[1],
                "minY": ys[0], "maxY": ys[1],
                "ridgeAxis": _pick_ridge_axis(xs[1] - xs[0], ys[1] - ys[0]),
            }
        ]

    cols = len(xs) - 1
    rows = len(ys) - 1
    cells = []
    for jj in range(rows):
        row = []
        for ii in range(cols):
            cx = (xs[ii] + xs[ii + 1]) / 2
            cy = (ys[jj] + ys[jj + 1]) / 2
            row.append(_point_in_region((cx, cy), footprint, holes))
        cells.append(row)

    used = [[False] * cols for _ in range(rows)]
    wings: list[dict] = []

    while True:
        best = None
        for jj in range(rows):
            for ii in range(cols):
                if not cells[jj][ii] or used[jj][ii]:
                    continue

                # Width-first expansion
                i_end_h = ii
                while i_end_h < cols and cells[jj][i_end_h] and not used[jj][i_end_h]:
                    i_end_h += 1
                j_end_h = jj + 1
                while j_end_h < rows:
                    ok = True
                    for k in range(ii, i_end_h):
                        if not cells[j_end_h][k] or used[j_end_h][k]:
                            ok = False
                            break
                    if not ok:
                        break
                    j_end_h += 1

                # Height-first expansion
                j_end_v = jj
                while j_end_v < rows and cells[j_end_v][ii] and not used[j_end_v][ii]:
                    j_end_v += 1
                i_end_v = ii + 1
                while i_end_v < cols:
                    ok = True
                    for k in range(jj, j_end_v):
                        if not cells[k][i_end_v] or used[k][i_end_v]:
                            ok = False
                            break
                    if not ok:
                        break
                    i_end_v += 1

                for cand in (
                    (ii, jj, i_end_h, j_end_h),
                    (ii, jj, i_end_v, j_end_v),
                ):
                    ci, cj, ci_end, cj_end = cand
                    area = (xs[ci_end] - xs[ci]) * (ys[cj_end] - ys[cj])
                    cell_area = (ci_end - ci) * (cj_end - cj)
                    if best is None or area > best["area"] or (
                        area == best["area"] and cell_area > best["cellArea"]
                    ):
                        best = {
                            "i": ci, "j": cj,
                            "iEnd": ci_end, "jEnd": cj_end,
                            "area": area, "cellArea": cell_area,
                        }
        if best is None:
            break
        wings.append({
            "minX": xs[best["i"]], "maxX": xs[best["iEnd"]],
            "minY": ys[best["j"]], "maxY": ys[best["jEnd"]],
            "ridgeAxis": _pick_ridge_axis(
                xs[best["iEnd"]] - xs[best["i"]],
                ys[best["jEnd"]] - ys[best["j"]],
            ),
        })
        for k in range(best["j"], best["jEnd"]):
            for l in range(best["i"], best["iEnd"]):
                used[k][l] = True

    return wings


def _wing_ridge_line(wing: dict, ridge_z: float) -> tuple:
    """Returns (start_pt, end_pt) of the wing's ridge as (x, y, z) tuples."""
    if wing["ridgeAxis"] == "x":
        mid_y = (wing["minY"] + wing["maxY"]) / 2
        return ((wing["minX"], mid_y, ridge_z), (wing["maxX"], mid_y, ridge_z))
    else:
        mid_x = (wing["minX"] + wing["maxX"]) / 2
        return ((mid_x, wing["minY"], ridge_z), (mid_x, wing["maxY"], ridge_z))


def _find_attachment(wing_a: dict, wing_b: dict, eps: float = 0.001) -> str | None:
    """Find which side of wing_a is attached to wing_b (or None if not adjacent).

    Returns one of: 'east' (b is east of a), 'west', 'north', 'south'.
    Requires a non-degenerate overlap on the perpendicular axis."""
    if abs(wing_a["maxX"] - wing_b["minX"]) < eps:
        y_overlap = min(wing_a["maxY"], wing_b["maxY"]) - max(wing_a["minY"], wing_b["minY"])
        if y_overlap > eps:
            return "east"
    if abs(wing_a["minX"] - wing_b["maxX"]) < eps:
        y_overlap = min(wing_a["maxY"], wing_b["maxY"]) - max(wing_a["minY"], wing_b["minY"])
        if y_overlap > eps:
            return "west"
    if abs(wing_a["maxY"] - wing_b["minY"]) < eps:
        x_overlap = min(wing_a["maxX"], wing_b["maxX"]) - max(wing_a["minX"], wing_b["minX"])
        if x_overlap > eps:
            return "north"
    if abs(wing_a["minY"] - wing_b["maxY"]) < eps:
        x_overlap = min(wing_a["maxX"], wing_b["maxX"]) - max(wing_a["minX"], wing_b["minX"])
        if x_overlap > eps:
            return "south"
    return None


def _wing_long_dim(wing: dict) -> float:
    """The wing's length along its ridge axis (i.e. its dominant dimension)."""
    if wing["ridgeAxis"] == "x":
        return wing["maxX"] - wing["minX"]
    return wing["maxY"] - wing["minY"]


# ── Topologic face construction ────────────────────────────────────────


def _add_rect_pitched_faces(
    faces: list,
    top_verts: list,
    footprint: list[tuple[float, float]],
    roof_base_z: float,
    ridge_height: float,
    style: str,
) -> None:
    """4-corner rectangular pitched roof: slopes + gable triangles."""
    xs = [p[0] for p in footprint]
    ys = [p[1] for p in footprint]
    width_x = max(xs) - min(xs)
    width_y = max(ys) - min(ys)
    roof_z = roof_base_z + ridge_height

    if width_x >= width_y:
        mid_y = (min(ys) + max(ys)) / 2
        rv = [
            Vertex.ByCoordinates(min(xs), mid_y, roof_z),
            Vertex.ByCoordinates(max(xs), mid_y, roof_z),
        ]
        new_faces = [
            Face.ByVertices([top_verts[0], top_verts[1], rv[1], rv[0]]),
            Face.ByVertices([top_verts[2], top_verts[3], rv[0], rv[1]]),
            Face.ByVertices([top_verts[3], top_verts[0], rv[0]]),
            Face.ByVertices([top_verts[1], top_verts[2], rv[1]]),
        ]
    else:
        mid_x = (min(xs) + max(xs)) / 2
        rv = [
            Vertex.ByCoordinates(mid_x, min(ys), roof_z),
            Vertex.ByCoordinates(mid_x, max(ys), roof_z),
        ]
        new_faces = [
            Face.ByVertices([top_verts[3], top_verts[0], rv[0], rv[1]]),
            Face.ByVertices([top_verts[1], top_verts[2], rv[1], rv[0]]),
            Face.ByVertices([top_verts[0], top_verts[1], rv[0]]),
            Face.ByVertices([top_verts[2], top_verts[3], rv[1]]),
        ]
    for f in new_faces:
        f.Set("stylename", style)
        faces.append(f)


def _single_wing_pitched_polys(
    wing: dict, roof_z: float, ridge_z: float
) -> list[list[tuple[float, float, float]]]:
    """Return the 4 face polygons (2 slopes + 2 gable triangles) for a
    standalone wing. Coordinates as plain (x,y,z) tuples."""
    min_x, max_x = wing["minX"], wing["maxX"]
    min_y, max_y = wing["minY"], wing["maxY"]
    sw = (min_x, min_y, roof_z)
    se = (max_x, min_y, roof_z)
    ne = (max_x, max_y, roof_z)
    nw = (min_x, max_y, roof_z)
    if wing["ridgeAxis"] == "x":
        mid_y = (min_y + max_y) / 2
        rw = (min_x, mid_y, ridge_z)
        re = (max_x, mid_y, ridge_z)
        return [
            [sw, se, re, rw],
            [ne, nw, rw, re],
            [nw, sw, rw],
            [se, ne, re],
        ]
    else:
        mid_x = (min_x + max_x) / 2
        rs = (mid_x, min_y, ridge_z)
        rn = (mid_x, max_y, ridge_z)
        return [
            [se, ne, rn, rs],
            [nw, sw, rs, rn],
            [sw, se, rs],
            [ne, nw, rn],
        ]


def _cross_gable_two_wings_polys(
    dom: dict, sec: dict, attach: str, roof_z: float, ridge_z: float
) -> list[list[tuple[float, float, float]]]:
    """Cross-gable junction: dom wing's ridge dominates; sec wing's ridge
    extends to meet it, valley-cutting dom's slope on the attachment side.

    Assumes:
    - dom and sec have perpendicular ridge axes
    - sec attaches to one of dom's slope sides (a non-gable side):
      attach='east'/'west' when dom.ridgeAxis='y', or
      attach='north'/'south' when dom.ridgeAxis='x'
    - sec.mid (along its ridge) lies within dom's range (slopes intersect cleanly)

    Returns face polygons (each a list of (x,y,z) tuples)."""

    # Canonicalize: rotate world so dom has ridge axis 'y' and sec attaches 'east'.
    # We work in (u, v, z) where u = along dom's ridge, v = perpendicular (toward
    # the eaves), and z = vertical. Then transform back at emit time.
    if dom["ridgeAxis"] == "y":
        if attach == "east":
            to_world = lambda u, v, z: (v, u, z)   # u→y, v→x
            inv_v = False
        elif attach == "west":
            to_world = lambda u, v, z: (-v, u, z)
            inv_v = True
        else:
            raise ValueError(f"bad attach {attach} for dom ridge y")
        dom_u_min, dom_u_max = dom["minY"], dom["maxY"]
        dom_v_min, dom_v_max = dom["minX"], dom["maxX"]
        dom_v_mid = (dom_v_min + dom_v_max) / 2
        sec_u_mid = (sec["minY"] + sec["maxY"]) / 2
        sec_u_min, sec_u_max = sec["minY"], sec["maxY"]
        if attach == "east":
            sec_v_min, sec_v_max = sec["minX"], sec["maxX"]  # v in [v_min, v_max], v_min == dom_v_max
        else:
            sec_v_min, sec_v_max = -sec["maxX"], -sec["minX"]
    else:
        # dom ridge axis 'x'
        if attach == "north":
            to_world = lambda u, v, z: (u, v, z)   # u→x, v→y
            inv_v = False
        elif attach == "south":
            to_world = lambda u, v, z: (u, -v, z)
            inv_v = True
        else:
            raise ValueError(f"bad attach {attach} for dom ridge x")
        dom_u_min, dom_u_max = dom["minX"], dom["maxX"]
        dom_v_min, dom_v_max = dom["minY"], dom["maxY"]
        dom_v_mid = (dom_v_min + dom_v_max) / 2
        sec_u_mid = (sec["minX"] + sec["maxX"]) / 2
        sec_u_min, sec_u_max = sec["minX"], sec["maxX"]
        if attach == "north":
            sec_v_min, sec_v_max = sec["minY"], sec["maxY"]
        else:
            sec_v_min, sec_v_max = -sec["maxY"], -sec["minY"]
    # In canonical coords: dom's "east" side is at v = dom_v_max (the high-v eave).
    # sec sits at v ∈ [dom_v_max, sec_v_max], u ∈ [sec_u_min, sec_u_max].

    # Valley apex = where sec's extended ridge meets dom's ridge.
    apex = (sec_u_mid, dom_v_mid, ridge_z)

    # Vertices in canonical coords
    # dom corners
    d_sw = (dom_u_min, dom_v_min, roof_z)
    d_se = (dom_u_min, dom_v_max, roof_z)
    d_ne = (dom_u_max, dom_v_max, roof_z)
    d_nw = (dom_u_max, dom_v_min, roof_z)
    d_rs = (dom_u_min, dom_v_mid, ridge_z)   # south end of dom's ridge
    d_rn = (dom_u_max, dom_v_mid, ridge_z)   # north end of dom's ridge
    # sec corners (on the v > dom_v_max side)
    s_low_inner = (sec_u_min, dom_v_max, roof_z)   # corner where sec's south eave meets dom
    s_high_inner = (sec_u_max, dom_v_max, roof_z)  # corner where sec's north eave meets dom
    s_low_outer = (sec_u_min, sec_v_max, roof_z)
    s_high_outer = (sec_u_max, sec_v_max, roof_z)
    s_ridge_outer = (sec_u_mid, sec_v_max, ridge_z)

    eps = 1e-4
    def _eq(p, q):
        return abs(p[0] - q[0]) < eps and abs(p[1] - q[1]) < eps and abs(p[2] - q[2]) < eps
    def _dedup(poly):
        out = []
        for p in poly:
            if not out or not _eq(p, out[-1]):
                out.append(p)
        if len(out) >= 2 and _eq(out[0], out[-1]):
            out.pop()
        return out

    polys = []

    # --- Dom faces ---
    # West slope (unchanged): from west eave (v = dom_v_min) up to ridge
    polys.append([d_sw, d_nw, d_rn, d_rs])
    # South gable triangle (unchanged)
    polys.append([d_sw, d_se, d_rs])
    # North gable triangle (unchanged)
    polys.append([d_ne, d_nw, d_rn])
    # East slope (attached side): V-cut around apex.
    # South piece: south end of east eave → valley start → apex → south ridge end
    polys.append([d_se, s_low_inner, apex, d_rs])
    # North piece: north ridge end → apex → valley end → north corner
    polys.append([d_rn, apex, s_high_inner, d_ne])

    # --- Sec faces ---
    # South slope trapezoid: outer eave south end → inner eave south corner → apex → outer ridge end
    polys.append([s_low_outer, s_low_inner, apex, s_ridge_outer])
    # North slope trapezoid: outer eave north end → outer ridge end → apex → inner eave north corner
    polys.append([s_high_outer, s_ridge_outer, apex, s_high_inner])
    # Sec's outer gable (away from dom): triangle
    polys.append([s_low_outer, s_high_outer, s_ridge_outer])
    # NO inner gable — replaced by the valley.

    # Drop polygons that collapsed (e.g., when sec is flush with one of dom's gable ends)
    polys = [p for p in (_dedup(pp) for pp in polys) if len(p) >= 3]

    # Transform back to world coords
    return [[to_world(*p) for p in poly] for poly in polys]


def _add_wing_pitched_faces(
    faces: list,
    wings: list[dict],
    roof_base_z: float,
    ridge_height: float,
    style: str,
) -> None:
    """Per-wing gabled roof — single wing OR 2-wing cross-gable with valley.

    For >2 wings or same-axis 2-wing pairs (extension/colinear), falls back
    to independent prisms (one full pitched per wing). This may produce
    visual artifacts at junctions but keeps the topology closed."""
    ridge_z = roof_base_z + ridge_height
    polys: list[list[tuple[float, float, float]]] = []

    if len(wings) == 2:
        w1, w2 = wings
        attach_from_w1 = _find_attachment(w1, w2)
        # Choose dominant: longer ridge dimension wins
        if _wing_long_dim(w1) >= _wing_long_dim(w2):
            dom, sec = w1, w2
            attach = attach_from_w1
        else:
            dom, sec = w2, w1
            attach = _find_attachment(dom, sec)
        if (
            attach is not None
            and dom["ridgeAxis"] != sec["ridgeAxis"]
            and (
                (dom["ridgeAxis"] == "y" and attach in ("east", "west"))
                or (dom["ridgeAxis"] == "x" and attach in ("north", "south"))
            )
        ):
            # Verify sec's ridge mid lies within dom's range (valley apex makes sense)
            if dom["ridgeAxis"] == "y":
                sec_u_mid = (sec["minY"] + sec["maxY"]) / 2
                if dom["minY"] <= sec_u_mid <= dom["maxY"]:
                    polys = _cross_gable_two_wings_polys(dom, sec, attach, roof_base_z, ridge_z)
            else:
                sec_u_mid = (sec["minX"] + sec["maxX"]) / 2
                if dom["minX"] <= sec_u_mid <= dom["maxX"]:
                    polys = _cross_gable_two_wings_polys(dom, sec, attach, roof_base_z, ridge_z)

    if not polys:
        for wing in wings:
            polys.extend(_single_wing_pitched_polys(wing, roof_base_z, ridge_z))

    for poly in polys:
        verts = [Vertex.ByCoordinates(*p) for p in poly]
        f = Face.ByVertices(verts)
        f.Set("stylename", style)
        faces.append(f)


def _add_wing_hip_faces(
    faces: list,
    wings: list[dict],
    roof_base_z: float,
    ridge_height: float,
    style: str,
) -> None:
    """Per-wing hipped roof. Square wings become pyramids."""
    ridge_z = roof_base_z + ridge_height

    for wing in wings:
        min_x, max_x = wing["minX"], wing["maxX"]
        min_y, max_y = wing["minY"], wing["maxY"]
        w = max_x - min_x
        d = max_y - min_y
        cx = (min_x + max_x) / 2
        cy = (min_y + max_y) / 2

        v_sw = Vertex.ByCoordinates(min_x, min_y, roof_base_z)
        v_se = Vertex.ByCoordinates(max_x, min_y, roof_base_z)
        v_ne = Vertex.ByCoordinates(max_x, max_y, roof_base_z)
        v_nw = Vertex.ByCoordinates(min_x, max_y, roof_base_z)

        if abs(w - d) < 0.01:
            apex = Vertex.ByCoordinates(cx, cy, ridge_z)
            new_faces = [
                Face.ByVertices([v_sw, v_se, apex]),
                Face.ByVertices([v_se, v_ne, apex]),
                Face.ByVertices([v_ne, v_nw, apex]),
                Face.ByVertices([v_nw, v_sw, apex]),
            ]
        elif wing["ridgeAxis"] == "x":
            half = (w - d) / 2
            r_w = Vertex.ByCoordinates(cx - half, cy, ridge_z)
            r_e = Vertex.ByCoordinates(cx + half, cy, ridge_z)
            new_faces = [
                Face.ByVertices([v_sw, v_se, r_e, r_w]),
                Face.ByVertices([v_ne, v_nw, r_w, r_e]),
                Face.ByVertices([v_nw, v_sw, r_w]),
                Face.ByVertices([v_se, v_ne, r_e]),
            ]
        else:
            half = (d - w) / 2
            r_s = Vertex.ByCoordinates(cx, cy - half, ridge_z)
            r_n = Vertex.ByCoordinates(cx, cy + half, ridge_z)
            new_faces = [
                Face.ByVertices([v_se, v_ne, r_n, r_s]),
                Face.ByVertices([v_nw, v_sw, r_s, r_n]),
                Face.ByVertices([v_sw, v_se, r_s]),
                Face.ByVertices([v_ne, v_nw, r_n]),
            ]

        for f in new_faces:
            f.Set("stylename", style)
            faces.append(f)


def _wing_slab_face(wing: dict, z: float, style: str):
    """Build a single rectangular slab face for one wing at height z."""
    f = Face.ByVertices([
        Vertex.ByCoordinates(wing["minX"], wing["minY"], z),
        Vertex.ByCoordinates(wing["maxX"], wing["minY"], z),
        Vertex.ByCoordinates(wing["maxX"], wing["maxY"], z),
        Vertex.ByCoordinates(wing["minX"], wing["maxY"], z),
    ])
    f.Set("stylename", style)
    return f


def build_faces(
    footprint: list[tuple[float, float]],
    storeys: int,
    storey_heights: list[float],
    style: str,
    roof: str,
    ridge_height: float,
    holes: list[list[tuple[float, float]]] = (),
) -> list:
    """Build the topologic Face list that Molior consumes.

    `storey_heights` is a list of per-storey heights (bottom-up). Its
    length must be ≥ storeys; only the first `storeys` entries are used.

    Plain (no-hole) buildings: walls along outer ring, single slab faces
    per storey, roof per the standard pipeline.

    Courtyard (with holes): walls along outer ring AND each inner ring,
    slab faces decomposed into wings (because topologic Face.ByVertices
    can't represent a polygon-with-hole), per-wing roof for pitched/hip.
    """
    n = len(footprint)
    if n < 3:
        raise ValueError("footprint needs at least 3 points")

    has_holes = bool(holes)
    wings = decompose_into_wings(footprint, holes) if has_holes else None

    # Cumulative z at each storey level: level_z[s] = sum of heights below s
    level_z = [0.0]
    for s in range(storeys):
        level_z.append(level_z[-1] + storey_heights[s])

    # Outer-ring vertices per storey level (0..storeys inclusive)
    outer_verts: list[list] = []
    for s in range(storeys + 1):
        z = level_z[s]
        outer_verts.append([Vertex.ByCoordinates(x, y, z) for (x, y) in footprint])

    # Hole-ring vertices per storey level, per hole
    hole_verts: list[list[list]] = []
    if has_holes:
        for s in range(storeys + 1):
            z = level_z[s]
            hole_verts.append([
                [Vertex.ByCoordinates(x, y, z) for (x, y) in hole]
                for hole in holes
            ])

    faces: list = []
    for s in range(storeys):
        # Floor slab(s) for this storey
        if has_holes:
            for w in wings:
                faces.append(_wing_slab_face(w, level_z[s], style))
        else:
            f = Face.ByVertices(outer_verts[s])
            f.Set("stylename", style)
            faces.append(f)

        # Outer walls (CCW around footprint → outward normal)
        bottom, top = outer_verts[s], outer_verts[s + 1]
        for i in range(n):
            j = (i + 1) % n
            w = Face.ByVertices([bottom[i], bottom[j], top[j], top[i]])
            w.Set("stylename", style)
            faces.append(w)

        # Inner walls along each hole (hole is CW → outward normal points
        # into the courtyard, which is exactly what we want)
        if has_holes:
            for h_idx, hole in enumerate(holes):
                h_bot = hole_verts[s][h_idx]
                h_top = hole_verts[s + 1][h_idx]
                n_h = len(hole)
                for i in range(n_h):
                    j = (i + 1) % n_h
                    wf = Face.ByVertices([h_bot[i], h_bot[j], h_top[j], h_top[i]])
                    wf.Set("stylename", style)
                    faces.append(wf)

    top_verts = outer_verts[storeys]
    roof_base_z = level_z[storeys]

    if roof in ("pitched", "hip"):
        if has_holes:
            if roof == "pitched":
                _add_wing_pitched_faces(faces, wings, roof_base_z, ridge_height, style)
            else:
                _add_wing_hip_faces(faces, wings, roof_base_z, ridge_height, style)
        elif n == 4 and roof == "pitched":
            _add_rect_pitched_faces(
                faces, top_verts, footprint, roof_base_z, ridge_height, style
            )
        else:
            sub_wings = decompose_into_wings(footprint)
            if roof == "pitched":
                _add_wing_pitched_faces(faces, sub_wings, roof_base_z, ridge_height, style)
            else:
                _add_wing_hip_faces(faces, sub_wings, roof_base_z, ridge_height, style)
    else:
        if has_holes:
            for w in wings:
                faces.append(_wing_slab_face(w, roof_base_z, style))
        else:
            f = Face.ByVertices(top_verts)
            f.Set("stylename", style)
            faces.append(f)

    return faces


def build_widgets(
    footprint: list[tuple[float, float]],
    storeys: int,
    storey_heights: list[float],
    rooms: list[dict],
    holes: list[list[tuple[float, float]]] = (),
) -> list:
    """Build room-widget vertices. For plain buildings, one widget per
    storey at the footprint centroid. For courtyards, one widget per wing
    per storey (centroid is in the void and can't be used)."""
    if not rooms:
        return []

    level_z = [0.0]
    for s in range(storeys):
        level_z.append(level_z[-1] + storey_heights[s])

    out = []

    if holes:
        wings = decompose_into_wings(footprint, holes)
        for s in range(storeys):
            usage = rooms[s % len(rooms)]["type"]
            z = level_z[s] + 1.5
            for w in wings:
                cx = (w["minX"] + w["maxX"]) / 2
                cy = (w["minY"] + w["maxY"]) / 2
                v = Vertex.ByCoordinates(cx, cy, z)
                v.Set("usage", usage)
                out.append(v)
        return out

    cx = sum(p[0] for p in footprint) / len(footprint)
    cy = sum(p[1] for p in footprint) / len(footprint)
    for s in range(storeys):
        usage = rooms[s % len(rooms)]["type"]
        z = level_z[s] + 1.5
        v = Vertex.ByCoordinates(cx, cy, z)
        v.Set("usage", usage)
        out.append(v)
    return out


# ── IFC -> glTF ─────────────────────────────────────────────────────────


def _color_tuple(material) -> tuple[float, float, float, float]:
    """Extract RGBA (with transparency) from an ifcopenshell geom material."""
    try:
        d = material.diffuse
        r, g, b = d.r(), d.g(), d.b()
    except Exception:
        r, g, b = 0.85, 0.85, 0.85
    try:
        alpha = 1.0 - float(material.transparency or 0.0)
    except Exception:
        alpha = 1.0
    return (r, g, b, max(0.0, min(1.0, alpha)))


# Window: dark tinted glossy glass. Frame+mullions+pane all share this
# look — the geometric relief of mullions is what gives "windowness."
# Metallic is kept low so it stays a dielectric (correct Fresnel for glass),
# but envMapIntensity is bumped on the JS side so HDRI reflections show.
_WINDOW_OVERRIDE = {
    "color": (0.07, 0.10, 0.14, 0.88),  # very dark slate-blue, mostly opaque
    "metallic": 0.05,
    "roughness": 0.03,                  # very glossy → mirror-like reflections
}
_DOOR_OVERRIDE = {
    "color": (0.33, 0.20, 0.12, 1.0),   # dark walnut
    "metallic": 0.0,
    "roughness": 0.55,
}


def _hex_to_rgba(hex_str: str) -> tuple[float, float, float, float]:
    """Parse a '#RRGGBB' hex into an (r,g,b,1.0) tuple in 0..1 floats.
    Invalid input returns the warm-earthy-gray default."""
    try:
        s = hex_str.lstrip("#")
        if len(s) == 6:
            r = int(s[0:2], 16) / 255.0
            g = int(s[2:4], 16) / 255.0
            b = int(s[4:6], 16) / 255.0
            return (r, g, b, 1.0)
    except Exception:
        pass
    return (0.78, 0.74, 0.66, 1.0)


def ifc_to_glb(
    ifc_file: ifcopenshell.file,
    wall_color: tuple | None = None,
    roof_color: tuple | None = None,
) -> bytes:
    """Convert an in-memory IFC file to a binary glTF (.glb) byte string.

    Strategy: iterate IFC geometry, group triangles by material name, emit
    one glTF primitive per unique material. Apply a node transform to flip
    Z-up (IFC) to Y-up (glTF/THREE).

    Windows and doors get a hard color override: Molior assigns the same
    light-gray material to wall and window/door surfaces, so they visually
    blend into one box. We re-bucket those elements under dedicated
    homemaker:window / homemaker:door materials with a clearly different
    color, so the user sees windows-set-in-walls rather than a flat slab."""

    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)

    # Thread count for the parallel triangulators. On Vercel Fluid Compute,
    # multiprocessing.cpu_count() returns the underlying *host* core count
    # (16-32 on AWS), but a 4 GB function only gets ~2 vCPU of actual compute.
    # Oversubscribing threads creates scheduling overhead with zero speed-up.
    # 4 is a sweet spot for both the 8-core dev MBP and the 4 GB Vercel tier.
    GEOM_THREADS = int(os.environ.get("HOMEMAKER_GEOM_THREADS", "4"))

    # Precompute each wall's thin axis (the wall-normal direction in world
    # coords), centerline coordinate, thickness, and per-axis ext_sign
    # (+1 if exterior face is on the +axis side of the building centroid,
    # -1 otherwise). We use this to scale IfcWindow/IfcDoor meshes inside
    # the wall plane and to position the glass quad behind the mullions.
    #
    # We triangulate walls via the parallel ifcopenshell.geom.iterator with
    # include=("IfcWall",) — much faster than sequential create_shape calls.
    wall_data: dict = {}  # wall.GlobalId -> (thin_axis, center, thickness, ext_sign)
    _wall_raw: list = []  # (guid, thin, center, thickness)
    _wall_it = ifcopenshell.geom.iterator(
        settings, ifc_file, GEOM_THREADS, include=("IfcWall",),
    )
    if _wall_it.initialize():
        while True:
            _ws = _wall_it.get()
            wv = np.asarray(_ws.geometry.verts, dtype=np.float32).reshape(-1, 3)
            if wv.size > 0:
                bb_lo = wv.min(axis=0)
                bb_hi = wv.max(axis=0)
                e = bb_hi - bb_lo
                thin = int(np.argmin(e))
                center = float((bb_lo[thin] + bb_hi[thin]) / 2.0)
                thickness = float(bb_hi[thin] - bb_lo[thin])
                _wall_raw.append((_ws.guid, thin, center, thickness))
            if not _wall_it.next():
                break

    axis_means: dict = {}
    for _, t, c, _t in _wall_raw:
        axis_means.setdefault(t, []).append(c)
    axis_means = {a: float(np.mean(vs)) for a, vs in axis_means.items()}

    for guid, thin, center, thickness in _wall_raw:
        ext_sign = 1.0 if center > axis_means.get(thin, center) else -1.0
        wall_data[guid] = (thin, center, thickness, ext_sign)

    def _find_parent_wall_info(elem):
        """Walk Window/Door → IfcRelFillsElement → Opening → IfcRelVoidsElement → Wall."""
        try:
            for rel in ifc_file.get_inverse(elem):
                if rel.is_a("IfcRelFillsElement"):
                    opening = rel.RelatingOpeningElement
                    if opening is None:
                        continue
                    for rel2 in ifc_file.get_inverse(opening):
                        if rel2.is_a("IfcRelVoidsElement"):
                            w = rel2.RelatingBuildingElement
                            if w and w.GlobalId in wall_data:
                                return wall_data[w.GlobalId]
        except Exception:
            pass
        return None

    # Skip auxiliary / non-visible entities. IfcWindow / IfcDoor are kept
    # and scaled below so Molior's full mullion/sash detail is preserved
    # but no longer protrudes past the wall.
    it = ifcopenshell.geom.iterator(
        settings,
        ifc_file,
        GEOM_THREADS,
        exclude=(
            "IfcOpeningElement",
            "IfcStructuralSurfaceMember",
            "IfcSpace",
            "IfcBuilding",
        ),
    )
    if not it.initialize():
        raise RuntimeError("no geometry in IFC")

    mat_buckets: dict[str, dict] = {}
    while True:
        shape = it.get()
        geom = shape.geometry

        verts = np.asarray(geom.verts, dtype=np.float32).reshape(-1, 3)
        faces = np.asarray(geom.faces, dtype=np.uint32).reshape(-1, 3)
        materials = list(geom.materials)
        face_mat = np.asarray(geom.material_ids, dtype=np.int32)

        # Build per-material-index overrides for this element. For windows
        # we ALSO set up a per-triangle classifier (`window_classify`) to
        # split the mesh into GLASS (large, square-ish, wall-normal-facing
        # tris) and FRAME/MULLIONS (everything else). The aspect-ratio
        # check is what reliably excludes mullion bar front faces, which
        # are large+flat but extremely elongated.
        material_overrides: dict = {}
        window_classify: tuple | None = None
        try:
            elem = ifc_file.by_guid(shape.guid)
            n_mats = len(materials)
            if elem.is_a("IfcWindow"):
                frame_color = wall_color if wall_color is not None else (0.78, 0.74, 0.66, 1.0)
                info = _find_parent_wall_info(elem)
                if info is not None:
                    window_classify = (
                        info[0],  # thin axis (= wall normal)
                        ("homemaker:window",
                         _WINDOW_OVERRIDE["color"],
                         _WINDOW_OVERRIDE["metallic"],
                         _WINDOW_OVERRIDE["roughness"]),
                        ("homemaker:window-frame", frame_color, 0.0, 0.85),
                    )
                else:
                    # No parent wall — fall back to single-bucket painted frame
                    for mi in range(n_mats):
                        material_overrides[mi] = (
                            "homemaker:window-frame", frame_color, 0.0, 0.85,
                        )
            elif elem.is_a("IfcDoor"):
                for mi in range(n_mats):
                    material_overrides[mi] = (
                        "homemaker:door",
                        _DOOR_OVERRIDE["color"],
                        _DOOR_OVERRIDE["metallic"],
                        _DOOR_OVERRIDE["roughness"],
                    )
            elif elem.is_a("IfcWall") and wall_color is not None:
                for mi in range(n_mats):
                    material_overrides[mi] = (
                        "homemaker:wall",
                        wall_color,
                        0.0,
                        0.85,
                    )
            elif (
                roof_color is not None
                and elem.is_a("IfcRoof")
                and (elem.Name or "") == "pitched-roof"
            ):
                # The main visible roof slope (gray default). Re-paint as
                # terracotta or slate per user choice. Keep brackets/decor
                # ('brackets' etc.) using their own materials.
                for mi in range(n_mats):
                    material_overrides[mi] = (
                        "homemaker:roof",
                        roof_color,
                        0.0,
                        0.75,
                    )
            elif (
                roof_color is not None
                and elem.is_a("IfcCovering")
                and (elem.Name or "") == "eaves tiles"
            ):
                # The orange tile edge strip at the eaves. Match it to the
                # roof slope color so the roof reads as one material.
                for mi in range(n_mats):
                    material_overrides[mi] = (
                        "homemaker:roof",
                        roof_color,
                        0.0,
                        0.75,
                    )
        except Exception:
            elem = None

        # Cap window exterior protrusion. Molior places windows with their
        # interior face ~3cm inside the wall (fine), and the exterior face
        # varies by style:
        #   default → 5cm proud (a normal projecting sash frame, leave alone)
        #   fancy   → 23cm proud (decorative surround — reads as a "cabinet"
        #             stuck to the wall in a 3D viewer; needs to be tamed
        #             while keeping the silhouette).
        # Strategy: pin the wall's exterior face, then linearly compress only
        # the verts on the exterior side so the max protrusion equals
        # MAX_EXT_PROTRUSION. Interior placement is left untouched.
        if elem is not None and elem.is_a("IfcWindow"):
            info = _find_parent_wall_info(elem)
            if info is not None and verts.size:
                thin_axis, wall_center, wall_thickness, ext_sign = info
                wall_ext_face = wall_center + ext_sign * (wall_thickness / 2.0)
                # offset_ext: meters past the wall exterior face (positive = sticking out)
                offset_ext = (verts[:, thin_axis] - wall_ext_face) * ext_sign
                is_exterior = offset_ext > 0.0
                if is_exterior.any():
                    curr_ext = float(offset_ext[is_exterior].max())
                    MAX_EXT_PROTRUSION = 0.05  # cap at ~5cm; thin proud frame, no "cabinet" effect
                    if curr_ext > MAX_EXT_PROTRUSION:
                        scale = MAX_EXT_PROTRUSION / curr_ext
                        verts = verts.copy()
                        # Compress only verts past the ext face; pin everything inside the wall.
                        delta = verts[:, thin_axis] - wall_ext_face
                        verts[is_exterior, thin_axis] = (
                            wall_ext_face + delta[is_exterior] * scale
                        )

        if window_classify is not None and faces.shape[0] > 0:
            # Drop Molior's flat front-panel tris (the ones that would paint
            # AS glass at whatever Y position Molior chose). Why drop instead
            # of route-to-glass-bucket? Because Molior places those panes near
            # the EXTERIOR side of the window mesh — in front of the sash
            # bars — so painting them dark would put glass IN FRONT of the
            # mullions. We want bars in front of glass, like a real window.
            # Instead we emit a single synthesized dark glass quad set back
            # behind everything (further down in this function).
            #
            # Classifier: wall-normal-facing (align>0.9) + low aspect ratio
            # (<5; excludes mullion bar fronts which are 1.8m × 0.04m strips).
            # The area threshold catches both big rectangular panes (default
            # sash: ~0.4 m² half-tri) and the small triangulated arches at the
            # top of `sash_tall_arched` style windows (~0.01 m² near-square tris).
            thin_axis_v, _glass_spec, frame_spec = window_classify
            tri_v = verts[faces]
            e1 = tri_v[:, 1, :] - tri_v[:, 0, :]
            e2 = tri_v[:, 2, :] - tri_v[:, 0, :]
            e3 = tri_v[:, 2, :] - tri_v[:, 1, :]
            cross = np.cross(e1, e2)
            cross_len = np.linalg.norm(cross, axis=1)
            areas = 0.5 * cross_len
            safe = cross_len > 1e-9
            normals = np.zeros_like(cross)
            normals[safe] = cross[safe] / cross_len[safe, None]
            align = np.abs(normals[:, thin_axis_v])
            e1l = np.linalg.norm(e1, axis=1)
            e2l = np.linalg.norm(e2, axis=1)
            e3l = np.linalg.norm(e3, axis=1)
            edges = np.stack([e1l, e2l, e3l], axis=1)
            aspect = edges.max(axis=1) / (edges.min(axis=1) + 1e-9)
            drop_mask = (align > 0.9) & (areas > 0.005) & (aspect < 5.0)
            keep_mask = ~drop_mask

            if keep_mask.any():
                tri = faces[keep_mask]
                name, color, ov_metallic, ov_roughness = frame_spec
                bucket = mat_buckets.setdefault(
                    name,
                    {
                        "color": color,
                        "metallic": ov_metallic,
                        "roughness": ov_roughness,
                        "verts": [],
                        "faces": [],
                        "v_offset": 0,
                    },
                )
                used = np.unique(tri)
                remap = np.full(verts.shape[0], -1, dtype=np.int32)
                remap[used] = np.arange(used.size, dtype=np.int32) + bucket["v_offset"]
                bucket["verts"].append(verts[used])
                bucket["faces"].append(remap[tri])
                bucket["v_offset"] += used.size
        else:
            for mi, material in enumerate(materials):
                mask = face_mat == mi
                if not mask.any():
                    continue
                tri = faces[mask]

                if mi in material_overrides:
                    name, color, ov_metallic, ov_roughness = material_overrides[mi]
                else:
                    name = material.name or "default"
                    color = _color_tuple(material)
                    ov_metallic = None
                    ov_roughness = None

                bucket = mat_buckets.setdefault(
                    name,
                    {
                        "color": color,
                        "metallic": ov_metallic,
                        "roughness": ov_roughness,
                        "verts": [],
                        "faces": [],
                        "v_offset": 0,
                    },
                )

                used = np.unique(tri)
                remap = np.full(verts.shape[0], -1, dtype=np.int32)
                remap[used] = np.arange(used.size, dtype=np.int32) + bucket["v_offset"]
                bucket["verts"].append(verts[used])
                bucket["faces"].append(remap[tri])
                bucket["v_offset"] += used.size

        if not it.next():
            break

    # Emit one flat dark-glass quad per window opening, set BEHIND the
    # sash/mullion 3D relief so the bars visually sit in front of the glass.
    # Sized to the IfcOpeningElement bbox (which captures the full arched
    # outline for `sash_tall_arched` windows too), inset 4cm so the frame
    # edge isn't covered. Positioned at 50% of wall-thickness toward the
    # interior side, well past the back of the mullion mesh.
    glass_verts: list = []
    glass_faces: list = []
    # Triangulate all openings in parallel up front, then walk them
    # serially with their bboxes already cached. Faster than 36 sequential
    # create_shape() calls in a Python loop.
    opening_bboxes: dict = {}  # opening.GlobalId -> (bb_lo, bb_hi)
    _op_it = ifcopenshell.geom.iterator(
        settings, ifc_file, GEOM_THREADS, include=("IfcOpeningElement",),
    )
    if _op_it.initialize():
        while True:
            _os = _op_it.get()
            v_o = np.asarray(_os.geometry.verts, dtype=np.float32).reshape(-1, 3)
            if v_o.size > 0:
                opening_bboxes[_os.guid] = (v_o.min(axis=0), v_o.max(axis=0))
            if not _op_it.next():
                break

    for opening in ifc_file.by_type("IfcOpeningElement"):
        if opening.GlobalId not in opening_bboxes:
            continue
        parent_wall_guid = None
        is_window = False
        try:
            for rel in ifc_file.get_inverse(opening):
                if rel.is_a("IfcRelVoidsElement") and rel.RelatingBuildingElement:
                    parent_wall_guid = rel.RelatingBuildingElement.GlobalId
                elif rel.is_a("IfcRelFillsElement"):
                    f = rel.RelatedBuildingElement
                    if f and f.is_a("IfcWindow"):
                        is_window = True
        except Exception:
            pass
        if not is_window or not parent_wall_guid or parent_wall_guid not in wall_data:
            continue
        thin_axis, wall_center, wall_thickness, ext_sign = wall_data[parent_wall_guid]
        # Glass plane sits ~halfway between wall center and interior face —
        # comfortably behind any mullion bar that crosses the wall centerline.
        glass_y = wall_center + (-ext_sign) * (wall_thickness * 0.40)
        a1 = (thin_axis + 1) % 3
        a2 = (thin_axis + 2) % 3
        bb_lo, bb_hi = opening_bboxes[opening.GlobalId]
        INSET = 0.04
        lo_a1, hi_a1 = float(bb_lo[a1]) + INSET, float(bb_hi[a1]) - INSET
        lo_a2, hi_a2 = float(bb_lo[a2]) + INSET, float(bb_hi[a2]) - INSET
        if hi_a1 - lo_a1 <= 0 or hi_a2 - lo_a2 <= 0:
            continue

        def _corner(p1, p2):
            c = np.zeros(3, dtype=np.float32)
            c[thin_axis] = glass_y
            c[a1] = p1
            c[a2] = p2
            return c

        q0 = _corner(lo_a1, lo_a2)
        q1 = _corner(hi_a1, lo_a2)
        q2 = _corner(hi_a1, hi_a2)
        q3 = _corner(lo_a1, hi_a2)
        off = len(glass_verts)
        glass_verts.extend([q0, q1, q2, q3])
        glass_faces.extend([[off, off + 1, off + 2], [off, off + 2, off + 3]])

    if glass_verts:
        mat_buckets["homemaker:window"] = {
            "color": _WINDOW_OVERRIDE["color"],
            "metallic": _WINDOW_OVERRIDE["metallic"],
            "roughness": _WINDOW_OVERRIDE["roughness"],
            "verts": [np.asarray(glass_verts, dtype=np.float32)],
            "faces": [np.asarray(glass_faces, dtype=np.uint32)],
            "v_offset": len(glass_verts),
        }

    # Build glTF
    bin_chunks: list[bytes] = []
    accessors: list[pygltflib.Accessor] = []
    buffer_views: list[pygltflib.BufferView] = []
    materials_gltf: list[pygltflib.Material] = []
    primitives: list[pygltflib.Primitive] = []
    offset = 0

    for name, bucket in mat_buckets.items():
        if not bucket["verts"]:
            continue
        v = np.concatenate(bucket["verts"]).astype(np.float32)
        f = np.concatenate(bucket["faces"]).astype(np.uint32).reshape(-1)

        v_bytes = v.tobytes()
        f_bytes = f.tobytes()

        # Pad to 4-byte alignment between chunks
        def _pad(b: bytes) -> bytes:
            pad = (-len(b)) % 4
            return b + b"\x00" * pad

        v_padded = _pad(v_bytes)
        f_padded = _pad(f_bytes)

        bin_chunks.append(v_padded)
        v_view_idx = len(buffer_views)
        buffer_views.append(
            pygltflib.BufferView(
                buffer=0,
                byteOffset=offset,
                byteLength=len(v_bytes),
                target=pygltflib.ARRAY_BUFFER,
            )
        )
        offset += len(v_padded)

        bin_chunks.append(f_padded)
        f_view_idx = len(buffer_views)
        buffer_views.append(
            pygltflib.BufferView(
                buffer=0,
                byteOffset=offset,
                byteLength=len(f_bytes),
                target=pygltflib.ELEMENT_ARRAY_BUFFER,
            )
        )
        offset += len(f_padded)

        v_acc_idx = len(accessors)
        accessors.append(
            pygltflib.Accessor(
                bufferView=v_view_idx,
                componentType=pygltflib.FLOAT,
                count=v.shape[0],
                type=pygltflib.VEC3,
                min=v.min(axis=0).tolist(),
                max=v.max(axis=0).tolist(),
            )
        )

        f_acc_idx = len(accessors)
        accessors.append(
            pygltflib.Accessor(
                bufferView=f_view_idx,
                componentType=pygltflib.UNSIGNED_INT,
                count=f.size,
                type=pygltflib.SCALAR,
            )
        )

        r, g, b, a = bucket["color"]
        metallic = bucket.get("metallic")
        if metallic is None:
            metallic = 0.0
        roughness = bucket.get("roughness")
        if roughness is None:
            roughness = 0.85
        mat_idx = len(materials_gltf)
        materials_gltf.append(
            pygltflib.Material(
                name=name,
                pbrMetallicRoughness=pygltflib.PbrMetallicRoughness(
                    baseColorFactor=[r, g, b, a],
                    metallicFactor=float(metallic),
                    roughnessFactor=float(roughness),
                ),
                alphaMode="BLEND" if a < 0.999 else "OPAQUE",
                doubleSided=True,
            )
        )

        primitives.append(
            pygltflib.Primitive(
                attributes=pygltflib.Attributes(POSITION=v_acc_idx),
                indices=f_acc_idx,
                material=mat_idx,
                mode=pygltflib.TRIANGLES,
            )
        )

    if not primitives:
        raise RuntimeError("no primitives generated")

    bin_blob = b"".join(bin_chunks)

    # Quaternion for -90° around X: (sin(-45°), 0, 0, cos(-45°))
    s, c = math.sin(-math.pi / 4), math.cos(-math.pi / 4)
    rot_x_minus_90 = [s, 0.0, 0.0, c]

    gltf = pygltflib.GLTF2(
        asset=pygltflib.Asset(generator="homemaker-ui/generate.py"),
        scene=0,
        scenes=[pygltflib.Scene(nodes=[0])],
        nodes=[pygltflib.Node(mesh=0, rotation=rot_x_minus_90)],
        meshes=[pygltflib.Mesh(primitives=primitives)],
        accessors=accessors,
        bufferViews=buffer_views,
        materials=materials_gltf,
        buffers=[pygltflib.Buffer(byteLength=len(bin_blob))],
    )
    gltf.set_binary_blob(bin_blob)
    return b"".join(gltf.save_to_bytes())


# ── Entry point ─────────────────────────────────────────────────────────


def build_and_export_glb(params: dict) -> bytes:
    """Public entry: run the full pipeline on a params dict, return glb bytes."""
    footprint = [tuple(p) for p in params["footprint"]]
    raw_holes = params.get("holes") or []
    holes = [[tuple(p) for p in hole] for hole in raw_holes]
    storeys = int(params.get("storeys", 2))
    storey_height = float(params.get("storeyHeight", 3.0))
    raw_heights = params.get("storeyHeights")
    if raw_heights and isinstance(raw_heights, list) and len(raw_heights) >= storeys:
        storey_heights = [float(h) for h in raw_heights[:storeys]]
    else:
        storey_heights = [storey_height] * storeys
    style = params.get("style", "default")
    roof = params.get("roof", "flat")
    ridge_height = float(params.get("ridgeHeight", 3.0))
    rooms = params.get("rooms", [])

    wall_color_hex = params.get("wallColor")
    wall_color = _hex_to_rgba(wall_color_hex) if wall_color_hex else None
    roof_color_hex = params.get("roofColor")
    roof_color = _hex_to_rgba(roof_color_hex) if roof_color_hex else None

    faces = build_faces(
        footprint, storeys, storey_heights, style, roof, ridge_height, holes=holes
    )
    widgets = build_widgets(footprint, storeys, storey_heights, rooms, holes=holes)

    ifc = init(name="HomemakerProject")
    Molior.from_faces_and_widgets(
        file=ifc,
        faces=faces,
        widgets=widgets,
        name="Building",
        share_dir=SHARE_DIR,
    ).execute()

    return ifc_to_glb(ifc, wall_color=wall_color, roof_color=roof_color)


def main():
    """CLI: read JSON params from stdin, write glb to stdout."""
    params = json.loads(sys.stdin.read())
    sys.stdout.buffer.write(build_and_export_glb(params))


if __name__ == "__main__":
    main()
