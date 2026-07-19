# Squares & Plazas — Design

**Status:** spec
**Date:** 2026-07-18
**Extends:** `2026-07-15-street-network-design.md` ("open-square plazas deferred"),
`2026-07-16-closed-loop-streets-design.md`,
`2026-07-13-corner-buildings-design.md` (two-facade precedent).

## Problem / goal

A **square** is the open void enclosed by a closed-loop street (a ring). Give it
two things a real urban square has:

1. A **centre monument** — an obelisk or fountain, or none.
2. **Double-fronted perimeter buildings** — the ring buildings that back onto the
   void gain a second facade facing the square, so the void is framed by building
   fronts (Place des Vosges / Plaza Mayor), not blank massing backs.

A square is **derived** from a closed loop — no new draw tool, no stored polygon.
A scene with no closed loops is byte-identical.

## Decisions (from brainstorming)

- A square = **interior of a closed-loop street** (auto-derived).
- Monument is **auto-placed at the centroid**, chosen per square (fountain /
  obelisk / **none**, default none) via a square inspector.
- Buildings on the loop's **interior side** automatically become double-fronted.
- Free-place monuments, drawn plaza polygons, and non-ring squares are deferred.

## Square detection — `src/lib/street/squares.ts` (pure, unit-tested)

```ts
export interface Square {
  streetId: string;        // the closed-loop street enclosing it
  ring: Vec2[];            // the loop polygon (street.points)
  centroid: Vec2;          // polygon centroid — where the monument sits
  interiorSide: "left" | "right";  // which frontage side faces the void
  area: number;            // interior polygon area (m²)
}

export function deriveSquares(net: StreetNetwork): Square[];
```

For every `street.closed === true` with ≥ 3 points:

- `ring` = the street's points; `area` = |shoelace|; `centroid` = polygon
  centroid.
- **`interiorSide`** is found by geometry, not winding assumptions: take a
  representative point of each frontage side (a short outward offset of a mid
  segment) and test **point-in-polygon against `ring`**; the side whose point
  lands inside is interior. Robust to CW/CCW and to non-convex loops.
- **Void guard:** a square is emitted only if the interior, conceptually inset by
  `STREET_BUILDING_DEPTH` (10 m — the ring buildings' depth), still has positive
  area. A ring too small to enclose a void (buildings from opposite sides would
  meet) yields no square, so no monument and no double-fronting — the buildings
  simply fill it as today. Approximated as `area > k · STREET_BUILDING_DEPTH²`
  with a small `k`; exact inset is unnecessary.

`isSquareFrontingBlock(block, squares)` → true when the block's `source.streetId`
is a square's loop **and** `source.side === square.interiorSide`.

## Data model — monument choice (sparse)

Mirrors `roundabouts` exactly:

```ts
// StreetNetwork gains:
squares: [string, Monument][];   // [loop streetId, monument]. Sparse; absent = no monument.
```

A `pruneSquareMonuments(net)` helper (like `pruneRoundabouts`) drops entries whose
loop is no longer a derived square (loop deleted or opened). The square geometry
itself is always derived; only the monument choice is stored.

## Monument rendering

Reuse `MonumentMesh` unchanged (already parameterised by `centre` + `kind` +
`baseY`). For each derived square with a stored monument, render one
`<MonumentMesh centre={centroid} kind={m} baseY={groundHeightAt(centroid)} />` so
it stands plumb at the square's ground height. Placed in `StreetNetworkView`
alongside roundabouts.

## Double-fronted buildings

The ring's interior-side blocks already exist (`syncStreetBlocks` derives both
frontages); each of their lots faces the road, massing extending **back toward
the square** by `STREET_BUILDING_DEPTH`. To open them onto the square, add a
**second facade skin on the massing rear**:

- In `SceneContents`'s per-lot group, when the lot's block is
  `isSquareFrontingBlock`, render a second `<FacadeMesh>` at lot-local
  `position={[0, 0, -massingDepth]}`, `rotation={[0, Math.PI, 0]}` — so its
  outward normal (local +z) points to −z local, i.e. toward the square void.
- That second mesh renders in a new **`skin` mode** (a `skin?: boolean` prop on
  `FacadeMesh`, default false): wall + openings + ornament **only** —
  no massing box, no roof, no basement, no dormers/gable. The front facade's
  massing and roof already span the whole depth and cap both sides, so the rear
  contributes just the window wall against the massing's back face (glazing reads
  against the opaque massing exactly as the front windows do).
- Params are the lot's own (shared shell → same storeys/height/wallTop/colors);
  rotating π mirrors bay order left↔right, acceptable for v1.

`skin` mode is the single new capability in `FacadeMesh`; with `skin` absent it is
byte-identical. This is a **front/back parallel** pair — distinct from the corner
engine's angled wings — so it does not touch `corners.ts`.

## Rendering wiring

- `src/lib/street/squares.ts` — pure detection (above).
- `StreetNetworkView` — derive squares once (`useMemo`), render a `<MonumentMesh>`
  per square-with-monument, and a clickable **square marker** at each centroid
  (like `IntersectionMarker`) for selection.
- `SceneContents` — compute `squares` from `streetNetwork`; pass a
  `squareFronting: Set<blockId>` (or predicate) down to `BlockGroup`; render the
  rear skin mesh for those lots.

## UI

- **Square inspector** in `FacadeControls.tsx` — opens when a square marker is
  selected (new page state `selectedSquare: string | null`, the loop id): a
  monument picker (Fountain / Obelisk / None) writing `network.squares`.
- No new tool: squares appear automatically when a loop is closed.

## Save / Load

`FacadeDocument.streetNetwork` already round-trips; the new `squares` array is
plain JSON. Add it to `EMPTY_NETWORK` (`squares: []`) and default it in
`deserializeScene` when absent so old documents load (no version bump — an old
network simply has no square monuments; squares still derive from its loops).

## Deferred (documented, not built)

- A **paved** square surface — v1 leaves the existing ground/terrain in the void
  with the monument on it; paving/garden treatment is a later option.
- Free-place monuments (parks, medians), and drawn plaza polygons (the "Plaza
  tool" alternative) — separate features.
- Non-ring squares (a void enclosed by several different streets — graph faces).
- An **independently designed** rear facade — v1 mirrors the front params.
- Double-fronting on hand-drawn (non-street) closed chains — v1 keys off
  `source` blocks derived from a closed-loop **street**.

## Testing

`src/lib/street/squares.test.ts`:

- `deriveSquares`: a closed square loop yields one Square with the right
  centroid and area; the interior side is correct for both CW and CCW windings;
  an open street yields none; a too-small loop (void guard) yields none.
- `isSquareFrontingBlock`: an interior-side source block matches; an outer-side
  or open-street block does not.
- `pruneSquareMonuments`: drops a monument whose loop was opened/deleted, keeps a
  valid one.

Plus a `FacadeMesh` render-mode note: `skin` suppresses massing/roof/basement
(asserted structurally where feasible, else covered by the visual check).

**Gates:** `npm test`, `npx tsc --noEmit`, `npx eslint src` (baseline 3 warnings).

**Visual check before merge** (CDP): seed a closed ring, confirm the void reads
as a square framed by building fronts on the inside, a monument at the centre,
and — crucially — that a scene with only open streets is unchanged.

## Byte-identical invariant

No closed-loop streets → no squares: `deriveSquares` returns empty,
`isSquareFrontingBlock` is always false, no rear skins render, no monuments,
`squares: []`. Existing **open**-street scenes are byte-identical. (Existing
closed-loop scenes deliberately change — their inner buildings become
double-fronted; that is the feature.)
