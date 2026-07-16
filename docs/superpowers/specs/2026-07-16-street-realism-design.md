# Street Geometry Realism (SP-2a) — Design

**Status:** approved design, ready for implementation plan
**Date:** 2026-07-16
**Depends on:** Street Network sub-project 1 (`src/lib/street/*`, merged to main)

## Where this fits

This is the first of three sub-projects turning the street network into the
_primary_ drawing surface with auto-generated urban fabric:

- **SP-2a (this spec)** — street geometry realism: per-type minimum curve
  radius (auto-fillet) + drape the network on topography.
- **SP-2b (next)** — auto-generate editable building frontages on both edges
  of every street; Roads tool becomes primary.
- **SP-2c (small, independent)** — selection bounding box = the whole building
  volume (lot footprint projected up to the roof).

SP-2a is foundational because SP-2b hangs buildings off the _final_ street
centreline; getting the centreline right (radius-limited + draped) first avoids
re-deriving frontages later.

## Goal

Drawn streets curve to a realistic minimum radius for their type and sit on the
tilted ground, instead of passing sharply through every drawn vertex on a flat
plane.

## Architecture

Two additive changes, both preserving the "absent/flat = byte-identical"
invariant:

1. **Minimum curve radius (pure geometry).** Each `StreetType` gains a
   `minRadius`. A new pure `filletCentreline(points, minRadius)` replaces the
   sharp Catmull-Rom corners with a real road alignment — straight tangents
   joined by circular arcs of radius ≥ `minRadius` — while keeping the first and
   last vertices exact (they are shared junction points; moving them would break
   `deriveIntersections`). Where a drawn corner is too tight for the arc to seat
   within its adjacent segments, the radius clamps to the largest that fits and
   the existing `streetAdvisory` flags it (the non-blocking backstop).

2. **Topography draping (render).** Every street vertex lifts to
   `groundHeightAt(x, z, ground)` instead of a flat `y ≈ 0`. The 2-D geometry
   functions stay pure and unit-tested; the y-lift is a thin render concern that
   reuses the already-tested `terrain.ts` (`groundHeightAt`, `groundNormal`).

## Component design

### 1. Types — `src/lib/street/types.ts`

Add `minRadius` (metres) to `StreetSpec` and the four specs. Values are scaled
from real horizontal-curve minimums by design speed (tighter → faster type),
chosen so a boulevard reads as classical/near-straight at scene scale and an
alley can still hairpin:

```ts
export interface StreetSpec {
  width: number;
  allowsCars: boolean;
  label: string;
  minRadius: number; // metres; minimum centreline curve radius for this type
}

export const STREET_SPECS: Record<StreetType, StreetSpec> = {
  alley:     { width: 3.5, allowsCars: false, label: "Alley",     minRadius: 6 },
  street:    { width: 9,   allowsCars: true,  label: "Street",    minRadius: 20 },
  road:      { width: 14,  allowsCars: true,  label: "Road",      minRadius: 45 },
  boulevard: { width: 24,  allowsCars: true,  label: "Boulevard", minRadius: 120 },
};
```

Add a helper mirroring `effectiveWidth`:

```ts
export function minRadiusOf(s: Street): number {
  return STREET_SPECS[s.type].minRadius;
}
```

Radius is type-derived only (no per-street override in this sub-project —
`width` override stays as-is).

### 2. `filletCentreline` — `src/lib/street/geometry.ts`

```ts
export function filletCentreline(
  points: Vec2[],
  minRadius: number,
  samplesPerArc = 8,
): Vec2[]
```

**Algorithm (per interior vertex V, with neighbours A = prev, B = next):**

- Unit vectors `u = (A − V)/|A−V|`, `w = (B − V)/|B−V|`.
- Deflection angle `Δ` = the change in heading (angle between the incoming and
  outgoing _directions_). If `Δ` is ~0 (collinear, within an epsilon), emit V
  unchanged — no arc.
- Tangent length for a fillet of radius `r`: `T = r · tan(Δ / 2)`.
- **Fit clamp:** the tangent point must lie within each adjacent segment, and
  where two fillets share a segment they may not overlap. Cap `T` at
  `min(|A−V|, |B−V|) · 0.5` (half the shorter neighbour — reserves room for a
  fillet at the far end of each segment too). Solve the largest feasible radius
  `rFit = Tcap / tan(Δ / 2)`. The applied radius is `min(minRadius, rFit)`.
- Tangent points `Ta = V + u · T`, `Tb = V + w · T` (with the applied `T`).
- Arc centre `O = V + bisector · (r / cos(Δ/2))`, where
  `bisector = normalize(u + w)` points into the corner interior. (Derivation:
  the interior angle between segments is `φ = π − Δ`; the centre lies on the
  bisector at distance `r / sin(φ/2) = r / cos(Δ/2)`, and `T = r / tan(φ/2) =
  r · tan(Δ/2)`.) Sample the arc from `Ta` to `Tb` in `samplesPerArc` steps,
  sweeping the short way (the interior side of the corner).

**Assembly:** output = first vertex, then for each interior corner its
`[Ta, …arc…, Tb]`, joined by straight runs, then the last vertex. Consecutive
straight tangents need no intermediate samples (the ribbon offset handles
variable spacing).

**Edge cases / invariants (each becomes a test):**

- `points.length ≤ 2` → returned unchanged (straight; passthrough copy).
- **First and last vertices are always emitted exactly** (junctions pinned).
- Collinear interior vertex → emitted unchanged.
- Right-angle corner with generous segments and `minRadius = R` → the arc's
  distance from V equals `R·(1/cos(Δ/2) − 1)` and every sample is ≥ `R` from the
  arc centre (radius honoured).
- Too-tight corner (short segments) → applied radius `< minRadius` (clamped, does
  not throw); the curve still renders.
- Large `minRadius` (boulevard) on a gentle bend → wide sweep; on a sharp drawn
  corner → clamped + advisory.

**Consumers:** `StreetRibbonMesh` switches from `smoothCentreline(street.points)`
to `filletCentreline(street.points, minRadiusOf(street))`. If, after this,
`smoothCentreline` has no remaining callers it becomes dead code — **flag it to
the user for removal per the Deletion Policy; do not delete it in this
sub-project.** (Its Catmull-Rom does not respect a minimum radius, so it is
superseded for streets.)

### 3. `streetAdvisory` extension — `src/lib/street/geometry.ts`

Extend the existing advisory (keep the straight-run and boulevard-length hints)
with a radius check: for each interior vertex, compute `rFit` as above; if
`rFit < minRadiusOf(street)` return a hint naming the type and its minimum, e.g.

> "This boulevard corner is tighter than its 120 m minimum radius — the curve
> was rounded as much as the segments allow; lengthen them or add a vertex for a
> gentle sweep."

Still advisory-only; never blocks. Order: radius hint takes precedence when
present (it explains a visibly clamped fillet), else the existing hints.

### 4. Topography draping — render components

The 2-D geometry functions are unchanged. Each street render component lifts its
y to the ground and, where it renders a flat disc, tilts it to the ground plane.
`Ground` threads down from page state through `SceneContents` →
`StreetNetworkView` → children.

- **`StreetRibbonMesh`** — accept `ground: Ground`. Per ribbon vertex, `Y =
  groundHeightAt(x, z, ground) + 0.02`. On a single tilted plane this is exact
  (the plane is single-valued in y over x,z), so the paved ribbon drapes.
- **`RoundaboutMesh`** — accept `ground`. Position the disc group at
  `[cx, groundHeightAt(cx, cz, ground), cz]` and apply the ground-tilt
  quaternion (from `groundNormal(ground)`, rotating +Y → normal) so the paving
  lies in the ground plane. Keep the small `0.021` lift as a local offset.
- **`MonumentMesh`** — accept `ground` (or a resolved `baseY`). Base sits at
  `groundHeightAt(centre)`; the monument stays **plumb** (vertical — obelisks and
  fountains stand under gravity, not normal to the slope).
- **`IntersectionMarker`** — accept `ground`. `position.y =
  groundHeightAt(pos, ground) + 0.025`; keep it flat (UI marker).
- **`StreetNetworkView`** — accept `ground: Ground` and pass to all children.
- **`SceneContents`** — pass the page's existing `ground` state to
  `StreetNetworkView`.

**Byte-identical invariant:** `groundHeightAt` returns `0` when `slope === 0`, so
with flat ground every y equals its current constant and the tilt quaternion is
identity — pixel-identical to today. No geometry-function output changes.

## Data flow

```
page ground state ─▶ SceneContents ─▶ StreetNetworkView ─▶ StreetRibbonMesh (drape ribbon)
                                                        ├▶ RoundaboutMesh (tilt disc + plumb monument)
                                                        └▶ IntersectionMarker (lift disc)

street.points ─▶ filletCentreline(points, minRadiusOf(street)) ─▶ streetRibbon(cl, width) ─▶ mesh
              └▶ streetAdvisory(street) ─▶ inspector hint
```

`deriveIntersections` still consumes raw `street.points`; because
`filletCentreline` pins endpoints, junctions and roundabout keys are unaffected.

## Testing

Pure unit tests (`src/lib/street/geometry.test.ts`, `types.test.ts`):

- `filletCentreline`: ≤2-point passthrough; endpoints exact; collinear
  passthrough; right-angle arc honours `minRadius` (all samples ≥ R from arc
  centre); short-segment clamp (< minRadius, no throw); boulevard wide sweep vs
  alley tight turn on the same drawn corner.
- `streetAdvisory`: sub-min-radius corner returns the radius hint; gentle corner
  returns none; existing straight-run/boulevard-length hints still fire.
- `STREET_SPECS`: every type has a positive `minRadius`; ordering
  alley < street < road < boulevard.

Draping is verified visually (slope 0 → unchanged; slope > 0 → ribbon/roundabout
follow the tilt) plus a `slope === 0` byte-identical check in the browser
checkpoint.

## Out of scope (later sub-projects)

- Buildings on street edges, Roads-tool-primary (SP-2b).
- Selection = building volume (SP-2c).
- Trimming frontages / paving at junctions; roundabout-aware street ends.
- Arbitrary per-node heightfield topography (still deferred; the single tilted
  plane is what `groundHeightAt` models today).
- Deleting the now-possibly-dead `smoothCentreline` (flagged, not removed).
