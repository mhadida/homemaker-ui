"""
Homemaker Workspace — Stripped-down Blender UI for building design.

Non-destructive: runs at startup, hides panels/menus/editors via Python.
Blender's full functionality is still available if needed (Window > New Main Window).

Install: copy to ~/Library/Application Support/Blender/4.3/scripts/startup/
Or run from: homemaker_autostart.py after addon registration.
"""

import bpy
import re


# ──────────────────────────────────────────────────────────────
# 1. PANEL UNREGISTRATION — Hide panels we don't need
# ──────────────────────────────────────────────────────────────

# Panels to KEEP (allowlist approach — everything else gets hidden)
KEEP_PANELS = {
    # Object properties we need
    "OBJECT_PT_transform",
    "OBJECT_PT_display",
    # Homemaker panels (registered by the addon)
    "OBJECT_PT_homemaker",
    # BlenderMCP panel (socket server controls)
    "BLENDERMCP_PT_Panel",
    # Scene properties (for render settings)
    "SCENE_PT_scene",
    "SCENE_PT_unit",
}

# Panel categories to KEEP in the N-panel (sidebar)
KEEP_SIDEBAR_CATEGORIES = {
    "Homemaker",
    "BlenderMCP",
    "Item",      # Transform values
    "View",      # View navigation
    "Tool",      # Active tool settings
}

# Editors to keep in the workspace
KEEP_EDITORS = {
    "VIEW_3D",
    "PROPERTIES",
    "OUTLINER",
}

_hidden_panels = []
_hidden_headers = []
_hidden_menus = []


def _hide_panels():
    """Unregister panels that aren't in our allowlist."""
    for cls in list(bpy.types.Panel.__subclasses__()):
        name = cls.__name__
        category = getattr(cls, "bl_category", "")
        space = getattr(cls, "bl_space_type", "")

        # Always keep our allowlisted panels
        if name in KEEP_PANELS:
            continue

        # Keep sidebar panels in our allowed categories
        if category in KEEP_SIDEBAR_CATEGORIES:
            continue

        # Keep VIEW_3D tool panels (active tool settings)
        if space == "VIEW_3D" and "tool" in name.lower():
            continue

        # Hide everything else in PROPERTIES editor
        if space == "PROPERTIES":
            try:
                bpy.utils.unregister_class(cls)
                _hidden_panels.append(cls)
            except (RuntimeError, ValueError):
                pass

        # Hide N-panel categories we don't need in VIEW_3D
        if space == "VIEW_3D" and category and category not in KEEP_SIDEBAR_CATEGORIES:
            try:
                bpy.utils.unregister_class(cls)
                _hidden_panels.append(cls)
            except (RuntimeError, ValueError):
                pass


# ──────────────────────────────────────────────────────────────
# 2. MENU SIMPLIFICATION — Remove menus we don't need
# ──────────────────────────────────────────────────────────────

# Top-bar menus to remove from the 3D viewport header
REMOVE_MENUS = {
    "VIEW3D_MT_sculpt",
    "VIEW3D_MT_paint_weight",
    "VIEW3D_MT_paint_vertex",
    "VIEW3D_MT_paint_texture",
    "VIEW3D_MT_particle",
    "VIEW3D_MT_armature",
    "VIEW3D_MT_pose",
    "VIEW3D_MT_gpencil",
    "VIEW3D_MT_grease_pencil",
}

# Editor type menus to remove from Window > Editor Type
REMOVE_EDITORS_FROM_MENU = {
    "GRAPH_EDITOR",
    "DOPESHEET_EDITOR",
    "NLA_EDITOR",
    "SEQUENCE_EDITOR",
    "CLIP_EDITOR",
    "NODE_EDITOR",
    "IMAGE_EDITOR",
    "TEXT_EDITOR",
    "SPREADSHEET_EDITOR",
}


# ──────────────────────────────────────────────────────────────
# 3. CUSTOM HOMEMAKER PANEL — The main control panel
# ──────────────────────────────────────────────────────────────

class HOMEMAKER_PT_main(bpy.types.Panel):
    """Main Homemaker control panel in the 3D viewport sidebar."""
    bl_label = "Homemaker"
    bl_idname = "HOMEMAKER_PT_main"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Homemaker"

    def draw(self, context):
        layout = self.layout
        layout.use_property_split = True
        layout.use_property_decorate = False

        # ── Building Actions ──
        box = layout.box()
        box.label(text="Building", icon="HOME")

        row = box.row(align=True)
        row.operator("object.homemaker", text="Generate", icon="PLAY")
        row.operator("object.topologise", text="Topologise", icon="MESH_GRID")

        # ── Quick Settings ──
        box = layout.box()
        box.label(text="Quick Settings", icon="PREFERENCES")

        # Show active object info
        obj = context.active_object
        if obj and obj.type == "MESH":
            box.label(text=f"Selected: {obj.name}", icon="OBJECT_DATA")
            # Material/style
            if obj.data.materials:
                box.label(text=f"Style: {obj.data.materials[0].name}", icon="MATERIAL")
            else:
                box.label(text="Style: default", icon="MATERIAL")
        else:
            box.label(text="Select a building mesh", icon="INFO")

        # ── Scene Info ──
        box = layout.box()
        box.label(text="Scene", icon="SCENE_DATA")

        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        box.label(text=f"Objects: {len(meshes)} meshes")

        # IFC status
        try:
            from bonsai.bim.ifc import IfcStore
            ifc = IfcStore.get_file()
            if ifc:
                buildings = ifc.by_type("IfcBuilding")
                box.label(text=f"IFC: {len(buildings)} building(s)", icon="CHECKMARK")
            else:
                box.label(text="IFC: not loaded", icon="CANCEL")
        except ImportError:
            box.label(text="Bonsai not available", icon="ERROR")

        # ── Export ──
        layout.separator()
        layout.operator("export_ifc.bim", text="Export IFC", icon="EXPORT")


class HOMEMAKER_PT_styles(bpy.types.Panel):
    """Style picker panel."""
    bl_label = "Styles"
    bl_idname = "HOMEMAKER_PT_styles"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Homemaker"
    bl_options = {"DEFAULT_CLOSED"}

    def draw(self, context):
        layout = self.layout

        styles = [
            ("default", "Default — Full detail with windows, doors, cornices"),
            ("courtyard", "Courtyard — Open central space with arcades"),
            ("fancy", "Fancy — Ornamental classical details"),
            ("foxhouse", "Foxhouse — Fox house style with openings"),
            ("framing", "Framing — Timber frame structure"),
            ("halifax", "Halifax — Piece Hall inspired"),
            ("simple", "Simple — Minimal shells only (no windows)"),
            ("blank", "Blank — Empty, nearly no elements"),
        ]

        obj = context.active_object
        current_style = "default"
        if obj and obj.type == "MESH" and obj.data.materials:
            current_style = obj.data.materials[0].name

        for style_id, desc in styles:
            row = layout.row(align=True)
            icon = "RADIOBUT_ON" if style_id == current_style else "RADIOBUT_OFF"
            op = row.operator("homemaker.set_style", text=desc, icon=icon)
            op.style_name = style_id


class HOMEMAKER_OT_set_style(bpy.types.Operator):
    """Set the Homemaker style on the active object."""
    bl_idname = "homemaker.set_style"
    bl_label = "Set Style"
    bl_options = {"REGISTER", "UNDO"}

    style_name: bpy.props.StringProperty(name="Style")  # type: ignore

    def execute(self, context):
        obj = context.active_object
        if not obj or obj.type != "MESH":
            self.report({"WARNING"}, "Select a mesh object first")
            return {"CANCELLED"}

        if self.style_name == "default":
            obj.data.materials.clear()
        else:
            mat = bpy.data.materials.get(self.style_name)
            if not mat:
                mat = bpy.data.materials.new(name=self.style_name)
            obj.data.materials.clear()
            obj.data.materials.append(mat)

        self.report({"INFO"}, f"Style set to: {self.style_name}")
        return {"FINISHED"}


class HOMEMAKER_PT_rooms(bpy.types.Panel):
    """Room widget panel."""
    bl_label = "Room Widgets"
    bl_idname = "HOMEMAKER_PT_rooms"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Homemaker"
    bl_options = {"DEFAULT_CLOSED"}

    def draw(self, context):
        layout = self.layout
        layout.label(text="Click to place a room widget at the 3D cursor:")

        room_types = [
            "bedroom", "circulation", "kitchen", "living",
            "outside", "retail", "sahn", "stair", "toilet",
        ]

        grid = layout.grid_flow(columns=3, align=True)
        for room in room_types:
            op = grid.operator("homemaker.add_room", text=room.capitalize())
            op.room_type = room

        # List existing widgets
        widgets = [o for o in bpy.data.objects
                   if o.type == "MESH" and
                   any(r in o.name.lower() for r in room_types)]
        if widgets:
            layout.separator()
            layout.label(text=f"Placed widgets: {len(widgets)}")
            for w in widgets:
                row = layout.row(align=True)
                row.label(text=w.name, icon="DOT")
                op = row.operator("object.select_all", text="", icon="RESTRICT_SELECT_OFF")


class HOMEMAKER_OT_add_room(bpy.types.Operator):
    """Add a room type widget at the 3D cursor location."""
    bl_idname = "homemaker.add_room"
    bl_label = "Add Room Widget"
    bl_options = {"REGISTER", "UNDO"}

    room_type: bpy.props.StringProperty(name="Room Type")  # type: ignore

    def execute(self, context):
        cursor = context.scene.cursor.location
        mesh = bpy.data.meshes.new(self.room_type)
        mesh.from_pydata([tuple(cursor)], [], [])
        widget = bpy.data.objects.new(self.room_type, mesh)
        context.scene.collection.objects.link(widget)
        self.report({"INFO"}, f"Added {self.room_type} widget at cursor")
        return {"FINISHED"}


# ──────────────────────────────────────────────────────────────
# 4. WORKSPACE SETUP — Configure the screen layout
# ──────────────────────────────────────────────────────────────

def _setup_workspace():
    """Configure the workspace for building design."""
    screen = bpy.context.screen if hasattr(bpy.context, "screen") else None
    if not screen:
        return

    for area in screen.areas:
        if area.type == "VIEW_3D":
            # Open the N-panel (sidebar) to show Homemaker tab
            for region in area.regions:
                if region.type == "UI":
                    # Ensure sidebar is visible
                    pass

            # Set shading to solid with studio lighting
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    space.shading.type = "SOLID"
                    space.shading.light = "STUDIO"
                    space.shading.color_type = "MATERIAL"
                    space.show_gizmo = True
                    space.show_gizmo_object_translate = True
                    space.show_gizmo_object_rotate = False
                    space.show_gizmo_object_scale = False
                    # Hide overlays we don't need
                    space.overlay.show_floor = True
                    space.overlay.show_axis_x = False
                    space.overlay.show_axis_y = False
                    space.overlay.show_relationship_lines = False
                    space.overlay.show_text = False
                    space.overlay.show_stats = False

        # Collapse timeline/dopesheet if present
        elif area.type in ("DOPESHEET_EDITOR", "TIMELINE", "GRAPH_EDITOR",
                           "NLA_EDITOR", "SEQUENCE_EDITOR"):
            area.type = "VIEW_3D"  # Replace with another 3D view


# ──────────────────────────────────────────────────────────────
# 5. REGISTRATION
# ──────────────────────────────────────────────────────────────

_classes = [
    HOMEMAKER_PT_main,
    HOMEMAKER_PT_styles,
    HOMEMAKER_PT_rooms,
    HOMEMAKER_OT_set_style,
    HOMEMAKER_OT_add_room,
]


def register():
    for cls in _classes:
        try:
            bpy.utils.register_class(cls)
        except ValueError:
            # Already registered
            pass

    # Delay workspace setup to after Blender is fully loaded
    bpy.app.timers.register(_delayed_setup, first_interval=4.0)
    print("[homemaker_workspace] Panels registered")


def _delayed_setup():
    """Run after Blender is fully initialized."""
    _setup_workspace()
    _hide_panels()
    print(f"[homemaker_workspace] Hidden {len(_hidden_panels)} panels")
    print("[homemaker_workspace] Workspace configured")
    return None  # Don't repeat


def unregister():
    # Restore hidden panels
    for cls in _hidden_panels:
        try:
            bpy.utils.register_class(cls)
        except (ValueError, RuntimeError):
            pass
    _hidden_panels.clear()

    for cls in reversed(_classes):
        try:
            bpy.utils.unregister_class(cls)
        except (ValueError, RuntimeError):
            pass


# Auto-register when loaded as a startup script
register()
