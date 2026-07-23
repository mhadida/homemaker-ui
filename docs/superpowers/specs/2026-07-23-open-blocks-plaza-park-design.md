# Open blocks: plaza / single building / park

**Status:** approved (design forks decided in chat 2026-07-23)
**Scope:** a block too short for a real terrace becomes an OPEN block — a plaza,
a park, or (most often) a single building — instead of a squished row.

## Problem

A drawn or street-derived frontage that is only a few metres long still gets
subdivided into buildings. Below the terrace threshold that reads as a cramped
single building on every such sliver. We want short frontages to sometimes
become open urban space — a paved plaza or a planted park — with a single
building as the common fallback, chosen automatically and deterministically.

## Decisions (from brainstorming)

1. **Who chooses:** the seeded generator, deterministically. Same block →
   same fill; reroll (new seed) re-picks. No new UI, no inspector.
2. **Model:** reuse the Square's *monument-at-centroid* pattern (`MonumentMesh`)
   for plaza fountains/obelisks. The paved/green **surface itself is new
   geometry** — a Square renders only a monument + marker, never a surface.
3. **Threshold:** `frame.length < 2 · block.gen.lotWidth.min` (~10 m). At or
   above it, nothing changes.
4. **Park look:** green surface **plus** simple procedural low-poly planting —
   the project's first vegetation meshes.

## Architecture

Pure geometry/decision in `src/lib/facade/`, color-free and vitest-tested;
components render what they return.

### `src/lib/facade/openBlock.ts` (new, pure)

```ts
type PlazaMonument = "fountain" | "obelisk" | null;
export type OpenFill =
  | { kind: "plaza"; monument: PlazaMonument }
  | { kind: "park" };

// null = render normally (a full terrace, OR the weighted "single building"
// outcome — subdivide already yields one lot below ~10 m, so a single
// building IS the normal path). Non-null only for plaza/park.
export function openFillFor(
  length: number,
  seed: number,
  lotWidthMin: number,
): OpenFill | null;

// The block's ground rectangle: the frontage line extruded back by `depth`
// along −normal (street is +normal, massing is −normal). Four corners CCW.
export function blockFootprint(
  frame: { origin: Vec2; dir: Vec2; normal: Vec2; length: number },
  depth: number,
): Vec2[];

export interface Planting { pos: Vec2; height: number; radius: number; }
// Deterministic jittered-grid scatter inside the footprint inset by the
// canopy radius. Count ∝ area. Empty when the inset rectangle collapses.
export function parkPlanting(footprint: Vec2[], seed: number): Planting[];

// Convenience for the render + corner guards.
export function isOpenSpace(block: FacadeBlock): boolean; // openFillFor(...) != null
```

**Weighting** (seed → uniform r in [0,1)): building `null` ≈ 0.55, plaza ≈ 0.25,
park ≈ 0.20 — short frontages mostly still build. Plaza monument (own seed
stream): fountain ≈ 0.5, obelisk ≈ 0.2, none ≈ 0.3.

Determinism uses the existing `mulberry32`; distinct offsets per decision
(fill kind, monument, planting) so they don't correlate.

### Components (facade/)

- **`OpenBlockMesh`** — takes `footprint: Vec2[]`, `fill: OpenFill`, `ground`.
  Triangulates the quad, drapes each vertex to `groundHeightAt + 0.02`.
  Plaza → paving color (reuse `StreetRibbonMesh` stone tone) + `MonumentMesh`
  at the centroid when `monument`. Park → green surface + one `TreeMesh` per
  `parkPlanting` entry. Not selectable (no `onClick`).
- **`TreeMesh`** — low-poly: a brown trunk cylinder + one or two green cones.
  Palette (2–3 greens) lives here; the pure lib stays color-free. Height/radius
  from the `Planting`. Drapes to ground at its base.

### Integration — `SceneContents.tsx`

- Memo `openFills: Map<blockId, OpenFill>` over `blocks`.
- `BlockGroup` gains `openFill?: OpenFill | null`. When set it renders the
  block's frontage line (plan) + sidewalk as today but replaces the lot loop
  with one `<OpenBlockMesh>` (footprint via `blockFootprint(frame,
  MASSING_DEPTH_DEFAULT)`), and skips FacadeMesh/massing/basement/SelectionMarker.
- `InstancedFacadeBoxes` (scene-wide window instancer) receives
  `blocks.filter(b => !openFills.has(b.id))` so open blocks contribute no
  windows.

### Integration — corners

`detectCorners` (`corners.ts`) skips any node whose incident block
`isOpenSpace` — a plaza/park has no facade to miter or shell to sync, so it
never forms a corner. This is the single guard; `syncCorners` consumes
`detectCorners`, so both the SceneContents merge and the page-level corner
inspector inherit it. Building-fill short blocks (fill `null`) are unaffected —
they corner normally.

## Invariants

- **Byte-identical** when every block is ≥ ~10 m (or picks the building
  outcome): `openFills` empty → no new geometry, no filtered instancing, no
  corner guard fires.
- **No new stored state.** Everything derives from `block.seed` +
  `frame.length` + `block.gen.lotWidth.min`. Save/Load unchanged; reroll
  re-picks; hand-edits are irrelevant (open blocks expose no lots to edit).
- Applies uniformly to drawn blocks and street-derived frontage blocks (same
  `FacadeBlock`, same seed source).

## Testing (vitest, pure)

- `openFillFor`: `null` at/above `2·min`; below it deterministic per seed; all
  three outcomes (null/plaza/park) appear across a seed sweep; plaza monument
  varies; identical seed → identical result.
- `blockFootprint`: 4 corners, correct rectangle, back edge offset by
  `−normal·depth`, area = `length·depth`.
- `parkPlanting`: deterministic; every point inside the footprint; count grows
  with area; empty for a footprint smaller than one inset cell.
- `isOpenSpace`: true iff `openFillFor` non-null.

## Deferred

- Per-lot override / inspector (auto-only for now).
- Richer planting (varied species, benches, paths).
- Plaza/park participating in Square derivation or as a corner mass.
