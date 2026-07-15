# Street Network (Sub-project 1) — design

**Date:** 2026-07-15
**Part of:** the "proper street system" redesign (urban-fabric generator)
**Status:** design — pending user review

## Context

Today a "block" is an ad-hoc one-sided line segment with a row of buildings on
its left. There is no street as a real object; streets are the implicit empty
space a facade faces. This can't express two-sided streets, real junctions,
city blocks, or plazas.

The agreed end model: **draw a street network → auto-derive blocks →
auto-derive buildings**. The full project decomposes into:

1. **Street network** (this spec) — typed, drawable streets + intersections +
   paved rendering + roundabouts/monuments.
2. **Block derivation** — the enclosed faces of the network become city
   blocks (inset by street half-widths).
3. **Plots → buildings** — subdivide block frontages into plots; one building
   per plot. Reuses today's `FacadeBlock` (a line + lots on one side is exactly
   a block frontage) and all facade/roof/gable/etc. work.
4. **Junctions & corners** — intersection paving + corner treatment (reuses
   corner-building merge).
5. **Plazas** — a face left open + paved (the original goal); builds on 1 + 2.

**Reuse insight:** the existing building/facade system (`FacadeParams` → mesh,
roofs, dormers, gables, passages, sections, massing, corner-merge) is preserved
as the RENDERER. The new work generates the frontages it consumes.

## Scope of Sub-project 1

A drawable, typed **street network** rendered as paved streets, with derived
intersections and roundabout+monument junctions. It **coexists** with today's
blocks (additive, no regression) — building derivation is Sub-projects 2–3,
which later retire the old pen-block path.

## Street types

| Type | Width | Cars | Character | Geometry rule |
|---|---|---|---|---|
| `alley` | 3.5 m | no (pedestrian) | intimate service back-lanes | short, gently curving; never long/straight |
| `street` | 9 m | 1 lane (local, slow) | everyday residential; the default | gently curving; terminated vistas |
| `road` | 14 m | 2 lanes (through) | connective — links districts | straighter, more direct; not rigidly linear |
| `boulevard` | 24 m (median + trees) | 2+ lanes | grand, classical, monumental | straight & long — **must** be interrupted by a plaza/roundabout + monument |

Hierarchy by scale: alley → street → road → boulevard. Street = *local*
(serves its buildings), Road = *connective* (moves through). Widths are the
`STREET_SPECS` defaults; each street may override.

## Curve model

A street is a **polyline** (`points: Vec2[]`) — straight segments between
vertices you place/drag — **rendered as a smooth Catmull-Rom curve** through the
vertices. The underlying straight-segment geometry keeps offsetting-to-frontages
and block-face derivation tractable; the smooth render gives the classical
gently-curving look. Boulevards = few, long, near-collinear segments.

## Data model — `src/lib/street/`

```ts
// types.ts
export type StreetType = "alley" | "street" | "road" | "boulevard";
export interface StreetSpec {
  width: number; allowsCars: boolean; label: string;
}
export const STREET_SPECS: Record<StreetType, StreetSpec>;

export type Vec2 = [number, number];
export interface Street {
  id: string;
  type: StreetType;
  points: Vec2[];        // polyline vertices, plan coords
  width?: number;        // optional per-street override of the type default
}
export interface Monument { kind: "obelisk" | "fountain"; }
export interface StreetNetwork {
  streets: Street[];
  /** roundabout choice per derived intersection key + its monument */
  roundabouts: Map<string, Monument>;
}
```

Intersections are **derived** (not stored) — the same philosophy as today's
nodes/corners:

```ts
// intersections.ts (pure)
export interface Intersection {
  key: string;              // stable, sorted by incident street ids/positions
  pos: Vec2;
  incident: { streetId: string; end: "a" | "b" | "mid"; t: number }[];
  kind: "junction" | "roundabout";
}
export function deriveIntersections(net: StreetNetwork): Intersection[];
```

Two streets intersect when they share a vertex (snapped) OR their segments
cross. v1: **snapped shared endpoints/vertices only** (like today's welding);
mid-span crossings deferred to Sub-project 4 unless trivial.

## Geometry — `src/lib/street/geometry.ts` (pure, unit-tested)

- `smoothCentreline(points, samplesPerSegment): Vec2[]` — Catmull-Rom sampling
  (straight passthrough for 2-point streets and for boulevards flagged
  straight).
- `streetRibbon(centreline, width): { left: Vec2[]; right: Vec2[] }` — offset
  the sampled centreline by ±width/2 (segment offset + join handling) → the two
  frontage lines + the paved polygon. **These two frontage lines are what
  Sub-project 2 consumes.**
- `roundaboutAt(intersection, radius)` — ring + island geometry.

## Rendering — `src/components/street/`

- `StreetNetworkView` — maps the network to meshes.
- `StreetRibbonMesh` — the paved surface (typed material: alley cobble,
  street/road asphalt, boulevard asphalt + a central median strip + tree
  placeholders), laid on the ground plane (respects topography later).
- `IntersectionMesh` — paved junction fill at each derived intersection.
- `RoundaboutMesh` — ring + island; `MonumentMesh` — obelisk (tapered shaft +
  pyramidion) or fountain (round basin + jet) placeholder at the centre.
- Plan pane: the smooth centreline + width guides while drawing; type-colored.

## Interaction — Plan pane

- A **Draw street** mode (coexists with the existing block pen for now) with a
  **street-type selector** (alley/street/road/boulevard).
- Click places polyline vertices; Escape/close ends; snap (existing snap radius)
  to existing street vertices/intersections to connect the network.
- **Krier/Alexander advisories** (soft, non-blocking): a subtle hint when an
  `alley`/`street` segment run is too long/straight, or a `boulevard` runs past
  a threshold length with no plaza/roundabout interruption. Advisory only in
  v1; no auto-curving or hard rejection.
- Selecting a street → a panel to change its **type**, width override, and
  (for an intersection) toggle **roundabout** + choose the **monument**.

## Page state

`streetNetwork: StreetNetwork` alongside the existing `blocks`. Save/Load
(v15) extends the document with `streetNetwork` (additive, versioned;
absent → empty network, byte-identical for old saves).

## Testing (`src/lib/street/*.test.ts`)

- `STREET_SPECS` widths/car flags; per-street width override.
- `smoothCentreline`: 2-point → straight; a bent 3-point polyline → a smooth
  sampled curve passing through the vertices; boulevard-straight passthrough.
- `streetRibbon`: offset distance = width/2 on both sides; a straight street →
  parallel frontages; a gently bent street → non-self-intersecting frontages.
- `deriveIntersections`: two streets sharing an endpoint → one intersection
  with both incident; disjoint streets → none; a three-street junction →
  one intersection, three incident.
- `roundaboutAt`: ring radius/island geometry; monument centred.

## Non-goals (this sub-project)

Block/plot/building derivation (2–3); mid-span street crossings and full
junction geometry (4); open-square plazas (5); topography-following paving;
hard enforcement of the Krier/Alexander curve rules; retiring the old
pen-block path (happens once 2–3 land).

## Byte-identical invariant

An empty `streetNetwork` renders nothing new; every existing path (blocks, pen,
facades, save/load of old documents) is unchanged.
