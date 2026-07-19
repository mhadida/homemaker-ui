# Corner L-Roof + Elbow Fill — Design

**Status:** spec
**Date:** 2026-07-17
**Supersedes/extends:** `2026-07-14-roofs-design.md` (the "corner hip-valley merge deferred" note),
`2026-07-13-corner-buildings-design.md`. Closes backlog task #70.

## Problem

A unified corner building is two wings that today render as two independent
masses, each an axis-aligned box in its own lot's frame with its own tent roof.
Two defects follow:

1. **Convex corners have a `massingDepth × massingDepth` void.** At the outer
   side of a street corner the two wings' boxes meet at a *point*; the elbow
   behind them is unbuilt. With street-derived buildings (`massingDepth = 10`)
   that is a 10 m × 10 m hole at every corner. Visible in plan and in 3D.
2. **The two roofs are unrelated.** Wing A's ridge runs along world-x, wing B's
   along world-z. At a concave corner the two tents interpenetrate; at a convex
   corner they don't meet at all.

`miterFor` (`corners.ts:390`) already solves defect 1's *shape* — but only for
the thin wall slab (`tan(τ/2) × WALL_THICKNESS`). It is the right formula with
the wrong thickness.

**Rejected:** filling the elbow and extending each wing's roof span with it.
Verified wrong — see "Why not just extend the tent" below.

## Goal

A unified corner reads as **one mass with one roof**: the elbow is solid, and a
single hip/valley roof spans both wings, with proper ridges meeting at a point,
a valley at the reentrant corner and a hip at the outer corner.

## Geometry

### Corner frame

All corner geometry is computed in a **corner-local frame**, then placed once in
world space. Definitions (plan coords, `Vec2 = [x, z]`):

- `V` — the facade node (`corner.node`), the frame origin.
- `uA`, `uB` — unit vectors from `V` **into** each wing along its line
  (`awayDir` in `corners.ts:31`).
- `nA`, `nB` — each wing's **outward facade normal** (`blockFrame(...).normal`).
- `D` — the shared massing depth (see "Shared depth" below).
- `Wa`, `Wb` — the corner lots' widths.
- `convex` — `corner.convex` (`uB · nA > 0`).

Each wing's body is `{ V + s·u − d·n : s ∈ [0, W], d ∈ [0, D] }`.

### Key points

| Point | Definition | Role |
|---|---|---|
| `V` | corner node | reentrant corner when convex; outer when concave |
| `Q` | intersection of the two **back eave lines** (`V − D·nA + t·uA` and `V − D·nB + s·uB`) | outer corner when convex; reentrant when concave |
| `P` | intersection of the two **centrelines** (`V − (D/2)·nA + t·uA` and `V − (D/2)·nB + s·uB`) | the single point where both ridges, the valley and the hip all meet |

For a 90° corner, `Q = V − D·nA − D·nB` and `P = V − (D/2)·nA − (D/2)·nB`.
In general both are 2×2 line intersections. `Q` and `P` are computed the same
way for convex and concave; only their *roles* swap.

### Footprint

An L-shaped hexagon, both cases:

```
V → V + Wa·uA → V + Wa·uA − D·nA → Q → V + Wb·uB − D·nB → V + Wb·uB → (close)
```

Convex: this wraps *outside* the corner and the elbow (`V`, `Q` region) is new
area — the fill. Concave: the same hexagon describes the union of two
overlapping boxes; nothing is added.

### The roof is exactly four planes

Each wing's front and back eave line generates a plane rising at the shared
gradient `m`. The roof is those four planes, **each restricted to its own quad
face**. Their pairwise intersections give every crease for free:

| Intersection | Crease |
|---|---|
| A-front ∩ A-back | wing A's ridge |
| B-front ∩ B-back | wing B's ridge |
| A-front ∩ B-front | **valley** (from the reentrant corner to `P`) |
| A-back ∩ B-back | **hip** (from the outer corner to `P`) |

All four planes meet at `P` at height `ridgeY`.

**The four faces** — each a quad, two vertices at `eaveY` and two at `ridgeY`:

| Face | Plan polygon |
|---|---|
| A-front | `[Vr, V + Wa·uA, V + Wa·uA − (D/2)·nA, P]` |
| A-back | `[Vo, V + Wa·uA − D·nA, V + Wa·uA − (D/2)·nA, P]` |
| B-front | `[Vr, V + Wb·uB, V + Wb·uB − (D/2)·nB, P]` |
| B-back | `[Vo, V + Wb·uB − D·nB, V + Wb·uB − (D/2)·nB, P]` |

where `Vr` = reentrant corner (`V` if convex else `Q`) and `Vo` = outer corner
(`Q` if convex else `V`).

Plus the two **end treatments** at the party walls, reusing the existing model:
gable → a vertical triangle; hip → the ridge insets by `min(D/2, W)` and the end
becomes a slanted quad. Identical rule to `resolveRoof` (`roof.ts:59-79`).

`ridgeY = eaveY + roofHeight`, and `m = roofHeight / (D/2)` — the gradient is
derived from the shared depth, which is why the depth must be shared.

### Verification (done during design, must be re-proved by tests)

For `D = 10, Wa = 24, Wb = 18`, convex, 90°:

- The four faces' areas sum to **520 m² = the L's area exactly**, with **0
  gaps and 0 overlaps** across 13 000 sample points.
- Adjacent faces agree along every shared crease (valley, hip, both ridges) —
  no cracks.

Note for the implementer: a brute-force "height = eaveY + m × distance to
nearest eave **segment**" reference is **not** ground truth — at a reentrant
corner it measures radially from the vertex and produces a spurious cone that
peaks *above* the ridge (12.38 m vs a 12.0 m ridge). The correct surface uses
the eave **lines** restricted to their faces, which is what the construction
above does. Test against the face decomposition's own invariants (tiling, area,
crease continuity, known-point heights), not against segment distance.

### Why not just extend the tent

Filling the elbow and extending wing A's rectangular tent over it is wrong.
At a point in the elbow near the reentrant corner — `(-D/2, -0.1·D)` in the
worked example — A's extended tent gives `eaveY + 0.1·D·m` (9.6 m) because it
thinks A's front eave is 0.1·D away. But that stretch of A's front line is
*interior* to the L (wing B is on the other side of it), so it is not an eave.
The true roof there is at **ridge height** (12.0 m): the elbow drains sideways
over B's back eave, not forward. The tent is wrong by 2.4 m. Extending both
wings' tents instead crosses the two ridges in an X and pokes through.

## Preconditions (and why)

A corner merges into one mass + one roof only when all hold. Otherwise it falls
back to **exactly today's behaviour, byte-identical**.

| Precondition | Why |
|---|---|
| `cornerChoice.mode === "unified"` | two-facades mode means two buildings by definition |
| both wings share `massingDepth` | the four planes need one gradient `m`; different depths → different pitches → the planes don't meet at `P` |
| both wings' `roofOrientation === "parallel"` | one merged mass has one roof topology: ridges follow each street |
| concave only: `Wa > D/2` **and** `Wb > D/2` | `P` must lie inside both wings. Convex has no such constraint — `P` sits in the elbow at `−D/2` along each `u`, which the corner mass owns. |

`roofType`/`roofHeight`/`roofColor` already sync (`SHELL_FIELDS`,
`corners.ts:103`), so they need no new precondition.

`roofType === "flat"` → no roof mesh (as today), but **the elbow is still
filled** — a flat corner mass is just the massing.

## Changes

### 1. Shared depth and orientation become shell fields

Add `massingDepth` and `roofOrientation` to `SHELL_FIELDS`. At a unified corner
`syncCorners` additionally **forces `roofOrientation` to `"parallel"`**.

Rationale: a corner mass's roof follows both streets; "perpendicular" describes
a gable-fronted single frontage and has no meaning across an L. This removes a
per-wing degree of freedom at unified corners only — hand-drawn straight blocks
and two-facades corners are untouched.

This supersedes the AGENTS.md claim that "orientation stays per-wing" — that
remains true except at unified corners.

### 2. Shared datum

`levelingFor` runs **per lot** (`SceneContents.tsx:154`), so on sloped ground the
two corner lots sit at different floor datums and a merged roof would tear.

A unified corner's two lots level as one: both use the datum computed at the
**primary side's** corner-lot centre (`cornerChoice.primary`). Flat ground
(`slope === 0`) is unaffected — every datum is already equal, so this is
byte-identical there.

### 3. Elbow fill (massing)

New `massMiterFor(corner, depth): { a: number; b: number }` in `corners.ts`,
mirroring `miterFor` with `D` in place of `WALL_THICKNESS`:

- convex → `a = min(tan(τ/2)·D, MASS_MITER_MAX·D)`, `b = 0` (one wing fills, the
  other butts — extending both would double-fill).
- concave → `{ a: 0, b: 0 }` (the boxes already overlap; opaque same-colour
  overlap is invisible).

`MASS_MITER_MAX = 3`, matching `miterFor`'s `3 × WALL_THICKNESS` cap. `turn` is
capped at `DEFAULT_MAX_CORNER_ANGLE = 150°` where `tan(75°) ≈ 3.73`, so the cap
binds only on the sharpest corners.

This is a **separate, larger** extension from the wall miter — the wall keeps
`tan(τ/2) × WALL_THICKNESS`. `StripMass` takes its own `x0`/`x1`; the wall slab
and ornament bands keep theirs.

### 4. `cornerRoof.ts` — new pure module

```ts
export interface CornerRoofPlan {
  /** corner-frame quads, each 4 points [x, y, z]; y is eaveY or ridgeY */
  faces: Vec3[][];
  /** gable/hip end treatments, already resolved to polygons */
  ends: Vec3[][];
  eaveY: number;
  ridgeY: number;
}

/** Pure. null when any precondition fails → caller falls back to per-wing. */
export function cornerRoofPlan(input: CornerRoofInput): CornerRoofPlan | null;

/** Pure: plan → triangle soup, corner-frame. Winding not guaranteed; the
 * mesh auto-orients by normal (same contract as roofTriangles). */
export function cornerRoofTriangles(plan: CornerRoofPlan): Vec3[];
```

`CornerRoofInput` carries only plain data (`V`, `uA`, `uB`, `nA`, `nB`, `D`,
`Wa`, `Wb`, `convex`, `type`, `eaveY`, `roofHeight`) — no `FacadeBlock`, so the
module stays trivially testable.

### 5. Rendering

- New scene-level `<CornerRoofMesh>` in `src/components/facade/`, rendered as a
  sibling of `InstancedFacadeBoxes` in `SceneContents.tsx`. One per merged
  corner, placed at the corner datum with the corner frame's yaw. Colour from
  the primary side's `roofColor` via the existing `ROOF_COLORS`.
- New `roof?: boolean` prop on `FacadeMesh` (default `true`). The two merged
  corner lots pass `roof={false}`, which suppresses **the roof mesh and its
  dormers** (dormers ride the suppressed roof, so they must go with it).
  `FacadeMesh` currently has no suppression path — the roof is gated only on
  `layout.roof` being non-null (`FacadeMesh.tsx:903`).

## Deferred (documented, not built)

- **Dormers on a merged corner roof.** v1 suppresses dormers on merged corner
  lots. The four-face plan makes them tractable later (each face is planar).
- **Shaped gables at a merged corner.** `gableStyle` rises the street wall above
  the eave; against an L-roof the profile has no single wall to rise from. v1
  leaves `gableStyle` rendering per-wing, which is why it must be visually
  checked at a merged corner before merge.
- **Passage arch inside the elbow.** The elbow is solid; a passage in a corner
  lot still pierces its own strip only.
- **Three-or-more-way junctions.** `detectCorners` already only fires on
  exactly two refs (`corners.ts:58`).

## Testing

Pure modules get unit tests (`vitest`), matching the project's existing pattern:

- `cornerRoof.test.ts`: the four faces tile the L (area sum equals the
  footprint's, no overlap); crease continuity (valley/hip/both ridges agree from
  both sides); `P` at `ridgeY`; `V` and `Q` at `eaveY`; 90° and non-90° turns;
  convex and concave; hip vs gable ends; every precondition returns `null`.
- `corners.test.ts`: `massMiterFor` — convex extends by `tan(τ/2)·D`, concave is
  zero, the cap binds, a 0° turn is zero.
- `corners.test.ts`: `syncCorners` forces parallel orientation and shares depth
  at unified corners, and does not at two-facades corners.

**Gates:** `npm test`, `npx tsc --noEmit`, `npx eslint src` (baseline is 3
pre-existing warnings — no new ones).

**Visual check before merge** (CDP, per the established technique): seed a
square ring road + a T-branch, confirm at a convex corner that the elbow is
solid and the roof shows a hip; at a concave corner that the roof shows a
valley; and that a `gableStyle` corner still renders acceptably.

## Byte-identical invariant

With no unified corners in the scene — or any precondition unmet — output is
unchanged: `massMiterFor` returns zero, `cornerRoofPlan` returns `null`, no
`<CornerRoofMesh>` renders, `roof` defaults `true`, and the shared datum equals
the per-lot datum on flat ground.
