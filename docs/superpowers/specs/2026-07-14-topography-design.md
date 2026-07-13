# Topography + Leveling Basements — Design Spec (v8)

**Date:** 2026-07-14
**Status:** Design decisions made autonomously (owner authorized "finish
until t8 locally" AND flagged this feature as the one most wanting their
review). The AUTHORING MODEL decision is the one to revisit first.
**Depends on:** v6 massing (basement sits under the mass footprint), all v1–v7.

## Purpose

User requirement (verbatim): "and later i want to adapt to arbitrary
topography. that buildings will sit on a 'basement' with thin horizontal
windows to level the ground floor."

The essential deliverable is the **leveling basement**: a building's ground
floor stays level even though the ground under it slopes, with a plinth
(basement) filling the gap on the downhill side, pierced by thin horizontal
(semi-basement) windows.

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| **Topography authoring** | **Global tilted ground plane**: `slope` (rise/run, 0–0.3) + `azimuth` (uphill bearing, 0–360°). NOT per-node heights or a heightfield (deferred). | Delivers the leveling-basement mechanic with the least disruption to the node/block/placement system. `slope = 0` → flat → byte-identical to today. "Arbitrary" per-node topography is the natural follow-up. **← revisit this first.** |
| Ground height function | `h(x,z) = slope·(x·sin(az) + z·cos(az))` (pure, in `terrain.ts`). | A plane; simplest arbitrary-direction slope. |
| Building floor datum | The ground height at the building's **front-centre** (where it meets the sidewalk). The whole building lifts to `y = datum`. | The ground floor meets the street naturally; the basement handles the drop behind/downhill. |
| Basement drop | `datum − min(ground height at the 4 footprint corners)`, ≥ 0. Basement box height = drop. | The plinth reaches the ground on the lowest corner; the tilted ground buries the uphill part. `slope 0 → drop 0 → no basement`. |
| Basement geometry | One stone-coloured box (lot width × drop × mass depth) from the floor (local y = 0) down to `−drop`, with a row of **thin horizontal windows** on the street face (short, wide, dark). | Matches "basement with thin horizontal windows." Rendered only when `drop > 0.3 m` (no sliver plinths). |
| Ground mesh | The ground plane + grid tilt to the slope plane (quaternion from +y to the surface normal). Contact shadows stay flat (minor on slopes; acceptable). | The world reads as sloping; buildings sit on it at their datums. |
| Corners | Each wing levels to its own front-centre datum. Two wings share a node so their datums are close but may differ slightly (a small step). Shared-datum leveling deferred. | Independent leveling is simple and close-enough; matching is polish. |
| Sections / massing / roofs | Unaffected — they render in the building's local frame from `y = 0` up; lifting the group to `y = datum` carries them all. The basement is below `y = 0`. | The whole building is one group; the y-shift is transparent to everything above the floor. |
| Control | A global **Topography** panel section: Slope + Azimuth sliders (like Sun). Not per-lot. | Topography is a world property, not a building property. |
| Empty/default | `slope = 0` default → flat ground, no basements, group y = 0, untilted ground — exactly today. | Same "default = old behavior" invariant as every prior feature. |

## Data model

Page state: `ground: { slope: number; azimuth: number }`, default
`{ slope: 0, azimuth: 0 }` (threaded to `SceneContents` like `view`/`maxCornerAngle`).
No `FacadeParams` change (topography is world state, not per-building).

## Pure module `src/lib/facade/terrain.ts`

```ts
export interface Ground { slope: number; azimuth: number }
export const DEFAULT_GROUND: Ground;         // { slope: 0, azimuth: 0 }
export const GROUND_SLOPE_MAX = 0.3;
export function groundHeightAt(x: number, z: number, g: Ground): number;
export interface Leveling { datum: number; drop: number }
export function levelingFor(
  cx: number, cz: number, width: number, depth: number,
  rotationY: number, g: Ground,
): Leveling;                                  // datum = h(cx,cz); drop = datum − min corner h
export function groundNormal(g: Ground): [number, number, number]; // for the tilt quaternion
```
All the topography math + clamps live here; `SceneContents` renders from it.

## SceneContents

- Tilt the ground plane + grid: wrap in a group whose quaternion rotates
  `+y` → `groundNormal(g)`.
- Per building (`BlockGroup` → per lot): compute
  `levelingFor(placement.x, placement.z, width, massingDepth, rotationY, g)`;
  set the lot group's `position.y = datum`; render a `<Basement>` below it
  when `drop > 0.3`.
- `<Basement>` (new component): stone box (width × drop × depth) from
  local y = 0 down to −drop, plus a row of thin horizontal windows on the
  front face. Plain geometry, disposed the R3F-element way (no manual
  dispose — `<boxGeometry>` children).

## Controls

`FacadeControls` gains a global **Topography** `Section` (rendered always,
outside the lot/block/corner branches — it's world state): Slope slider
(0–0.3, step 0.01, shown as %) + Azimuth slider (0–360°). Threaded via new
`onGroundChange` prop from the page (like `onViewChange`).

## Testing (vitest, pure)

- `groundHeightAt`: 0 at origin; slope 0 → 0 everywhere; rises along the
  azimuth (uphill) direction, falls opposite; azimuth 0/90/180/270 sanity.
- `levelingFor`: flat (slope 0) → datum 0, drop 0; a sloped ground → datum =
  front-centre height, drop = positive and equal to the corner spread;
  rotationY rotates the footprint correctly (drop invariant under 180° flip).
- `groundNormal`: unit vector; +y at slope 0; tilts toward downhill.
- Basement threshold + geometry verified in the browser.

## Not in scope (deferred)

Per-node / heightfield "arbitrary" topography (the real next step); shared
corner datum; contact shadows on slopes; retaining walls / steps between
buildings; basement material per-lot; roads/sidewalks following the slope
per-segment; AI for topography.
