# Derived T/X Intersections (SP-2b) — Design

**Status:** design for review
**Date:** 2026-07-16
**Depends on:** Street Network (SP-1) + Street Realism (SP-2a), branch `feature/street-realism`.
**Blocks:** Buildings-on-edges (next sub-project) — frontages must stop at these junctions.

## Where this fits

The streets-primary urban system, in dependency order:
- **SP-2b (this spec)** — proper **T** (a street ending/passing on another's segment)
  and **X** (two streets crossing mid-span) junctions, **derived geometrically**
  so streets stay whole polylines.
- **SP-2c (next)** — buildings auto-populate on both edges of every street,
  trimmed back at these junctions.
- **SP-2d (after)** — Rhino marquee overhaul (right-drag pan / left-drag
  window·crossing select) + wiring the street marquee.

## Goal

Let the user draw streets that form real junctions: **snap a vertex onto an
existing street to make a T**, or **draw across a street to make an X** — with
every junction **derived** (streets are never split or mutated), so moving a
street re-derives its crossings automatically.

## Decision (user-approved)

Junctions are **derived, not stored**. Streets remain whole polylines. This
extends SP-1's existing shared-endpoint derivation (`deriveIntersections`) with
two new geometric cases, rather than inserting/splitting vertices.

## Component design

### 1. Snap-to-segment (drawing aid) — `src/lib/street/geometry.ts`

Extend `snapStreetPoint(p, network, radius)` so a candidate vertex snaps to the
nearest point on any existing street's **segment**, not only to existing
vertices:

- **Priority:** an existing **vertex** within `radius` wins over a segment
  (reusing an exact junction is better than a fresh point-on-segment). Only if
  no vertex is in range does it snap to the closest segment point.
- Snap is computed against each street's **raw `points` polyline** (the stored
  geometry), because junctions derive from raw points — not the rendered
  filleted centreline. On straight runs the two coincide; near a filleted
  corner they differ slightly, which is acceptable (T-junctions land on runs).
- Returns the snapped `Vec2` (exact segment-projection), so the placed vertex
  lies **on** the existing segment → the T-derivation below fires.

New pure helper: `closestPointOnSegment(p, a, b): { point: Vec2; t: number; dist: number }`.

### 2. Derived T and X — `src/lib/street/intersections.ts`

`deriveIntersections(net)` keeps its existing shared-endpoint pass, then adds:

- **T (vertex-on-segment):** a **vertex** of street A that lies on a **segment**
  of a *different* street B (within `WELD_EPS`), where that point is **not**
  already B's own vertex. Junction position = the vertex; incident = A (at its
  vertex index) + B (on its segment). A vertex lying on its *own* street's
  segment is ignored.
- **X (segment-crossing):** a proper interior crossing of a segment of A with a
  segment of B (distinct streets) — computed by segment-segment intersection,
  excluding endpoint-touch cases already covered by the shared-endpoint / T
  passes. Junction position = the crossing point; incident = both streets (no
  vertex on either).

`Intersection` gains a `kind: "node" | "t" | "x"` tag (default `"node"` for the
existing shared-vertex case) so the renderer and future frontage-trimming can
distinguish them. Existing fields (`key`, `pos`, `incident`) are unchanged.

**Keying (roundabout association + save/load safety).** Shared-vertex junctions
keep their **exact** `${x}:${z}` key (so existing saved `roundabouts` entries
still resolve — beta data-preservation). Derived T/X positions are computed
floats, so their key rounds the position to a **weld grid** (`keyOf` →
`${round(x)}:${round(z)}` at `WELD_EPS` resolution). Integer/`.0` coordinates
round to themselves, so a T that lands exactly on an integer grid keeps a
stable key across redraws. `pruneRoundabouts` already drops entries whose key is
no longer derived, so a roundabout on a crossing that the user later moves apart
is cleaned up automatically.

Pure, fully unit-tested (T hit/miss, X proper-cross vs endpoint-touch vs
parallel/collinear, self-street ignore, key stability, epsilon tolerance).

### 3. Rendering — `src/components/street/`

No new components. `deriveIntersections` now returns T/X junctions too, so the
existing `IntersectionMarker` (clickable, roundabout-eligible) and
`RoundaboutMesh`/`MonumentMesh` render at them unchanged — any T/X junction can
become a roundabout + monument, same as a shared-vertex junction. (Streets
visually cross *through* a mid-span roundabout for now; routing the carriageway
*around* the island is deferred.)

### 4. Draw preview — `src/components/facade/FacadeViewer.tsx`

The street draw surface already calls `snapStreetPoint`; it now snaps to
segments too (§1). A small tick/marker previews when the cursor is snapped onto
an existing street (T about to form), reusing the existing snap feedback.

## Data flow

```
draw cursor ─▶ snapStreetPoint(p, net, r) ──(snaps to vertex | segment)──▶ committed vertex
network.streets ─▶ deriveIntersections ─▶ [ shared-vertex nodes | T (vertex-on-segment) | X (segment-crossing) ]
                                          └▶ IntersectionMarker / RoundaboutMesh (unchanged)
                                          └▶ pruneRoundabouts drops stale roundabout keys
```

Streets are **never mutated** by junction formation — `network.streets` holds
exactly what was drawn; every junction is recomputed from it.

## Testing

- `closestPointOnSegment`: interior projection, endpoint clamping, degenerate
  (zero-length) segment.
- `snapStreetPoint`: vertex-priority over segment; segment snap lands on the
  line; out-of-range → unchanged; empty network no-op.
- `deriveIntersections`: existing shared-endpoint cases unchanged; T fires for
  vertex-on-segment and not for a vertex at an existing shared vertex (no
  double-count); X fires for a proper cross and not for endpoint-touch, parallel,
  or collinear-overlap; self-street segments ignored; key stability + `WELD_EPS`
  tolerance; `pruneRoundabouts` keeps/drops correctly across T/X.
- Save/load: a document with a roundabout on a shared-vertex key still resolves
  (exact key preserved).

## Byte-identical invariant

A network with only shared-endpoint junctions (no T/X) derives exactly the same
intersections, keys, and roundabouts as today — the T/X passes add entries only
when a vertex actually lies on a foreign segment or two segments actually cross.
Empty network unchanged.

## Out of scope (later)

- **Buildings on street edges** (next sub-project) — frontage derivation +
  trimming at these junctions.
- Routing a carriageway *around* a mid-span roundabout island (streets currently
  cross through it).
- Splitting a street at a junction for per-segment type changes (streets stay
  whole; the whole polyline shares one type).
- Snapping to the *filleted* centreline rather than the raw polyline near
  corners.
