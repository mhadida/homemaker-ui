# Street centreline + street-aware block creation — design

**Date:** 2026-07-14
**Feature tag:** v10
**Status:** approved (conversational), ready for implementation

## Problem

When a user draws a new block with the pen tool, its facade faces the *left*
of the drawn `a→b` stroke (`blockFrame` normal `= [-dir[1], dir[0]]`). So the
facade orientation is a coin-flip on drag direction — blocks come out
"inside-out" (facing away from the street) about half the time.

## Goal

1. Derive a **street centreline** and a **mirror line** (opposite frontage)
   from the first drawn block, rendered as construction guides in the Plan
   pane.
2. Make new blocks **street-aware**: a block drawn within the street corridor
   auto-orients its facade toward the centreline (near side and far/mirror
   side both face the street).
3. A live **`f`-to-flip** control while drawing: press `f` to toggle the
   facade facing direction, with live feedback on the in-progress segment.
   This is the manual override, and the *only* orientation control for the
   very first block (which has no street reference yet).

## Approach (chosen: A — derived from first block)

The **reference block** is `blocks[0]` (the earliest surviving block). Its
facade normal defines which side the street is on. All street geometry is
derived **live** from that block each render, so it always stays consistent
(and re-derives from the next block if `blocks[0]` is deleted).

- **Street width**: page state, default **14 m**, a slider. Half-width = 7 m.
- **Centreline** = reference line offset by `+halfWidth` along the reference
  facade normal.
- **Mirror line** (far frontage) = reference line offset by `+streetWidth`
  along the normal (i.e. the reference frontage reflected across the
  centreline).

Rejected alternative **B** (explicit "draw centreline" tool / first-class
streets): more UI, deferred. Can promote later.

## Pure module: `src/lib/facade/street.ts`

All geometry + orientation logic, pure and unit-tested. No React.

```ts
export interface StreetRef {
  /** reference frontage line, plan coords */
  a: [number, number];
  b: [number, number];
  /** unit facade normal of the reference block (points toward the street) */
  normal: [number, number];
}

export const STREET_WIDTH_MIN = 6;
export const STREET_WIDTH_MAX = 40;
export const STREET_WIDTH_DEFAULT = 14;

/** Construction lines derived from the reference. `centre` is the street
 * spine; `mirror` is the far frontage. null when no reference (blank world
 * or single blockless state). Lines span the reference extent + padding. */
export interface StreetLines {
  centre: { a: [number, number]; b: [number, number] };
  mirror: { a: [number, number]; b: [number, number] };
}
export function streetLines(ref: StreetRef, width: number, pad?: number): StreetLines;

/** Build a StreetRef from the reference block (blockFrame gives normal). */
export function streetRefOf(block: FacadeBlock): StreetRef;

/**
 * Street-aware `flipped` for a new segment (a→b), before the user's f-toggle.
 * Returns the `flipped` that makes the segment's facade normal point TOWARD
 * the centreline, when the segment midpoint is within the corridor
 * (|signed distance to centreline| <= width * CORRIDOR_FACTOR). Outside the
 * corridor, or with no reference, returns false (drawn orientation).
 * The caller XORs the user's f-toggle on top.
 */
export function streetAwareFlipped(
  ref: StreetRef | null,
  width: number,
  a: [number, number],
  b: [number, number],
): boolean;

/** The resolved facing used by BOTH the pen preview and commit: auto XOR f. */
export function resolveFacing(
  ref: StreetRef | null,
  width: number,
  a: [number, number],
  b: [number, number],
  fFlip: boolean,
): boolean; // = streetAwareFlipped(...) !== fFlip
```

`CORRIDOR_FACTOR = 1` → corridor is ±1 street-width from the centreline
(covers near frontage at −halfWidth and far frontage at +halfWidth with
generous margin).

### Orientation math

For segment `a→b`, the two candidate facade normals are `n` (flipped=false)
and `−n` (flipped=true), where `n = normalize([-(b.z−a.z), (b.x−a.x)])` in
plan `[x,z]`. Let `m` = segment midpoint, `c` = nearest point on the
centreline to `m`, `toC = normalize(c − m)`. Choose `flipped` so the chosen
normal has the **larger dot** with `toC` (face toward the centre). Ties
(segment collinear with the "toward centre" test, e.g. exactly on the
centreline) → false.

The corridor test uses the signed perpendicular distance from `m` to the
centreline along the centreline normal.

## Wiring

- **page.tsx**
  - New state `streetWidth` (default `STREET_WIDTH_DEFAULT`).
  - `streetRef = useMemo(() => blocks[0] ? streetRefOf(blocks[0]) : null, [blocks])`.
  - `resolveFacing` callback closes over `streetRef` + `streetWidth`,
    passed to `FacadeViewer` (for the pen preview).
  - `handleCommitLine(a, b, fFlip)` sets
    `flipped = resolveFacing(streetRef, streetWidth, a, b, fFlip)` and builds
    the block with it (`generateBlock(line, flipped, gen, seed)` + `flipped`).
- **FacadeViewer / PlanPane / PenSurface**
  - Thread `streetLines` (or the ref + width) + `resolveFacing` down to the
    Plan pane.
  - **Centreline + mirror**: two thin dashed `<Line>`s in the plan pane
    (centre: dashed light; mirror: dashed dimmer). Only when `streetRef`
    exists.
  - **PenSurface**: add `f`/`F` to the keydown listener → toggle
    `facingFlip` state (reset with the path). The dashed preview segment
    gains a short **normal tick** (an arrow/line from the segment midpoint
    along the resolved facing normal) so `f` has live feedback. On commit,
    call `onCommitLine(last, target, facingFlip)`.
  - `onCommitLine` signature gains a third arg `fFlip: boolean`.
- **FacadeControls**: a "Street width" slider (global section, near
  Topography), `STREET_WIDTH_MIN..MAX`.

## Scope / non-goals

- Orientation is applied **on creation only** — dragging an existing block
  does not auto-flip. (Matches "when I start a new block.")
- One street (from `blocks[0]`). Multiple independent streets deferred.
- The centreline is a **construction guide** — it does not generate geometry,
  snap endpoints, or constrain drawing.
- `blocks[0]` itself is oriented by `f` at draw time (or the existing "Flip
  side" button afterward).

## Byte-identical invariant

With no reference block (first block) and `f` untouched, `resolveFacing`
returns `false` → `flipped: false` → identical to today's `handleCommitLine`.
Street width defaults change no existing block. The construction lines are
additive render-only.

## Tests (`src/lib/facade/street.test.ts`)

- `streetRefOf` normal matches `blockFrame` normal.
- `streetLines`: centre at halfWidth, mirror at fullWidth, along normal.
- `streetAwareFlipped`: a segment on the near side faces +toward centre; a
  segment on the far/mirror side faces −toward centre (both point at the
  spine); segment outside corridor → false; no ref → false.
- `resolveFacing`: XOR of auto and fFlip (4 combinations).
- Corridor boundary: just inside vs just outside the `width*CORRIDOR_FACTOR`
  band.
