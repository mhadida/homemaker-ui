# Buildings on Street Edges (SP-2c) — Design

**Status:** design for review
**Date:** 2026-07-16
**Depends on:** SP-2a (street realism), SP-2b (T/X intersections), branch `feature/street-realism`.

## Where this fits

The payoff of the streets-primary inversion: **draw a street → editable
buildings appear along both edges.** This is the headline the user has asked
for repeatedly.

## Goal

For every street, auto-generate a row of editable buildings along **both**
frontage edges, facing the street, subdivided into lots, **trimmed back at
junctions** — reusing the entire existing building/facade/roof/gable/corner
system as the renderer. Buildings stay **editable**; moving/reshaping a street
**re-fits** its buildings; **hand-edits pin**.

## Key decision — frontages are linked FacadeBlocks (user-approved earlier: "auto-generate, still editable")

A street's edge becomes one or more **`FacadeBlock`s** — the exact primitive the
whole editor already renders and edits. This means:

- **Reuse everything.** A frontage block is a normal `FacadeBlock` (line + gen +
  seed + lots), so facades, roofs, gables, dormers, passages, sections, massing,
  marquee, corners, save/load all work on it unchanged.
- **One block per drawn segment per side.** A street's *drawn* polyline (few
  vertices) offsets to a left and a right frontage line; each drawn segment's
  offset becomes a straight block. (Buildings follow the straight drawn
  segments, not the filleted road curve — buildings are straight, the road
  curves gently between them; bends become **corner buildings** via the existing
  corner system.)
- **Linked to the street.** Each derived block carries
  `source?: { streetId: string; segment: number; side: "left" | "right" }`
  (absent on hand-drawn blocks). The link drives regeneration.

### Lifecycle (derive-then-editable)

- **Street committed / added** → generate its frontage blocks (both sides, all
  segments), append to `blocks[]`. Facing = toward the centreline (reuse
  `streetAwareFlipped`).
- **Street moved / reshaped** → for each affected street, recompute its blocks'
  `line` from the new geometry and **refit** their lots (the existing
  `refit`/`syncCorners` ripple), **preserving `customized` lots** (hand-edits
  pin — exactly like the existing node-drag refit).
- **Street deleted** → drop the blocks whose `source.streetId` matches.
- **Reroll / edit a building** → normal block ops; `customized` lots survive the
  next street-driven refit.

Hand-drawn blocks (`source` absent) are never touched by street regeneration —
the two coexist.

## Component design

### 1. Frontage geometry — `src/lib/street/frontage.ts` (new, pure)

```ts
// One frontage edge of one drawn street segment, trimmed at its junctions.
interface Frontage {
  streetId: string;
  segment: number;
  side: "left" | "right";
  a: Vec2;         // trimmed start (plan coords)
  b: Vec2;         // trimmed end
  facingFlipped: boolean; // so the FacadeBlock faces the centreline
}

// Offset both sides of every drawn segment by effectiveWidth/2, trim each end
// back by the setback at any incident junction (from deriveIntersections), drop
// frontages shorter than a minimum. Pure.
function streetFrontages(net: StreetNetwork, setback: number): Frontage[];
```

- **Offset:** perpendicular to the drawn segment (left/right), distance
  `effectiveWidth(street)/2` (+ a small pavement gap constant).
- **Trim at junctions:** if a segment endpoint is (or lies near) a derived
  junction (`deriveIntersections`, SP-2b), pull the frontage end back along the
  segment by `setback` so buildings don't invade the crossing. Junctions are
  located by `pos` (not `points[vertex]` — see SP-2b caveat).
- **Drop** frontages below `FRONTAGE_MIN` (a junction-crowded short segment
  yields no building).

### 2. Frontage → block generation — `src/lib/facade/streetBlocks.ts` (new)

```ts
// Build/refresh the derived frontage blocks for a network, preserving edits.
// existing = current blocks[]; returns the next blocks[] (hand-drawn blocks
// untouched, derived blocks re-fit with customized lots pinned).
function syncStreetBlocks(
  net: StreetNetwork,
  existing: FacadeBlock[],
  setback: number,
): FacadeBlock[];
```

- Diff `streetFrontages(net)` against the existing `source`-tagged blocks by
  `(streetId, segment, side)`: **add** new frontages, **refit** moved ones
  (recompute `line`, refit lots preserving `customized`), **remove** stale ones.
- New blocks seed lots via the existing generator (`generate.ts`), with a
  per-frontage deterministic seed (streetId+segment+side hash) so redraws are
  stable.
- Funnel through `syncCorners` so bends between adjacent frontage blocks become
  corner buildings.

### 3. Page wiring — `src/app/facade/page.tsx`

- After any street mutation (`handleCommitStreet`, street move, delete,
  type/width change), call `syncStreetBlocks(net, blocks, setback)` →
  `setBlocks`. A `buildingsFromStreets` toggle (default ON) gates it so the
  feature can be turned off (byte-identical when off / no streets).
- Save/load: `FacadeBlock.source` is plain JSON — round-trips for free; a loaded
  scene re-links derived blocks to their streets by `source`.

### 4. Rendering

None new — derived blocks render through the existing `SceneContents` block
pipeline (facades, massing, roofs, corners, …).

## Testing

- `streetFrontages`: both sides offset correctly; trim shortens ends at a
  junction; a short over-trimmed segment drops; facing points at the centreline;
  empty network → [].
- `syncStreetBlocks`: adds blocks for a new street; moving a street refits its
  blocks and PINS a `customized` lot; deleting a street removes its blocks;
  hand-drawn (`source`-less) blocks are never touched; deterministic seed →
  stable regeneration.
- Save/load round-trips `source`.

## Byte-identical invariant

`buildingsFromStreets` OFF, or an empty street network → `blocks[]` is whatever
was hand-drawn, unchanged. `source` absent on every existing block → all current
paths identical.

## Out of scope (later)

- Enclosed-block (city-block) derivation from the network graph — this places
  buildings on street *edges*, not around block interiors.
- Rear-property-line / plot-depth from the opposing frontage (uses a fixed
  `massingDepth` for now).
- Buildings following the *filleted* road curve (they sit on straight drawn
  segments; bends → corner buildings).
- Zoning/use mix + storefront-frequency sliders + the stats dashboard (the
  "later" urban-analytics sub-project).
