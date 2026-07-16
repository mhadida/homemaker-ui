# Closed-Loop Streets — Design

**Status:** design for build
**Date:** 2026-07-16
**Branch:** `feature/closed-loop-streets`

## Goal

Let a street close into a loop (join last vertex → first) — a ring road, a
block-enclosing loop, a roundabout perimeter — with its curves, ribbon,
junctions, and frontage buildings all wrapping continuously. Today the Roads
tool commits an OPEN polyline even when you click the first vertex (the hint
lies).

## Data model

`Street` gains `closed?: boolean` (absent = open, byte-identical). The `points`
array does NOT repeat the first vertex; `closed` implies an extra closing
segment `points[n-1] → points[0]`. Save/load: additive field, round-trips for
free (`validStreet` tolerates it).

## Component design

### 1. Draw tool — `FacadeViewer.StreetDrawSurface`
Clicking near the first vertex (the existing `closing` branch) now commits with
`closed = true` instead of an open path. `onCommitStreet(type, points, closed)`
gains the flag; `handleCommitStreet` stores it. Requires ≥ 3 vertices to close
(a 2-point loop is degenerate). Escape still commits open.

### 2. Cyclic geometry — `src/lib/street/geometry.ts` (pure)
- `filletCentreline(points, minRadius, samplesPerArc?, closed?)`: when `closed`,
  there are NO pinned endpoints — EVERY vertex is an interior corner, including
  the closing corner at `points[0]` (whose neighbours are `points[n-1]` and
  `points[1]`) and at `points[n-1]` (neighbours `points[n-2]` and `points[0]`).
  The output is a closed sample ring (first sample repeated at the end so the
  ribbon closes). Open behaviour unchanged when `closed` is falsy.
- `streetRibbon(centreline, width, closed?)`: when `closed`, the first/last
  centreline points coincide (a ring); the per-vertex normal at the seam
  averages the wrap-around tangents so the offset ring closes cleanly (no seam
  gap). Open behaviour unchanged.

### 3. Intersections — `src/lib/street/intersections.ts`
Iterate the closing segment (`points[n-1]→points[0]`) too when a street is
`closed`, so the loop can still form T/X junctions with OTHER streets. A closed
street does not self-intersect at its own seam (first≈last is the seam, not a
cross-street junction) — the existing distinct-street / self-street guards
already exclude it.

### 4. Frontages — `src/lib/street/frontage.ts`
Include the closing segment's offset edges when `closed`, so buildings ring the
whole loop (inner + outer edges). The offset-crossing corner logic already
welds; the seam vertex welds like any other bend (adjacent segments share the
mitered ribbon vertex).

### 5. Rendering — `StreetRibbonMesh`
Pass `street.closed` to `filletCentreline`/`streetRibbon`. The paved ribbon
renders as a closed band. Draw preview: a closed preview when the cursor is
snapped to the first vertex.

## Testing

- `filletCentreline` closed: a square loop `[[0,0],[10,0],[10,10],[0,10]]`
  fillets all 4 corners (incl. the seam) and the output ring's first ≈ last;
  open passthrough unchanged.
- `streetRibbon` closed: the offset ring closes (first offset ≈ last offset on
  each side); no seam gap.
- `streetFrontages`: a closed loop yields frontages all the way around (the
  closing segment contributes edges); an open street unchanged.
- `deriveIntersections`: a closed street crossing an open one forms an X on the
  closing segment; the seam itself is not a junction.
- Save/load round-trips `closed`.

## Byte-identical invariant

`closed` absent/false on every street → every geometry/render/frontage path is
exactly as today.

## Out of scope

- Auto-detecting that an open polyline "should" be closed.
- Filling the loop interior (plaza/courtyard) — that's the deferred open-square
  plaza sub-project.
