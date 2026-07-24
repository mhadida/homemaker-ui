# ArcGIS / Real-City Import — Milestone 1: Terrain — Design Spec

**Date:** 2026-07-24
**Status:** Design approved (brainstorming). First milestone of the long-planned
real-city integration (see [[project-roadmap-arcgis]]).
**Depends on:** the topography feature (`2026-07-14-topography-design.md`) — this
milestone generalizes its tilted-plane ground into a real heightfield behind the
**same** `groundHeightAt` seam.

## Purpose

Let the user **pick a real place on a map and stand on its real terrain** while
using every existing hand-drawn tool (blocks, streets, corners, roofs, save/load).
This is the terrain-first vertical slice of a larger, deliberately decomposed
program (buildings, streets, promote-to-editable are later milestones — see
Roadmap below).

The product decisions that frame the whole program (settled in brainstorming):

- **Imported buildings are backdrop context by default, promotable to editable
  parametric blocks on demand** (M2 + M4). Not part of M1.
- **The data source is not committed.** Ingestion is designed around a
  source-agnostic provider interface; the first adapter is open, tokenless data.
  An Esri adapter can implement the same interface later with no change above it.
- **Place selection is a mini-map bbox picker** (WYSIWYG).

M1 delivers: the picker, the projection anchor, the ingestion scaffold, and real
terrain rendering. With nothing imported, the app is **byte-identical** to today.

## Non-negotiable invariant

**No import → exact current behavior.** `ground.hf` absent ⇒ `groundHeightAt`
runs the existing tilted-plane math, the ground renders as today's flat quad
rigidly tilted by `groundNormal`, and a saved scene round-trips unchanged. Every
decision below preserves this.

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| **Terrain seam** | Add an **optional** `hf?: Heightfield` to the existing `Ground`. `groundHeightAt` gains one guard: `if (g.hf) return sampleHF(g.hf, x, z)` else the plane math. | Least churn; all ~25 `groundHeightAt` consumers keep calling the same function. `hf` absent → plane → byte-identical. NOT a discriminated-union rewrite. |
| **Heightfield model** | Regular grid: `{ originX, originZ, spacing, cols, rows, data: number[] }` (row-major metres), **bilinear** sampled, **clamp-to-edge** outside bounds. | JSON-native (rides the save document); simplest correct sampler; the ±2000 m world flattens gracefully at the DEM boundary. |
| **Projection** | Local **ENU** tangent-plane, equirectangular: `x = (lon−lon0)·cos(lat0)·R`, `z = (lat−lat0)·R`, `R = 6378137`. Origin = bbox centre. `east→+x, north→+z` (matches the confirmed viewer convention, `BuildingViewer.tsx:33,151`, and the topography azimuth math). | Flat-earth error at ≤~2 km city scale is <0.1 m — negligible. No sign flips. |
| **Ground rendering** | When `g.hf`: `useGroundGeometry` builds a **subdivided** plane (≤128×128) and displaces each vertex `y = groundHeightAt`, then `computeVertexNormals()`. `groundQuat` becomes **identity** (displacement replaces the rigid tilt). | A single rigid tilt can't represent a heightfield; the displaced mesh is the terrain. Plane path unchanged. |
| **Per-point normal** | Keep `groundNormal(g)` for the plane tilt. Add `groundNormalAt(x, z, g)` (central differences) **only** where a per-point surface normal is genuinely needed. M1's mesh uses three's `computeVertexNormals`, so `groundNormalAt` is a small isolated addition, not a ripple. | Avoids widening the seam more than the feature requires. |
| **Provider location** | A Next **route handler `POST /api/terrain`** (bbox + anchor → `Heightfield` JSON). It fetches the DEM, decodes, resamples to our grid server-side. | Keeps CORS + canvas-decode off the client and any future Esri **token server-side**. The `TerrainProvider` interface lives behind the route. |
| **First DEM adapter** | Open, tokenless **AWS Terrain Tiles** ("terrarium" PNG: `height = −32768 + R·256 + G + B/256`). | Free, public, CORS-enabled, global. No account. Esri's `EsriTerrainProvider` implements the same interface later. |
| **Picker** | Header **"Load place"** → modal with a **MapLibre GL** map (tokenless basemap style). Pan/zoom, draggable bbox rectangle, **"Load this area."** | WYSIWYG (the chosen UX). MapLibre is tokenless; no Mapbox account. |
| **Georeference persistence** | The bbox-centre **`anchor {lat0, lon0}`** is stored in page state AND the save document. | Later milestones (buildings, streets) must project into the **same** local frame; the anchor is that frame's definition. |
| **Manual topography** | When `hf` is present, the real terrain **overrides** the Slope/Azimuth plane; the Topography sliders are hidden/disabled and a **"Clear terrain"** returns to the manual plane. | One ground at a time; no confusing plane+heightfield superposition. |
| **Save/Load version** | **Do NOT bump `SCENE_VERSION`.** `hf` + `anchor` are **optional/additive** fields; a v1 save without them still loads (defaults → plane). | `deserializeScene` **rejects** any `version !== SCENE_VERSION` (`document.ts:161`). Bumping would reject **every existing beta save** — the opposite of the data-preservation rule. Additive optional fields are a *compatible* change, so version stays 1. |
| **Grid on terrain** | The infinite drawing grid is a flat shader that can't drape a heightfield. When terrain is loaded, **hide it** (it stays a plan-view drawing aid conceptually; the ⌗ snap lattice math is unaffected). | Cosmetic + reversible; avoids a floating lattice over bumps. |
| **ContactShadows** | Disabled when `hf` present (as it already is on the WebGPU path); the sun shadow covers ground contact. | The flat blob at `y≈0.005` would float/sink over terrain. |
| **Empty/default** | `hf` undefined, `anchor` undefined → today's plane, untilted-or-slope ground, byte-identical. | Same "default = old behavior" invariant as every prior feature. |

## Data model

**`Ground` (extend `terrain.ts`), additive:**
```ts
interface Ground {
  slope: number;          // unchanged — manual tilt when no terrain imported
  azimuth: number;        // unchanged
  hf?: Heightfield;       // present ⇒ real terrain; overrides the plane
}

interface Heightfield {
  originX: number; originZ: number;   // world metres of sample [0][0]
  spacing: number;                    // metre grid step (from the DEM resample)
  cols: number; rows: number;         // ≤ 128 each (bounds document size)
  data: number[];                     // row-major heights (m), length cols·rows
}
```

**Page state (`app/facade/page.tsx`):** new `anchor: GeoAnchor | null` alongside
`ground`. Threaded to `SceneContents` for rendering and to save/load.

**`SceneState` + `FacadeDocument` (`document.ts`), additive optionals:**
`ground` already carries `hf` (it is part of `Ground`); add `anchor?: GeoAnchor`.
`serializeScene`/`deserializeScene` pass them through; `deserializeScene` defaults
a missing `anchor` to `null` and a missing `ground.hf` to `undefined`.
**`SCENE_VERSION` stays 1.**

## Pure modules

**`lib/geo/project.ts`** (new, no three/React):
```ts
interface GeoAnchor { lat0: number; lon0: number }
interface LngLatBBox { west: number; south: number; east: number; north: number }
function project(lat: number, lon: number, a: GeoAnchor): [number, number]; // [x,z]
function unproject(x: number, z: number, a: GeoAnchor): [number, number];    // [lat,lon]
function anchorOf(bbox: LngLatBBox): GeoAnchor;                               // centre
```

**`lib/facade/terrain.ts`** (extend):
```ts
function sampleHF(hf: Heightfield, x: number, z: number): number;   // bilinear + clamp
function groundNormalAt(x: number, z: number, g: Ground): [number, number, number];
// groundHeightAt: add the `if (g.hf) return sampleHF(...)` guard at the top.
```

**`lib/geo/dem.ts`** (new, server-usable, pure decode/resample):
```ts
function terrariumToMetres(r: number, g: number, b: number): number; // −32768 + r·256 + g + b/256
function resampleToGrid(...): Heightfield;   // tiles + bbox + anchor → our grid
```

## Ingestion interface

```ts
interface TerrainProvider {
  fetchHeightfield(bbox: LngLatBBox, anchor: GeoAnchor): Promise<Heightfield>;
}
```
`OpenTerrainProvider` (AWS Terrain Tiles) ships first. The route handler
`POST /api/terrain` instantiates the configured provider and returns its
`Heightfield`. Nothing above the route knows the source.

## Rendering (`SceneContents.tsx`)

- `useGroundGeometry(streetNetwork, ground)`: when `ground.hf`, subdivided +
  displaced geometry with computed normals; else today's flat geometry.
- `groundQuat`: identity when `ground.hf`, else `setFromUnitVectors(+y,
  groundNormal(ground))` as today.
- Grid group + `ContactShadows`: suppressed when `ground.hf` present.
- Everything that drapes via `groundHeightAt` (streets, basements via
  `levelingFor`, trees, ribbons) is **unchanged** and follows the real terrain
  for free.

## Picker (`components/facade/PlacePicker.tsx`, new)

- Dynamically-imported (`maplibre-gl` touches `window`; client-only, no SSR).
- Tokenless basemap style; pan/zoom; a draggable/resizable bbox rectangle.
- **"Load this area"** → `anchorOf(bbox)` → `POST /api/terrain` → set
  `ground.hf` + `anchor`; loading + error states (network fail / no coverage).
- **"Clear terrain"** → `ground.hf = undefined`, `anchor = null` → manual plane.
- Header button gated to the facade page, near Save/Load.

## Testing (vitest, pure + visual)

- `project`/`unproject`: round-trip; origin → `[0,0]`; 1° lat ≈ 111 km; lon
  scaled by `cos(lat0)`; `anchorOf` returns the bbox centre.
- `sampleHF`: exact at grid nodes; correct midpoint interpolation; clamp-to-edge
  outside; flat field → constant.
- `groundHeightAt`: routes to `sampleHF` when `hf` set; **plane-identical** when
  absent (regression guard for the invariant).
- `groundNormalAt`: unit vector; flat field → `+y`; tilts downhill on a ramp.
- `terrariumToMetres`: known RGB → metres; `resampleToGrid` dims/spacing.
- Document round-trip: scene with `hf`+`anchor` serializes and deserializes
  equal; a v1 doc **without** them loads to a plane (byte-identical) and does not
  error.
- Visual: displaced mesh; a building auto-levels + grows its basement to real
  ground; draw a block/street on terrain; save → reload → same place.

## New dependencies

- `maplibre-gl` (picker basemap). Tokenless.
- No mapping/DEM account required for the open adapter.

## Not in scope (this milestone)

Everything past terrain, captured as the roadmap below. Also deferred within
terrain: lidar/1 m DEMs (grid cap stays 128²); retaining walls/steps between
buildings on steep real ground; grid draping the heightfield; an in-scene 3D
place picker; caching/rate-limit handling for the DEM source.

## Roadmap (later milestones — separate spec → plan → build each)

- **M2 · Buildings as context massing.** `BuildingProvider` → footprint polygons
  + heights → grey extruded boxes draped on terrain; clickable. Backdrop only.
- **M3 · Street import.** `StreetProvider` → centrelines + OSM class → `StreetType`
  → the existing editable `StreetNetwork`.
- **M4 · Promote footprint → editable block** (hardest). Derive a frontage line +
  lots from a real polygon → a `FacadeBlock`. Isolated and last by design.

All three project into the M1 `anchor` frame; the source-agnostic provider
pattern established here extends to each.
