"""Smoke test: extract geometry from /tmp/homemaker_test.ifc and write glb."""

import struct
import sys
import multiprocessing
from pathlib import Path

import numpy as np
import ifcopenshell
import ifcopenshell.geom
import pygltflib


def extract_meshes(ifc_path: str):
    """Yield (name, verts[N,3], faces[M,3], material_id_per_face[M]) per element."""
    ifc = ifcopenshell.open(ifc_path)
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)

    it = ifcopenshell.geom.iterator(settings, ifc, multiprocessing.cpu_count())
    if not it.initialize():
        return
    while True:
        shape = it.get()
        geom = shape.geometry
        verts = np.array(geom.verts, dtype=np.float32).reshape(-1, 3)
        faces = np.array(geom.faces, dtype=np.uint32).reshape(-1, 3)
        # materials: list of objects with .name, .diffuse, etc.
        mats = geom.materials
        mat_ids = np.array(geom.material_ids, dtype=np.int32)
        yield shape.name, verts, faces, mats, mat_ids
        if not it.next():
            break


def main():
    out_meshes = list(extract_meshes("/tmp/homemaker_test.ifc"))
    print(f"Got {len(out_meshes)} meshes")
    total_v, total_f = 0, 0
    style_set = set()
    for name, v, f, mats, mids in out_meshes:
        total_v += len(v)
        total_f += len(f)
        for m in mats:
            style_set.add(m.name)
    print(f"  total verts={total_v}, triangles={total_f}")
    print(f"  materials seen: {sorted(style_set)[:15]} ...")


if __name__ == "__main__":
    main()
