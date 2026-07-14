# Shaped (bent/compound) gables — design

**Date:** 2026-07-14
**Feature tag:** v18
**Status:** approved (both curved + stepped), shipped

## Goal

The street-facing front wall can rise above the eave into an ornamental
**shaped gable** — a curved (Dutch ogee/scroll) or stepped (crow-step)
silhouette — the "bent (compound)" gable of Dutch/Danish town houses.

## Pure module `src/lib/facade/gable.ts`

- `GableStyle = "curved" | "stepped"`; height constants `GABLE_HEIGHT_*`.
- `gableProfile(style, width, rise): Vec2[]` — the silhouette points, facade-
  local (x, y-above-eave), from the LEFT eave corner (−w/2, 0) up over the
  shaped top to the RIGHT eave corner (w/2, 0), symmetric about x = 0. The
  mesh closes the bottom (eave) edge.
  - **curved**: a straight side, a concave shoulder, a convex neck, and a cap
    up to the centre peak — sampled quadratic Béziers (a smooth many-point
    outline).
  - **stepped**: a straight shoulder then `GABLE_STEPS` rectangular crow-steps
    per side rising to a flat central coping.

## Layout + mesh

- `computeLayout` sets `layout.gable: GablePlan | null` (`{style, points,
  baseY}`, `baseY = wallTop`) when `params.gableStyle` is set; height clamped
  `[GABLE_HEIGHT_MIN, GABLE_HEIGHT_MAX]`.
- `FacadeMesh.GableMesh` builds a `THREE.Shape` from the profile (offset to
  `baseY`), extrudes it to `WALL_THICKNESS` (front face at z = 0), wall-
  coloured, with a thin trim-coloured coping `<Line>` tracing the shaped top.

## Controls + corners

- `FacadeControls`: a **Gable** section — none / curved / stepped toggle + a
  height slider (shown when a style is set).
- `gableStyle` + `gableHeight` are corner **shell** fields (both wings of a
  corner building match), alongside the roof shell fields.

## Byte-identical invariant

`gableStyle` absent → `layout.gable` null → no mesh; identical to before.

## Tests (`src/lib/facade/gable.test.ts`)

Both styles: the profile starts/ends at the eave corners, stays within the
width and between eave and peak, reaches the rise at the centre and nowhere
higher, and is symmetric about x = 0; the stepped profile is monotonic up to
the coping; the curved profile is a smooth many-point outline.
