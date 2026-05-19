# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp>=1.0"]
# ///
"""
Homemaker MCP Server — drives the Homemaker Blender addon via MCP.

Connects to an already-running Blender instance that has a socket server on
127.0.0.1:9876 (the same one homemaker-ui uses).

Run:  uv run mcp_server.py
Add to Claude Code:  claude mcp add homemaker -- uv run /path/to/mcp_server.py
"""

import json
import socket
from pathlib import Path

from mcp.server.fastmcp import FastMCP

BLENDER_HOST = "127.0.0.1"
BLENDER_PORT = 9876
TIMEOUT = 120

mcp = FastMCP(
    "homemaker",
    instructions=(
        "Homemaker MCP server for designing buildings in Blender. "
        "Homemaker converts simple 3D geometry into IFC building models. "
        "Blender must be running with the Homemaker addon and socket server on port 9876."
    ),
)


def _send_to_blender(code: str) -> dict:
    """Send Python code to the Blender socket server and return the response."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(TIMEOUT)
    try:
        s.connect((BLENDER_HOST, BLENDER_PORT))
        msg = json.dumps({"type": "execute_code", "params": {"code": code}}) + "\n"
        s.sendall(msg.encode())
        chunks = []
        while True:
            data = s.recv(65536)
            if not data:
                break
            chunks.append(data)
            try:
                json.loads(b"".join(chunks))
                break
            except json.JSONDecodeError:
                pass
        raw = b"".join(chunks).decode()
        return json.loads(raw)
    except socket.timeout:
        return {"status": "error", "message": "Blender connection timed out"}
    except ConnectionRefusedError:
        return {
            "status": "error",
            "message": "Cannot connect to Blender on port 9876. Is the socket server running?",
        }
    finally:
        s.close()


def _blender(code: str) -> str:
    """Execute code in Blender, return the printed output or error."""
    resp = _send_to_blender(code)
    if resp.get("status") == "success":
        return resp.get("result", {}).get("result", "(no output)")
    return f"ERROR: {resp.get('message', 'unknown error')}"


# ── Tools ──────────────────────────────────────────────────────────────


@mcp.tool()
def execute_python(code: str) -> str:
    """Execute arbitrary Python code in Blender. Use `print()` to return results.
    The Blender `bpy` module is available. The Homemaker addon is loaded.
    """
    return _blender(code)


@mcp.tool()
def get_scene_info() -> str:
    """Get an overview of the current Blender scene: objects, materials, IFC status, and collections."""
    return _blender("""
import bpy

lines = []
lines.append(f"Blend file: {bpy.data.filepath or '(unsaved)'}")

# Addon status
bonsai_ok = 'bl_ext.blender_org.bonsai' in bpy.context.preferences.addons
homemaker_ok = 'homemaker' in bpy.context.preferences.addons
homemaker_ops = hasattr(bpy.ops.object, 'homemaker')
lines.append(f"Bonsai addon: {'enabled' if bonsai_ok else 'DISABLED'}")
lines.append(f"Homemaker addon: {'enabled' if homemaker_ok else 'DISABLED'}")
lines.append(f"Homemaker operator: {'registered' if homemaker_ops else 'NOT registered'}")

if not bonsai_ok:
    lines.append("WARNING: Enable Bonsai first — Edit > Preferences > Add-ons > Bonsai")
if not homemaker_ok:
    lines.append("WARNING: Enable Homemaker — Edit > Preferences > Add-ons > Homemaker")

# IFC status
try:
    from bonsai.bim.ifc import IfcStore
    ifc = IfcStore.get_file()
    if ifc:
        buildings = ifc.by_type("IfcBuilding")
        lines.append(f"IFC loaded: {len(buildings)} building(s)")
        for b in buildings:
            lines.append(f"  - {b.Name or '(unnamed)'}")
    else:
        lines.append("IFC: not loaded")
except ImportError:
    lines.append("IFC: unavailable (Bonsai not loaded)")

# Objects
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
lines.append(f"\\nObjects: {len(bpy.data.objects)} total, {len(meshes)} meshes")
for o in bpy.data.objects:
    sel = "*" if o.select_get() else " "
    act = ">" if o == bpy.context.view_layer.objects.active else " "
    lines.append(f"  {sel}{act} {o.name} ({o.type})")

# Materials
lines.append(f"\\nMaterials: {len(bpy.data.materials)}")
for m in bpy.data.materials:
    lines.append(f"  - {m.name}")

# Collections
lines.append(f"\\nCollections: {len(bpy.data.collections)}")
for c in bpy.data.collections:
    vis = "visible" if not c.hide_viewport else "hidden"
    lines.append(f"  - {c.name} ({vis}, {len(c.objects)} objects)")

print("\\n".join(lines))
""")


@mcp.tool()
def list_styles() -> str:
    """List available Homemaker building styles from the share directory."""
    return _blender("""
import bpy, os

share_dir = "share"
if "homemaker" in bpy.context.preferences.addons:
    share_dir = bpy.context.preferences.addons["homemaker"].preferences.share_dir

lines = [f"Share directory: {share_dir}"]
if os.path.isdir(share_dir):
    for entry in sorted(os.listdir(share_dir)):
        full = os.path.join(share_dir, entry)
        if os.path.isdir(full):
            lines.append(f"  style: {entry}")
            for f in sorted(os.listdir(full)):
                lines.append(f"    - {f}")
else:
    lines.append("(directory not found)")

print("\\n".join(lines))
""")


@mcp.tool()
def create_building_mesh(
    coords: list[list[float]],
    storeys: int = 2,
    storey_height: float = 3.0,
    name: str = "Building",
    style: str = "default",
    roof: str = "flat",
    ridge_height: float = 3.0,
) -> str:
    """Create a building mesh in Blender from a polygon footprint.

    Args:
        coords: List of [x, y] pairs defining the floor polygon in meters.
        storeys: Number of storeys.
        storey_height: Height of each storey in meters.
        name: Name for the building object.
        style: Building style. "default" is the full-featured style with windows,
               doors, cornices, and architectural detail. Other styles (blank, cinema,
               courtyard, fancy, foxhouse, framing, halifax, nonplanar, simple) are
               specialized — most lack windows/openings. Use "default" unless you
               have a specific reason.
        roof: Roof type — "flat" or "pitched". Pitched adds a gabled ridge.
              Only works with rectangular (4-point) footprints.
        ridge_height: Height of the ridge above the top storey in meters.
                      Only used when roof="pitched".
    """
    return _blender(f"""
import bpy, bmesh

coords = {json.dumps(coords)}
storey_height = {storey_height}
num_storeys = {storeys}
name = {json.dumps(name)}
style = {json.dumps(style)}
roof = {json.dumps(roof)}
ridge_height = {ridge_height}

mesh = bpy.data.meshes.new(name)
obj = bpy.data.objects.new(name, mesh)
bpy.context.scene.collection.objects.link(obj)

bm = bmesh.new()
all_verts = []
for s in range(num_storeys + 1):
    z = s * storey_height
    storey_verts = [bm.verts.new((x, y, z)) for x, y in coords]
    all_verts.append(storey_verts)

bm.verts.ensure_lookup_table()
n = len(coords)

for s in range(num_storeys):
    bottom, top = all_verts[s], all_verts[s + 1]
    bm.faces.new(bottom)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([bottom[i], bottom[j], top[j], top[i]])

top = all_verts[num_storeys]

if roof == "pitched" and n == 4:
    # Gabled roof: ridge runs along the longer dimension
    xs = [x for x, y in coords]
    ys = [y for x, y in coords]
    width_x = max(xs) - min(xs)
    width_y = max(ys) - min(ys)
    roof_z = num_storeys * storey_height + ridge_height

    if width_x >= width_y:
        mid_y = (min(ys) + max(ys)) / 2
        rv = [bm.verts.new((min(xs), mid_y, roof_z)),
              bm.verts.new((max(xs), mid_y, roof_z))]
    else:
        mid_x = (min(xs) + max(xs)) / 2
        rv = [bm.verts.new((mid_x, min(ys), roof_z)),
              bm.verts.new((mid_x, max(ys), roof_z))]
    bm.verts.ensure_lookup_table()

    if width_x >= width_y:
        bm.faces.new([top[0], top[1], rv[1], rv[0]])  # front slope
        bm.faces.new([top[2], top[3], rv[0], rv[1]])  # back slope
        bm.faces.new([top[3], top[0], rv[0]])          # gable end left
        bm.faces.new([top[1], top[2], rv[1]])          # gable end right
    else:
        bm.faces.new([top[3], top[0], rv[0], rv[1]])   # left slope
        bm.faces.new([top[1], top[2], rv[1], rv[0]])   # right slope
        bm.faces.new([top[0], top[1], rv[0]])           # gable end front
        bm.faces.new([top[2], top[3], rv[1]])           # gable end back
else:
    # Flat roof
    bm.faces.new(top)

if style != "default":
    mat = bpy.data.materials.get(style) or bpy.data.materials.new(name=style)
    mesh.materials.append(mat)

bm.to_mesh(mesh)
bm.free()
mesh.update()

roof_label = f", roof={{roof}}" if roof == "pitched" else ""
print(f"Created '{{name}}': {{n}}-sided, {{num_storeys}} storeys, style={{style}}{{roof_label}}")
""")


@mcp.tool()
def add_room_widget(name: str, x: float, y: float, z: float) -> str:
    """Add a room-type widget point to the scene. Homemaker uses these to assign
    room usage (bedroom, kitchen, living, etc.) to cells.

    Args:
        name: Room type — one of: bedroom, circulation, kitchen, living,
              outside, retail, sahn, toilet, void, stair.
        x: X coordinate of the room centroid.
        y: Y coordinate of the room centroid.
        z: Z coordinate (height) — typically storey_height * storey_index + 1.5.
    """
    return _blender(f"""
import bpy
name = {json.dumps(name)}
wmesh = bpy.data.meshes.new(name)
wmesh.from_pydata([({x}, {y}, {z})], [], [])
widget = bpy.data.objects.new(name, wmesh)
bpy.context.scene.collection.objects.link(widget)
print(f"Added room widget '{{name}}' at ({{widget.location.x:.1f}}, {{widget.location.y:.1f}}, {{widget.location.z:.1f}})")
""")


@mcp.tool()
def select_objects(names: list[str] | None = None, all: bool = False) -> str:
    """Select objects in Blender by name. Set all=True to select everything.

    Args:
        names: List of object names to select. Ignored if all=True.
        all: Select all objects.
    """
    if all:
        return _blender("""
import bpy
bpy.ops.object.select_all(action='SELECT')
meshes = [o for o in bpy.context.selected_objects if o.type == 'MESH']
if meshes:
    bpy.context.view_layer.objects.active = meshes[0]
print(f"Selected {len(bpy.context.selected_objects)} objects")
""")
    names_json = json.dumps(names or [])
    return _blender(f"""
import bpy
bpy.ops.object.select_all(action='DESELECT')
names = {names_json}
found = []
for n in names:
    obj = bpy.data.objects.get(n)
    if obj:
        obj.select_set(True)
        found.append(n)
if found:
    bpy.context.view_layer.objects.active = bpy.data.objects[found[0]]
print(f"Selected: {{found}}")
""")


@mcp.tool()
def topologise() -> str:
    """Run the Topologise operator on selected objects.
    Converts mesh geometry into a topological CellComplex representation —
    the intermediate step before generating IFC.
    """
    return _blender("""
import bpy, addon_utils

# Ensure addons are enabled
if 'bl_ext.blender_org.bonsai' not in bpy.context.preferences.addons:
    addon_utils.enable('bl_ext.blender_org.bonsai', default_set=True, persistent=True)
if 'homemaker' not in bpy.context.preferences.addons:
    addon_utils.enable('homemaker', default_set=True, persistent=True)

if not hasattr(bpy.ops.object, 'topologise'):
    print("ERROR: Topologise operator not registered.")
    print("Restart Blender — the autostart script will enable both addons.")
else:
    sel = [o.name for o in bpy.context.selected_objects]
    print(f"Running Topologise on: {sel}")
    result = bpy.ops.object.topologise()
    print(f"Result: {result}")
    new_objs = [o.name for o in bpy.data.objects if o.type == 'MESH']
    print(f"Scene objects after: {new_objs}")
""")


@mcp.tool()
def homemaker() -> str:
    """Run the Homemaker operator on selected objects.
    Generates a full IFC building model from the selected mesh geometry.
    Objects should be simple faces defining walls, floors, and roofs.
    Room widgets (bedroom, kitchen, etc.) in the scene assign usage to cells.
    """
    return _blender("""
import bpy

# Ensure addons are enabled (in case autostart hasn't run yet)
import addon_utils
if 'bl_ext.blender_org.bonsai' not in bpy.context.preferences.addons:
    addon_utils.enable('bl_ext.blender_org.bonsai', default_set=True, persistent=True)
    print("Enabled Bonsai addon")
if 'homemaker' not in bpy.context.preferences.addons:
    addon_utils.enable('homemaker', default_set=True, persistent=True)
    print("Enabled Homemaker addon")

if not hasattr(bpy.ops.object, 'homemaker'):
    print("ERROR: Homemaker operator not registered.")
    print("Restart Blender — the autostart script will enable both addons.")
else:
    sel = [o.name for o in bpy.context.selected_objects]
    print(f"Running Homemaker on: {sel}")
    result = bpy.ops.object.homemaker()
    print(f"Result: {result}")

    # Hide structural items
    for coll in bpy.data.collections:
        if "IfcStructuralItem" in coll.name:
            coll.hide_viewport = True
        if coll.name.startswith("IfcVirtualElement/CellComplex"):
            coll.hide_viewport = True

# Report
try:
    from bonsai.bim.ifc import IfcStore
    ifc = IfcStore.get_file()
except ImportError:
    ifc = None
if ifc:
    buildings = ifc.by_type("IfcBuilding")
    print(f"IFC buildings: {[b.Name for b in buildings]}")
""")


@mcp.tool()
def export_ifc(filepath: str = "/tmp/homemaker_export.ifc") -> str:
    """Export the current IFC model to a file.

    Args:
        filepath: Output path for the .ifc file.
    """
    return _blender(f"""
from bonsai.bim.ifc import IfcStore
ifc = IfcStore.get_file()
if ifc:
    ifc.write({json.dumps(filepath)})
    print(f"Exported IFC to {json.dumps(filepath)}")
else:
    print("ERROR: No IFC model loaded — run homemaker first")
""")


@mcp.tool()
def render_view(
    angle: str = "front",
    filepath: str = "/tmp/homemaker_render.png",
    resolution_x: int = 800,
    resolution_y: int = 600,
) -> str:
    """Render the current Blender scene from a camera angle.

    Args:
        angle: One of 'front', 'side', 'aerial', or 'current' (use existing camera).
        filepath: Output path for the PNG render.
        resolution_x: Image width in pixels.
        resolution_y: Image height in pixels.
    """
    return _blender(f"""
import bpy
from mathutils import Vector

angle = {json.dumps(angle)}
filepath = {json.dumps(filepath)}

# Ensure camera exists
camera = bpy.data.objects.get("Camera")
if not camera:
    cam_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", cam_data)
    bpy.context.scene.collection.objects.link(camera)
bpy.context.scene.camera = camera

if angle != "current":
    # Calculate bounding box of scene
    all_coords = []
    for o in bpy.data.objects:
        if o.type == "MESH":
            for v in o.data.vertices:
                co = o.matrix_world @ v.co
                all_coords.append(co)

    if all_coords:
        cx = sum(c.x for c in all_coords) / len(all_coords)
        cy = sum(c.y for c in all_coords) / len(all_coords)
        cz = sum(c.z for c in all_coords) / len(all_coords)
        max_dim = max(
            max(c.x for c in all_coords) - min(c.x for c in all_coords),
            max(c.y for c in all_coords) - min(c.y for c in all_coords),
            max(c.z for c in all_coords) - min(c.z for c in all_coords),
        )
        dist = max_dim * 1.8
    else:
        cx, cy, cz, dist = 0, 0, 3, 20

    positions = {{
        "front": (cx + dist * 0.7, cy - dist * 0.7, cz + dist * 0.5),
        "side":  (cx - dist * 0.7, cy - dist * 0.5, cz + dist * 0.4),
        "aerial": (cx, cy - dist * 0.3, cz + dist * 0.9),
    }}
    cam_pos = positions.get(angle, positions["front"])
    camera.location = cam_pos
    direction = Vector((cx - cam_pos[0], cy - cam_pos[1], cz - cam_pos[2]))
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

render = bpy.context.scene.render
render.resolution_x = {resolution_x}
render.resolution_y = {resolution_y}
render.image_settings.file_format = "PNG"
render.filepath = filepath

bpy.ops.render.opengl(write_still=True)
print(f"Rendered to {{filepath}}")
""")


@mcp.tool()
def set_style(names: list[str] | None = None, style: str = "default", all: bool = False) -> str:
    """Assign a Homemaker style (material) to objects. Styles control what building
    elements are generated — walls, floors, roofs, openings, decorative details.

    Available styles include: default, courtyard, fancy, foxhouse, cinema, framing,
    halifax, halifax/arcade, halifax/tuscan, simple, blank, nonplanar.
    Use list_styles() to see all available styles and their contents.

    Args:
        names: Object names to restyle. Ignored if all=True.
        style: Style name to assign (becomes the material name).
        all: Apply to all mesh objects.
    """
    names_json = json.dumps(names or [])
    return _blender(f"""
import bpy

style = {json.dumps(style)}
select_all = {json.dumps(all)}
names = {names_json}

mat = bpy.data.materials.get(style) or bpy.data.materials.new(name=style)

count = 0
for obj in bpy.data.objects:
    if obj.type != 'MESH':
        continue
    if not select_all and obj.name not in names:
        continue

    # Clear existing materials and assign the new style
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    count += 1

print(f"Set style '{{style}}' on {{count}} object(s)")
""")


@mcp.tool()
def get_building_info() -> str:
    """Get detailed IFC building model info: storeys, element counts by type,
    spaces with usage, and structural members."""
    return _blender("""
from bonsai.bim.ifc import IfcStore

ifc = IfcStore.get_file()
if not ifc:
    print("No IFC model loaded")
else:
    lines = []

    # Buildings
    for b in ifc.by_type("IfcBuilding"):
        lines.append(f"Building: {b.Name or '(unnamed)'}")

    # Storeys
    storeys = ifc.by_type("IfcBuildingStorey")
    lines.append(f"\\nStoreys: {len(storeys)}")
    for s in sorted(storeys, key=lambda s: s.Elevation or 0):
        lines.append(f"  {s.Name} (elevation {s.Elevation})")

    # Elements by type
    lines.append("\\nElements:")
    for ifc_type in ["IfcWall", "IfcSlab", "IfcRoof", "IfcCovering",
                     "IfcColumn", "IfcBeam", "IfcRailing", "IfcStair",
                     "IfcWindow", "IfcDoor", "IfcBuildingElementProxy"]:
        elems = ifc.by_type(ifc_type)
        if elems:
            lines.append(f"  {ifc_type}: {len(elems)}")

    # Spaces
    spaces = ifc.by_type("IfcSpace")
    if spaces:
        lines.append(f"\\nSpaces: {len(spaces)}")
        for sp in spaces:
            usage = sp.LongName or sp.Name or "(unnamed)"
            lines.append(f"  {usage}")

    # Structural
    struct = ifc.by_type("IfcStructuralMember")
    if struct:
        lines.append(f"\\nStructural members: {len(struct)}")

    print("\\n".join(lines))
""")


@mcp.tool()
def regenerate_building(building_name: str | None = None, style: str | None = None) -> str:
    """Regenerate an existing IFC building from its stored CellComplex topology.

    This is the round-trip editing workflow: Homemaker stashes the original topology
    inside the IFC model. This tool retrieves it, optionally applies a new style,
    deletes the old building, and re-generates it.

    Args:
        building_name: Name of the building to regenerate. If None, uses the first building.
        style: Optional new style to apply to all faces before regeneration.
               If None, keeps the original styles.
    """
    building_name_json = json.dumps(building_name)
    style_json = json.dumps(style)
    return _blender(f"""
import bpy
from bonsai.bim.ifc import IfcStore
import bonsai.tool as tool
import ifcopenshell.util.placement
from topologic_core import Vertex, Face, CellComplex

ifc = IfcStore.get_file()
if not ifc:
    print("ERROR: No IFC model loaded")
else:
    from molior import Molior
    from molior.ifc import (
        get_structural_analysis_model_by_name,
        delete_ifc_product,
        purge_unused,
    )

    building_name = {building_name_json}
    new_style = {style_json}

    # Find the building
    buildings = ifc.by_type("IfcBuilding")
    building = None
    if building_name:
        for b in buildings:
            if b.Name == building_name:
                building = b
                break
    elif buildings:
        building = buildings[0]

    if not building:
        print("ERROR: Building not found")
    else:
        # Extract CellComplex directly from building representations
        # (get_cellcomplex_from_ifc uses get_parent_building which doesn't
        #  work when called with an IfcBuilding directly)
        faces_ptr = []
        widgets = []

        if building.Representation:
            for representation in building.Representation.Representations:
                context = representation.ContextOfItems
                if (context.is_a("IfcGeometricRepresentationSubContext")
                    and context.ContextIdentifier == "Reference"
                    and context.ContextType == "Model"
                    and context.TargetView == "SKETCH_VIEW"):
                    for item in representation.Items:
                        if item.is_a("IfcPolygonalFaceSet"):
                            styled = item.StyledByItem
                            stylename = styled[0].Name if styled else "default"
                            coordinates = item.Coordinates.CoordList
                            vertices = [Vertex.ByCoordinates(*v) for v in coordinates]
                            for face in item.Faces:
                                indices = face.CoordIndex
                                face_ptr = Face.ByVertices([vertices[v - 1] for v in indices])
                                face_ptr.Set("stylename", stylename)
                                faces_ptr.append(face_ptr)

        for rel in building.ContainsElements:
            for element in rel.RelatedElements:
                if element.is_a("IfcAnnotation") and element.ObjectType == "USAGE":
                    matrix = ifcopenshell.util.placement.get_local_placement(element.ObjectPlacement)
                    vertex = Vertex.ByCoordinates(matrix[0][3], matrix[1][3], matrix[2][3])
                    vertex.Set("usage", element.Name)
                    widgets.append(vertex)

        if not faces_ptr:
            print("ERROR: No stored topology found in this building")
        else:
            cellcomplex = CellComplex.ByFaces(faces_ptr, 0.0001)
            cellcomplex.ApplyDictionary(faces_ptr)
            cellcomplex.AllocateCells(widgets)
            cellcomplex.Set("name", building.Name)

            # Optionally restyle all faces
            if new_style:
                cc_faces = []
                cellcomplex.Faces(None, cc_faces)
                for face in cc_faces:
                    face.Set("stylename", new_style)
                print(f"Applied style '{{new_style}}' to {{len(cc_faces)}} faces")

            name = building.Name

            # Get share dir
            share_dir = "share"
            if "homemaker" in bpy.context.preferences.addons:
                share_dir = bpy.context.preferences.addons["homemaker"].preferences.share_dir

            # Delete old building
            structural_model = get_structural_analysis_model_by_name(ifc, building, name)
            delete_ifc_product(ifc, building)
            delete_ifc_product(ifc, structural_model)
            purge_unused(ifc)
            print(f"Deleted old building '{{name}}'")

            # Regenerate
            molior_object = Molior.from_cellcomplex(
                file=ifc,
                cellcomplex=cellcomplex,
                name=name,
                share_dir=share_dir,
            )
            molior_object.execute()
            print(f"Regenerated building '{{name}}'")

            # Reload in Blender
            tool.IfcGit.load_project()

            # Hide structural collections
            for coll in bpy.data.collections:
                if "IfcStructuralItem" in coll.name:
                    coll.hide_viewport = True
                if coll.name.startswith("IfcVirtualElement/CellComplex"):
                    coll.hide_viewport = True

            # Report
            new_buildings = ifc.by_type("IfcBuilding")
            print(f"IFC buildings: {{[b.Name for b in new_buildings]}}")
""")


@mcp.tool()
def save_blend(filepath: str = "") -> str:
    """Save the current Blender file.

    Args:
        filepath: Path to save to. If empty, saves to the current file path.
                  If no file was opened, saves to /tmp/homemaker.blend.
    """
    fp = json.dumps(filepath)
    return _blender(f"""
import bpy
filepath = {fp}
if not filepath:
    filepath = bpy.data.filepath or "/tmp/homemaker.blend"
bpy.ops.wm.save_as_mainfile(filepath=filepath)
print(f"Saved to {{filepath}}")
""")


@mcp.tool()
def clear_scene(keep_camera: bool = True) -> str:
    """Remove all objects from the scene to start fresh.

    Args:
        keep_camera: Keep camera and light objects.
    """
    keep = "True" if keep_camera else "False"
    return _blender(f"""
import bpy
from bonsai.bim.ifc import IfcStore

keep_camera = {keep}
removed = 0
for obj in list(bpy.data.objects):
    if keep_camera and obj.type in {{"CAMERA", "LIGHT"}}:
        continue
    bpy.data.objects.remove(obj, do_unlink=True)
    removed += 1

try:
    bpy.ops.outliner.orphans_purge(do_recursive=True)
except:
    pass

# Reset IFC
IfcStore.file = None
print(f"Cleared {{removed}} objects")
""")


if __name__ == "__main__":
    mcp.run(transport="stdio")
