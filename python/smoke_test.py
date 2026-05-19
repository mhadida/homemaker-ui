"""Smoke test: build a rectangular building's topologic faces in pure Python
(no Blender), run Molior, write IFC. Confirms the backend pipeline works."""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ADDON_ROOT = REPO_ROOT.parent / "homemaker-addon"
sys.path.insert(0, str(ADDON_ROOT))

from topologic_core import Vertex, Face
from molior import Molior
from molior.ifc import init

SHARE_DIR = str(ADDON_ROOT / "share")


def rect_building_faces(width=8.0, depth=6.0, storeys=2, storey_height=3.0, style="default"):
    coords = [
        (-width / 2, -depth / 2),
        (width / 2, -depth / 2),
        (width / 2, depth / 2),
        (-width / 2, depth / 2),
    ]
    n = len(coords)

    verts = []
    for s in range(storeys + 1):
        z = s * storey_height
        verts.append([Vertex.ByCoordinates(x, y, z) for (x, y) in coords])

    faces = []
    for s in range(storeys):
        bottom = verts[s]
        top = verts[s + 1]
        # Floor slab
        f = Face.ByVertices(bottom)
        f.Set("stylename", style)
        faces.append(f)
        # Walls
        for i in range(n):
            j = (i + 1) % n
            w = Face.ByVertices([bottom[i], bottom[j], top[j], top[i]])
            w.Set("stylename", style)
            faces.append(w)

    # Flat roof
    f = Face.ByVertices(verts[storeys])
    f.Set("stylename", style)
    faces.append(f)
    return faces


def main():
    faces = rect_building_faces()
    print(f"Built {len(faces)} topologic faces")

    ifc = init(name="HomemakerProject")
    print("Initialized IFC project")

    mol = Molior.from_faces_and_widgets(
        file=ifc,
        faces=faces,
        widgets=[],
        name="TestBuilding",
        share_dir=SHARE_DIR,
    )
    mol.execute()
    print("Molior executed")

    out = "/tmp/homemaker_test.ifc"
    ifc.write(out)
    print(f"Wrote {out}")

    walls = ifc.by_type("IfcWall")
    slabs = ifc.by_type("IfcSlab")
    roofs = ifc.by_type("IfcRoof")
    windows = ifc.by_type("IfcWindow")
    doors = ifc.by_type("IfcDoor")
    print(f"  walls={len(walls)} slabs={len(slabs)} roofs={len(roofs)} windows={len(windows)} doors={len(doors)}")


if __name__ == "__main__":
    main()
