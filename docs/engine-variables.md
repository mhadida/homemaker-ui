# Homemaker Variables & Parameters Reference

## 1. Input Geometry

| Parameter | Type | Default | Purpose |
|-----------|------|---------|---------|
| `coords` | list[list[float]] | — | Footprint polygon as [x, y] pairs in meters |
| `storeys` | int | 2 | Number of storeys |
| `storey_height` | float | 3.0 | Height of each storey in meters |
| `ridge_height` | float | 3.0 | Height of ridge above top storey (pitched roofs only) |
| `name` | string | "Building" | Building identifier |
| `style` | string | "default" | Style name (material name on mesh) |
| `roof` | string | "flat" | Roof type: "flat" or "pitched" |

### Room Widgets

Single-vertex mesh objects placed inside cells to assign room usage. The vertex position determines which cell it belongs to. The object name must match a room type.

## 2. Room Types

```
bedroom, circulation, circulation_stair, stair, kitchen,
living, outside, retail, sahn, toilet, void
```

These affect: floor treatment, space IFC classification, occupancy property sets, and stair generation.

## 3. Topology Conditions

Auto-detected from input geometry by the topologiser:

### Face Conditions (Walls)
| Condition | Detection | Generates |
|-----------|-----------|-----------|
| `external` | Vertical face on building boundary | Exterior walls with openings |
| `internal` | Vertical face between two cells | Interior partition walls |
| `open` | Vertical face between inside and outside | Columns and beams only |

### Hull Conditions (Roofs/Floors)
| Condition | Detection | Generates |
|-----------|-----------|-----------|
| `roof` | Non-horizontal external upward face | Pitched roof elements |
| `flat` | Horizontal upward face on world boundary | Flat roof/parapet |
| `soffit` | Non-horizontal external downward face | Ceiling/soffit shells |
| `vault` | Non-horizontal internal face | Vaulted ceilings |
| `external-panel` | — | External wall panels |
| `internal-panel` | — | Internal wall panels |
| `bedroom`, `kitchen`, `living`, etc. | Room type of cell below | Floor slabs per room type |

### Edge Conditions (Traces)
| Condition | Detection | Generates |
|-----------|-----------|-----------|
| `bottom-backward-level` | Ground level foundation edge | Foundation traces |
| `internal-footing` | Internal foundation edge | Internal footings |
| `top-backward-up` | Top edge where roof slopes up | Pitched roof lines |
| `top-backward-level` | Top edge where roof is flat | Flat roof/parapet lines |

## 4. Style System

Each style is a directory in `share/` with up to 5 files. The `default` style uses the top-level files in `share/`.

### Available Styles
| Style | Windows | Pitched Roof | Description |
|-------|---------|-------------|-------------|
| `default` | Yes | Yes | Full-featured with windows, doors, cornices |
| `blank` | No | No | Minimal, nearly empty |
| `cinema` | No | No | Specialized for cinema/auditorium |
| `courtyard` | Yes | No | Courtyard-style with openings |
| `fancy` | Yes | No | Decorative elements |
| `foxhouse` | Yes | No | Fox house style |
| `framing` | No | Yes | Timber framing with structural detail |
| `halifax` | Yes | No | Halifax style (has sub-styles: arcade, rustic, tuscan) |
| `nonplanar` | No | No | Non-planar geometry handling |
| `simple` | No | Yes | Minimal shells only |

### traces.yml — 2D Path Elements

```yaml
<trace_name>:
  class: Wall|Floor|Space|Extrusion|Repeat|Stair
  ifc: IfcWall|IfcSlab|IfcSpace|IfcBeam|IfcColumn|IfcBuildingElementProxy|IfcStair
  typename: <name_in_library.ifc>
  condition: <trace_condition>
  offset: <float>              # Distance from trace path
  extension: <float>           # Extended length for open traces
  ceiling: <float>             # Vertical offset for top edge
  floor: <float>               # Vertical offset for bottom edge
  height: <float>              # Vertical height of element
  inner: <float>               # Inner corner offset
  inset: <float>               # Inset distance
  xshift: <float>              # X-axis shift
  yshift: <float>              # Y-axis shift
  spacing: <float>             # Spacing for repeated elements
  family: <family_name>        # Reference to families.yml
  predefined_type: INTERNAL|EXTERNAL
  psets: {}                    # IFC property sets
  do_populate_exterior_openings: 0|1
  do_populate_interior_openings: 0|1
  structural_material: <string>
  structural_profile:
    - <ProfileType>
    - { ProfileType: AREA, XDim: 0.4, YDim: 0.4 }
  alternate: <int>             # Alternation pattern
  party_wall: true|false
  not_start: true|false        # Skip at path start
  not_end: true|false          # Skip at path end
  not_corner: true|false       # Skip at corners
  going: <float>               # Step tread depth (stairs)
  riser: <float>               # Step rise height (stairs)
  width: <float>               # Stair width
  ref_direction: [x, y, z]
```

### hulls.yml — 3D Shell Elements

```yaml
<hull_name>:
  class: Shell|Grillage
  ifc: IfcRoof|IfcSlab|IfcWall|IfcCovering|IfcVirtualElement|IfcElementAssembly
  typename: <name_in_library.ifc>
  condition: <hull_condition>
  offset: <float>              # Offset from face
  spacing: <float>             # Spacing for grillage members
  angle: <float>               # Angle for grillage members
  do_levelling: true|false     # Apply levelling for grillage
  inset: <float>               # Inset distance
  traces: [<trace_names>]      # Sub-traces for grillage members
  hulls: [<hull_names>]        # Sub-hulls for grillage
  structural_material: <string>
  structural_thickness: <float>
```

### openings.yml — Door/Window Placements

```yaml
<opening_name>:
  family: <family_name>        # References family in families.yml
  type: door|window
  cill: <float>                # Sill height above floor
```

### families.yml — Component Variations

```yaml
<family_name>:
  - typename: <type_in_library>
    height: <float>
    width: <float>             # For doors/windows
    side: <float>              # Side wall spacing
    end: <float>               # End wall spacing
  - typename: <another_type>
    height: <float>
```

### library.ifc

IFC file containing geometry templates for all typenames referenced in the YAML files.

## 5. Molior Class Attributes

```python
self.file = None                       # IfcOpenShell file object
self.building = None                   # IfcBuilding entity
self.structural_analysis_model = None  # Structural model
self.traces = {}                       # Trace definitions
self.hulls = {}                        # Hull definitions
self.normals = {}                      # Normal vector maps
self.elevations = {}                   # Elevation-to-storey mapping
self.name = "Homemaker Building"       # Building name
self.circulation = None                # Circulation graph
self.cellcomplex = None                # Topologic CellComplex
self.share_dir = "share"              # Style directory
```

## 6. Element Base Class Defaults

All generated elements inherit from BaseClass:

```python
self.do_representation = True          # Generate IFC geometry
self.elevation = 0.0                   # Z-coordinate
self.extension = 0.0                   # Path extension
self.height = 0.0                      # Vertical height
self.inner = 0.08                      # Inner offset
self.inset = 0.0                       # Inset offset
self.level = 0                         # Storey level
self.offset = -0.25                    # Standard offset
self.style = "default"                 # Style name
self.ifc = "IfcBuildingElementProxy"   # IFC class
```

## 7. Face/Cell Properties

### Face Dictionary Keys
| Key | Type | Purpose |
|-----|------|---------|
| `stylename` | string | Style for this face |
| `index` | int | Topologic face index |
| `badnormal` | bool | Reversed normal flag |

### Cell Dictionary Keys
| Key | Type | Purpose |
|-----|------|---------|
| `usage` | string | Room type |
| `index` | int | Topologic cell index |
| `separation` | float | Space separation metric |

## 8. Topology Detection Methods

### Face Methods
| Method | Returns | Purpose |
|--------|---------|---------|
| `IsVertical()` | bool | Z-component of normal near 0 |
| `IsHorizontal()` | bool | Z-component near 1 |
| `IsUpward()` | bool | Normal points up |
| `IsOpen(cellcomplex)` | bool | Edge between inside/outside |
| `IsExternal(cellcomplex)` | bool | Boundary face |
| `IsWorld(cellcomplex)` | bool | Outer boundary |
| `Elevation()` | float | Z-height of bottom edge |
| `Height()` | float | Vertical extent |
| `Normal()` | [x,y,z] | Face normal vector |

### Cell Methods
| Method | Returns | Purpose |
|--------|---------|---------|
| `Usage()` | string | Room type |
| `IsOutside()` | bool | Is external space |
| `PlanArea()` | float | Bottom face area |
| `Volume()` | float | Cell volume |
| `Elevation()` | float | Bottom height |
| `Height()` | float | Vertical extent |

## 9. IFC Property Sets

Generated automatically on spaces:

```yaml
Pset_SpaceCommon:
  IsExternal: true|false
Pset_SpaceOccupancyRequirements:
  OccupancyType: <usage_type>
EPset_Pattern:
  Crinkliness: <float>          # Wall/area ratio
  Separation: <float>           # Space separation metric
Qto_SpaceBaseQuantities:
  NetFloorArea: <float>
  NetVolume: <float>
EPset_Topology:
  CellIndex: <int>
  FaceIndex: <int>
  FaceIndices: "<int> <int>..."
```

## 10. Constants

```python
EPSILON = 0.0001               # Geometric tolerance
DEFAULT_STYLE = "default"      # Fallback style name
NONPLANAR_STYLE = "nonplanar"  # Material name for non-planar faces
```
