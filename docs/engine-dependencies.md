# Homemaker Addon — Dependencies & Setup

## Core Dependencies

| Dependency | Function |
|---|---|
| `topologic_core` | Computational topology library — provides Vertex, Face, CellComplex classes for converting 3D geometry into topological representations |
| `topologist` | Higher-level topology analysis — works with topologic_core to analyze building geometry (traces, hulls, cells) |
| `molior` | The building generation engine — takes topological data and generates IFC building elements (walls, floors, roofs, stairs, windows, doors) |
| `ifcopenshell` | IFC file read/write and geometry processing — creates and manipulates Industry Foundation Classes (BIM) data. Bonsai bundles its own version (0.8.4) |
| `bonsai` (Blender addon, formerly BlenderBIM) | Provides IfcStore for managing IFC data within Blender, and bonsai.tool for Blender-IFC integration. The Homemaker operator registers through Bonsai's execute_ifc_operator system |

## Python Standard/Blender Dependencies

| Dependency | Function |
|---|---|
| `bpy` | Blender Python API — creates meshes, objects, materials, operators |
| `bmesh` | Blender mesh editing API — used for mesh manipulation |
| `re` | Regex — parses room type names from widget objects |

## Bonsai's Bundled Sub-dependencies (in bonsai/libs/)

These are needed because Bonsai and ifcopenshell pull them in:

| Dependency | Function |
|---|---|
| `lark` | Parser library used by ifcopenshell for EXPRESS schema parsing |
| `isodate` | ISO date handling for IFC timestamps |
| `typing_extensions` | Backported type hints |
| `python_dateutil` / `six` | Date utilities used by ifcopenshell |
| `shapely` | 2D geometry operations (used by some Bonsai/IFC features) |
| `bsdd` | buildingSMART Data Dictionary client |
| `bcf` (bcf-client) | BIM Collaboration Format — issue tracking in BIM |
| `lxml` | XML processing for IFC-XML and BCF |
| `numpy` (via Blender) | Numerical arrays for geometry processing |

## The Conflict We Hit

The critical issue was:

1. **Bonsai addon not enabled at Blender startup** — Homemaker couldn't register its operators
2. **pip-installed `bonsai`** (an LDAP library, totally unrelated!) shadowed the Blender Bonsai addon's `bonsai` package
3. **pip-installed `ifcopenshell`** conflicted with Bonsai's bundled version — different `file_dict` registration causing `KeyError` on `from_pointer()`
4. **Bonsai's `libs/` directory not in `sys.path`** — missing `bsdd`, `bcf`, etc.

## What Needs to Happen at Startup

1. Bonsai addon enabled (adds its `libs/` to path automatically)
2. Homemaker addon enabled (registers `bpy.ops.object.homemaker` and `bpy.ops.object.topologise`)
3. No conflicting pip packages (`bonsai` LDAP, standalone `ifcopenshell`)
4. MCP socket server running on port 9876
