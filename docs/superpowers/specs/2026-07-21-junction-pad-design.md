# Street Junction Trim + Pad — Design Spec

**Status:** approved (brainstorm), pending implementation plan.

**Extends:** `2026-07-15-street-network-design.md` (the network + ribbons),
`2026-07-16-street-realism-design.md` ("Trimming frontages / paving at
junctions" — deferred there, delivered here), `2026-07-16-tx-intersections-design.md`
(the `deriveIntersections` node/T/X derivation this builds on).

## Problem

Every street ribbon is draped independently at `groundHeightAt + 0.02` with the
same `polygonOffsetFactor = -1` (`StreetRibbonMesh.tsx`). That offset separates
ribbons from the **ground**, but gives every ribbon the **identical** depth
bias, so it does nothing to separate ribbons **from each other**. Wherever two
ribbons occupy the same plane — a shared-vertex junction, a T, or an X crossing
— the GPU cannot order the two coplanar surfaces and they z-fight into a striped
moiré. `deriveIntersections` already finds these junctions but nothing trims the
paving there.

We also found a related bug: a roundabout ring is drawn at `baseY`
(ground level) while ribbons sit at `+0.02`, so today the ribbons render *on top
of and partly occlude the ring*.

## Goal

At every derived junction, cut each incident ribbon back and pave the
intersection as a single dedicated polygon, so there is exactly one paved
surface at any point — no coplanar overlap, no z-fighting. Cover node, T, and X
junctions. Keep the pure-lib / component-drapes pattern. Byte-identical when the
feature is inert (a single street, or a network with no junctions).

## Approach

**Clip every incident ribbon back the same distance, then pave the star of
mouths.** For a junction at `pos`, pick a single clip distance `clipR`. Clip
**every** incident street's rendered (filleted) centreline so it stops `clipR`
(measured along the centreline) from `pos`. Each clipped end is a **mouth**: a
centre point `M` at distance `clipR` from `pos`, with an outward tangent `t`
(pointing into the street) and the two ribbon **cap corners** `M ± h·n`, where
`h` is that street's half-width and `n` is the left-perpendicular of `t` (same
offset convention as `streetRibbon`).

The pad is the polygon formed by walking the mouths **in angular order around
`pos`** and, at each mouth, emitting its two cap corners (`M − h·n` then
`M + h·n`, the CCW winding): `R₀, L₀, R₁, L₁, …`. This is a *star polygon*
around `pos`, and it tiles exactly with the ribbons **by construction**:

- At each mouth the pad's boundary edge `[R_i, L_i]` **is** the clipped ribbon's
  inner cap — they share that exact edge. Pad and ribbon meet edge-to-edge, no
  overlap and no gap → no z-fight, no sliver. This holds for **any** street
  widths, so a narrow alley meeting a wide boulevard is handled correctly (the
  earlier convex-hull idea would swallow the alley's mouth — rejected).
- Between adjacent mouths, the edge `[L_i, R_{i+1}]` is a straight chord across
  the corner the ribbons don't reach → the pad fills it → the squared look.
- The pad sits on the **same plane** as the ribbons (`ground + 0.02`, same
  `polygonOffset`) safely, because it never overlaps them.

The polygon is **fan-triangulated from `pos`** (which is interior to the star for
any real junction whose mouths spread around it). `clipR` is chosen large enough
(see Parameters) that `pos` is comfortably interior and the corner chords clear
the ribbons.

This makes node / T / X uniform: a *through* street (T-through, X) contributes
**two** mouths (one each side of `pos`); an *ending* street (node, T-branch)
contributes **one**. Everything else is identical.

## Data model

```ts
// src/lib/street/junctionPad.ts

/** A clip disc contributed by one junction to one incident street. */
interface ClipDisc {
  centre: Vec2;   // the junction pos
  radius: number; // clipR for that junction
}

/** One mouth: a clipped ribbon end at a junction. */
interface Mouth {
  centre: Vec2;   // M, on the clip circle (distance clipR from pos)
  angle: number;  // atan2 of (M - pos), for angular ordering
  left: Vec2;     // cap corner M + h·n
  right: Vec2;    // cap corner M - h·n
}

/** The paved intersection polygon for one non-roundabout, non-canal junction.
 * Color-free: the pure lib returns the dominant street's id; the component
 * resolves the paving color (palettes live in components, not the geometry). */
interface JunctionPad {
  key: string;              // the Intersection.key it came from
  pos: Vec2;                // junction centre — the fan-triangulation apex
  polygon: Vec2[];          // star polygon (R0,L0,R1,L1,…), plan coords, CCW, first vertex not repeated
  dominantStreetId: string; // widest incident street; the component maps it → pavingOf
}
```

## Algorithm

### 1. `junctionClips(network) → Map<streetId, ClipDisc[]>`

Run `deriveIntersections(network)`. For each intersection:

- **Exclude** it if any incident street is a `canal` (you don't pave water;
  bridges own canal crossings), or if it has fewer than 2 incident streets after
  that filter.
- `clipR`:
  - If the junction key is in `network.roundabouts`: `clipR = ROUNDABOUT_OUTER_R`
    (the existing ring outer radius, imported as the single source of truth).
  - Else `clipR = maxIncidentHalfWidth * CLIP_K`, where `maxIncidentHalfWidth =
    max(effectiveWidth(s) / 2)` over incident streets and `CLIP_K = 1.3` (enough
    that the hull covers the centre for the sharpest real junction).
- Push `{ centre: pos, radius: clipR }` onto each incident street's disc list.

### 2. `clipCentreline(centreline, discs) → Vec2[][]`

Given a polyline (the **filleted** centreline actually rendered) and the discs
that touch it, return the spans that survive outside every disc.

- Walk the polyline as connected segments. For each disc, a segment either stays
  outside, is fully inside (dropped), or crosses the circle (split at the
  intersection parameter). Accumulate the union of "inside" parameter ranges
  across all discs, then emit the complementary ranges as spans.
- An **ending** street (junction at a centreline endpoint: a `node`, or the
  branch side of a `t`) has its disc at the end → one shortened span.
- A **through** street (junction mid-centreline: the through side of a `t`, or
  both sides of an `x`) has its disc in the middle → two spans.
- Multiple junctions on one street → multiple discs → more spans.
- A disc that swallows a whole short stub between two junctions → that stretch
  contributes no span (the pads cover it).
- Degenerate/empty results return `[]` (the caller renders nothing for that
  street, which is correct — it was entirely inside junctions).

Pure; no terrain, no `Math.random`/`Date`.

### 3. `deriveJunctionPads(network) → JunctionPad[]`

For each **non-excluded, non-roundabout** junction:

- For each incident street, build its `Mouth`s at this junction (pure helper
  `mouthsAt(street, pos, clipR)`): fillet the centreline (`filletCentreline(
  points, minRadiusOf(street), 8, closed)`), clip it to this junction's single
  disc, and for each surviving span whose end sits at distance ≈ `clipR` from
  `pos`, take that end as `M` and the tangent `t` = unit vector from `M` toward
  the span's interior (i.e. pointing away from `pos`). Then `n` = left-perp of
  `t`, `h = effectiveWidth(street)/2`, `left = M + h·n`, `right = M − h·n`,
  `angle = atan2(M.z − pos.z, M.x − pos.x)`. A through street yields **two**
  mouths (both spans have a near-`pos` end), an ending street **one**.
- Sort all incident mouths by `angle` (CCW around `pos`). The polygon is the
  concatenation, in that order, of each mouth's `[right, left]` pair:
  `[R₀, L₀, R₁, L₁, …]`. Because `t` points outward, `n` points CCW, so `right`
  is the mouth's clockwise corner and `left` its counter-clockwise corner — the
  boundary enters each mouth at `right`, crosses the cap to `left`, then chords
  to the next mouth's `right`. No convex hull; the star polygon is exact.
- A junction with fewer than 2 mouths after this (e.g. all-but-one incident
  street was a canal, or a degenerate clip) emits no pad.
- `dominantStreetId` = the id of the incident street with the largest
  `effectiveWidth` (tie-break by the `STREET_SPECS` type order so it's
  deterministic). The component resolves the paving color from it.
- Emit `{ key, pos, polygon, dominantStreetId }`.

Roundabout junctions emit **no** pad — the ring is the pad. Their discs still
appear in `junctionClips` so the ribbons get trimmed to the ring.

### 4. `streetSpans(network) → Map<streetId, Vec2[][]>`

For each street that has **≥ 1 clip disc**: fillet its centreline, then
`clipCentreline` against all its discs. The map holds an entry **only** for
clipped streets (each value = that street's open spans). A street with no discs
is **absent** from the map, and its `StreetRibbonMesh` renders via the existing
internal path (closed-aware, **byte-identical**). This absence — rather than
returning a "one span = filleted centreline" entry — is what preserves a closed
loop's ring rendering when it has no junctions.

## Rendering

- **`StreetRibbonMesh`** takes an **optional** `spans?: Vec2[][]` prop. When
  `undefined` (the street has no clip discs) it does exactly what it does today —
  fillet `street.points` internally with `street.closed` — so it is
  **byte-identical** for unclipped streets, closed loops included. When `spans`
  is provided (the street is clipped) it builds one **open** ribbon
  (`streetRibbon(span, effectiveWidth(street), false)` + triangulation + drape)
  per span and renders them as one merged geometry. Selection/hover/onClick is
  unchanged and covers every span.
- **`JunctionPadMesh`** (new) renders one pad from props `polygon: Vec2[]`,
  `pos: Vec2`, `color: string`, `ground`: triangulate the star polygon as a
  **fan from `pos`** (one triangle per boundary edge: `pos, polygon[i],
  polygon[i+1]`, wrapping), drape each vertex via `groundHeightAt` at
  `ground + 0.02`, one `meshStandardMaterial` (`roughness: 0.95`,
  `side: DoubleSide`, `polygonOffset`, `polygonOffsetFactor: -1`, matching
  ribbons). Pads are **not selectable** in v1 — decoration only, no `onClick`.
- **`StreetRibbonMesh`** exports its `pavingOf(street)` helper so the pad color
  can reuse the exact same palette.
- **`StreetNetworkView`** memoizes `junctionClips`, `streetSpans`, and
  `deriveJunctionPads` once from `network`, plus a `streetsById` lookup. It
  passes each `StreetRibbonMesh` its spans (from the map, or `undefined`), and
  renders one `JunctionPadMesh` per pad, resolving `color =
  pavingOf(streetsById.get(pad.dominantStreetId))`. Roundabout/monument/marker
  rendering is unchanged except that the ribbons no longer occlude the ring.

## Coexistence & invariants

- **Roundabouts**: ribbons clip to the ring's outer radius; no hull pad; the
  ring/island/monument now sit in a clean gap (fixes the occlusion bug).
- **Canals / bridges**: any junction with a canal incident is excluded from both
  clipping and padding; canal rendering and bridges are untouched.
- **Terrain**: pads and clipped ribbons drape on the tilted ground via
  `groundHeightAt`. Flat ground (`slope 0`) is byte-identical to a flat pad.
- **Byte-identical when inert**: a single street, or any network whose streets
  share no junctions, produces one span per street (equal to today's filleted
  centreline) and zero pads → identical geometry to before this feature.
- **Save/Load**: nothing new is stored. Pads and spans are fully **derived** from
  `network`; the document schema is unchanged.

## Parameters (named constants)

- `CLIP_K = 1.3` — `clipR` (the along-centreline clip distance) as a multiple of
  the max incident half-width. > 1 keeps `pos` comfortably interior to the star
  and the corner chords clear of the ribbons.
- `ROUNDABOUT_OUTER_R` — used as `clipR` at roundabout junctions. It currently
  lives as a private const in `StreetNetworkView.tsx`; move it into the street
  lib (`src/lib/street/types.ts`, beside `STREET_SPECS`) as the single source of
  truth and import it from both the pure `junctionPad.ts` and the component, so
  the pure module never imports from a component. Value unchanged (9).
- Pad plane `+0.02` and `polygonOffsetFactor -1` — reused from `StreetRibbonMesh`
  so pad and ribbon share one plane.

## Testing (vitest, pure — `src/lib/street/junctionPad.test.ts`)

- `clipCentreline`: mid-disc → two spans with split points on the circle;
  end-disc → one shortened span; two discs (both ends) → middle span; disc
  radius ≥ street length → `[]`; no discs → input unchanged (byte-identical).
- `mouthsAt`: a straight street clipped at `clipR` → one mouth with `M` at
  distance `clipR` from `pos`, `left`/`right` exactly `M ± h·n` (so
  `|left − right| = width`), and `n ⟂ t`; a through street → two mouths on
  opposite sides.
- `junctionClips`: a `+` X-crossing gives each of the two streets one mid disc;
  a T gives the branch an end disc and the through street a mid disc; a
  canal-incident junction contributes no discs; a roundabout junction's discs
  use the ring radius.
- `deriveJunctionPads`: `+` crossing → one pad whose polygon has 8 vertices
  (4 mouths × 2 cap corners), **contains the junction centre** (point-in-polygon)
  and whose winding is CCW; each mouth's two consecutive polygon vertices are
  `width` apart (the cap edge); T and node likewise (6 and 4 vertices); a
  canal-incident junction → no pad; a roundabout junction → no pad;
  `pad.dominantStreetId` equals the widest incident street's id; `pad.pos`
  equals the junction centre.
- `streetSpans`: a lone street with no junctions → **absent from the map**;
  a street clipped by one junction → one entry whose span count is right
  (through → 2, ending → 1).

Everything else (draping, the merged ribbon mesh, the pad mesh, the roundabout
gap) is a browser check per the project's visual-verification pattern.

## Explicitly deferred (documented, not built)

- **Rounded kerb-return corners.** v1 pads use straight chords between mouths.
  True corner radii are a later polish.
- **Crosswalks / lane markings / per-traffic-mode pad blends.** The pad is one
  flat color (the widest incident street's).
- **Single-street self-overlap at a very sharp fillet bend.** That is a
  *different* z-fight mechanism — one ribbon mesh folding over itself at a
  hairpin, not a multi-street junction — so trim+pad does not address it. If it
  shows in practice it gets its own fix (e.g. a mitre-limit tightening or a
  per-street depth cue).
- **Selectable pads.** v1 pads are decoration; clicking one is a no-op.
- **Degenerate hairpin node.** If two streets share an endpoint yet leave it in
  nearly the *same* direction (both mouths bunched to one side), `pos` may not be
  interior to the star polygon and the fan can self-overlap. This is a
  pathological, effectively-never-drawn arrangement; v1 accepts a possible minor
  artifact there rather than adding special-casing.

## File layout

```
src/lib/street/
  junctionPad.ts        NEW — clipCentreline, junctionClips, mouthsAt,
                        streetSpans, deriveJunctionPads (pure)
  junctionPad.test.ts   NEW — the tests above
  types.ts              MOD — move ROUNDABOUT_OUTER_R here (from the component)
src/components/street/
  JunctionPadMesh.tsx   NEW — one star-polygon pad, fan-from-pos, terrain-draped
  StreetRibbonMesh.tsx  MOD — optional spans prop; per-span open ribbons;
                        export pavingOf
  StreetNetworkView.tsx MOD — memo pads + spans + streetsById, pass spans,
                        render pads (color via pavingOf), import
                        ROUNDABOUT_OUTER_R from types.ts
```
