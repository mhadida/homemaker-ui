# Facade Designer — Design Spec

**Date:** 2026-07-06
**Status:** Approved by user (brainstorming session)

## Purpose

A single-wall parametric facade designer for infill urban lots, living at a new
`/facade` route in this repo. Infill lots have exactly one street-facing facade
— party walls on both sides, no visible rear — so the design object is the
facade plane itself, not a building. Output is visual exploration and images
(PNG capture); there is no IFC/BIM deliverable and the Python/Molior pipeline
is not involved.

**Future scope (explicitly deferred, design must not preclude):** corner
conditions — two facades meeting at an angle. The page state is conceptually
`facades: [FacadeParams]`, an array of one in v1.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Core design object | Facade as the only object — single wall plane, no volume behind |
| Output | Visual exploration + images only (no IFC, no glTF export in v1) |
| Parameter scope | All four groups: proportions, bay system, ground floor, ornament/materials |
| Where it lives | New `/facade` route in this repo (not a separate repo) |
| Context display | Grey neighbor masses + sidewalk plane, adjustable heights |
| AI prompt | Kept, retargeted at facade schema |
| Geometry approach | A: pure client-side TypeScript/Three.js procedural geometry |
| Testing | vitest, scoped to the pure layout engine in `src/lib/facade/` |

Approach B (thin building through Molior) was rejected: no per-bay control,
slow server round-trips. Approach C (client layout + pre-baked Molior glb
assets) is a possible later upgrade — the layout/geometry seam is designed so
a glb-asset backend can replace procedural openings per-element without
touching the layout engine.

## Data model

New file `src/lib/facade/types.ts`. Deliberately parallel to `BuildingParams`
but independent.

```ts
type OpeningKind = "window" | "door" | "blank" | "shopfront" | "garage";

interface FacadeParams {
  // Proportions
  width: number;                // lot width in meters
  storeys: number;              // 1–6
  storeyHeight: number;         // baseline average
  storeyHeights?: number[];     // classical ratios — reuse existing helpers

  // Bay system: the facade is a (storeys × bays) grid of cells
  bays: number;                 // 1–9
  windowWidthRatio: number;     // opening width as fraction of bay width
  windowHeightRatio: number;    // opening height as fraction of storey height
  cellOverrides?: { storey: number; bay: number; kind: OpeningKind }[];

  // Ground floor treatment — fills the ground row's default kinds
  groundFloor: {
    treatment: "residential" | "shopfront" | "garage";
    doorBay: number;            // which bay gets the entrance
    stoop: boolean;             // entry steps
  };

  // Ornament & materials
  ornament: {
    cornice: boolean;
    parapet: boolean;
    sills: boolean;
    surrounds: boolean;
  };
  wallColor: string;            // hex; reuse WALL_SWATCHES
  trimColor: string;            // cornice/sills/surrounds
  doorColor: string;
  preset?: PresetId;
}
```

**Grid resolution rule:** each cell gets a *default kind* — upper storeys
default to `window`; the ground row derives from `groundFloor.treatment`
(residential → windows with a `door` at `doorBay`; shopfront → `shopfront`
across ground bays with `door` at `doorBay`; garage → `garage` at `doorBay`,
windows elsewhere). `cellOverrides` then sparsely patches individual cells.
This mirrors the existing `storeyHeight`/`storeyHeights` baseline-plus-
exceptions pattern and keeps AI output tractable.

**Taller ground floor** comes from the existing classical-ratio system
(`classicalStoreyHeights` in `src/lib/building/types.ts`) — no new parameter.

**Presets** are named `Partial<FacadeParams>` bundles, not code paths. V1
ships three: `georgian` (Georgian terrace), `victorian-shopfront`,
`modern` (modern minimal).

Separate state (never triggers facade geometry rebuild):

```ts
interface LotContext {
  leftNeighborHeight: number;   // meters
  rightNeighborHeight: number;
  show: boolean;
}
```

`ViewSettings` (sun azimuth/altitude) is reused from
`src/lib/building/types.ts` unchanged.

## Geometry engine

Two layers with a hard seam:

### Layer 1 — layout engine (`src/lib/facade/layout.ts`)

Pure function, no Three.js imports:

```ts
computeLayout(params: FacadeParams): FacadeLayout
```

`FacadeLayout` is flat data: the wall outline rectangle, one rectangle per
opening (with resolved `OpeningKind`), and placement data for ornament
(cornice line at wall top, parapet extension, sill/surround rects per window,
stoop footprint).

**All validity clamps live here** (single source of truth):
- opening widths clamp so piers between/beside openings keep a minimum width
- door/opening heights never exceed their storey height
- shopfront glazing keeps a structural pier at each party-wall edge
- `doorBay` and `cellOverrides` indices clamp to the current grid

This seam is where approach C (Molior glb assets) or a second corner facade
would plug in later.

### Layer 2 — mesh builder (`src/components/facade/FacadeMesh.tsx`)

R3F component rendering a `FacadeLayout`:

- **Wall:** one `THREE.Shape` (outer rect) with holes (opening rects) →
  `ExtrudeGeometry` at ~0.35 m thickness. Real thickness gives real reveals.
- **Windows:** thin box-outline frame inset in the reveal + glass quad using
  the same glass material treatment as `GLTFBuildingScene`. Sills/surrounds
  are small extruded boxes when enabled.
- **Door:** panel + surround + optional stoop steps (boxes).
- **Shopfront:** full-bay glazing with transom line and fascia band above.
- **Garage:** flat panel with horizontal ribs.
- **Cornice/parapet:** stepped profile (2–3 stacked boxes with increasing
  projection) run the full facade width.
- **Context:** two grey `BoxGeometry` neighbor masses flush against the
  party-wall lines + sidewalk plane; rough matte material so they recede.

Geometry regenerates in `useMemo` keyed on `params`. Vertex count is a few
thousand — full rebuild per slider tick holds 60 fps, so **all edits are
live**. The draft/committed/Update machinery from `/` is not carried over
(it exists only because the Python build is slow).

## UI & viewer

**Route:** `src/app/facade/page.tsx`. Same shell as the main page: header,
viewer left, 320 px control panel right, stacked on mobile. The `/` page is
untouched.

**Viewer** (`src/components/facade/FacadeViewer.tsx`, adapted from
`BuildingViewer`): same lighting/sun/shadow rig. Camera starts at a
pedestrian 3/4 street view. Orbit constrained to the front hemisphere
(azimuth clamped to ±80°) — nothing exists behind the wall. A **Save image**
button captures the canvas to PNG (images are a stated output).

**Controls** (`src/components/facade/FacadeControls.tsx`) in four collapsible
groups:

1. **Proportions** — width, storeys, storey height (classical ratios applied
   like the main app)
2. **Bays & openings** — bay count, window width/height ratios, and the
   **bay grid editor** (`src/components/facade/BayGrid.tsx`): a 2D grid in
   the panel mirroring the facade; tapping a cell cycles its kind
   (window → blank → door → shopfront → garage → window). Ground row shows
   treatment-derived defaults.
3. **Ground floor** — treatment picker, door bay, stoop toggle
4. **Ornament & context** — cornice/parapet/sills/surrounds toggles,
   wall/trim/door colors (reusing `WALL_SWATCHES`), neighbor heights,
   context on/off

**Presets row** at the top of the panel: 3 preset chips; tapping applies the
bundle; params remain individually editable after.

The panel bay grid doubles as the legend for the facade. Later, clicking
openings directly in the 3D view can dispatch the identical override action;
the panel grid remains the touch-friendly path (iPad is a target).

## AI prompt

New sibling route `src/app/api/facade-prompt/route.ts`, cloned from the
existing `/api/prompt` pattern (`generateObject` + Zod + echo-current-
defaults system prompt).

**Constraint (verified in existing route):** OpenAI structured output rejects
optional fields, so `FacadeSpec` is flat and fully required — storeys, width,
bays, treatment, doorBay, ornament toggles, colors, preset. The system prompt
instructs the model to echo current values for unmentioned fields.

The AI does **not** emit `cellOverrides` — per-cell surgery is a
direct-manipulation gesture; the AI handles coarse intent ("4 bays, Victorian
shopfront, door on the right").

A local keyword parser (`src/lib/facade/prompt-parser.ts`, same pattern as
`src/lib/building/prompt-parser.ts`) gives instant feedback before the AI
responds. The existing `PromptInput` component is reused unchanged.

## Error handling

- **Degenerate parameters:** prevented by slider ranges plus layout-engine
  clamps (single source of truth for validity). No error states in the
  geometry path.
- **AI failures:** same friendly status-pill treatment as the main page
  (ANSI-stripping + unauthenticated-hint logic already exists there).

## Testing

Add **vitest** as a dev dependency, scoped to `src/lib/facade/`. First test
infrastructure in the repo; zero config for pure TS; no impact on the Next
build.

Unit tests target the layout engine's geometric invariants:
- openings never overlap each other
- openings stay inside the wall rect
- the door lands in `doorBay`; overrides land in their cells
- clamps hold at parameter extremes (1 bay, 9 bays, min/max ratios)
- ground-row kinds derive correctly from each treatment

Everything else (materials, lighting, controls) is verified visually through
the `/facade` page.

## File plan

All new files unless noted:

```
src/app/facade/page.tsx              — route: state + layout shell
src/app/api/facade-prompt/route.ts   — AI prompt endpoint (facade schema)
src/lib/facade/types.ts              — FacadeParams, presets, defaults, LotContext
src/lib/facade/layout.ts             — pure layout engine + clamps
src/lib/facade/layout.test.ts        — vitest unit tests
src/lib/facade/prompt-parser.ts      — local keyword parser
src/components/facade/FacadeViewer.tsx    — R3F canvas, constrained orbit, save-image
src/components/facade/FacadeMesh.tsx      — FacadeLayout → meshes
src/components/facade/FacadeControls.tsx  — 4 control groups + presets row
src/components/facade/BayGrid.tsx         — tappable cell-override grid
```

Modified: `package.json` (vitest devDependency + `test` script).

Reused without modification: `classicalStoreyHeights`,
`clampHeightsForStyle`, `WALL_SWATCHES`, `PromptInput`, `ViewSettings`,
lighting/sun rig patterns from `BuildingViewer`, glass material treatment
from `GLTFBuildingScene`.

Not touched: main `/` page, Python pipeline, Molior submodule, `/build` and
`/api/prompt` routes.
