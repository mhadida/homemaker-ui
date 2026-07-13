# Roofs — Design Spec (v7)

**Date:** 2026-07-14
**Status:** Design decisions made autonomously (owner authorized finishing
v5–v8 locally; owner reviews decisions table on return).
**Depends on:** v6 massing (roofs cap the mass), v5 sections, v4 corners.

## Purpose

Cap each building's massing with a roof. User requirement (verbatim):
"then roofs with different types - hip, gable, flat, perpendicular or
parallel to street, etc."

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| Types | `flat`, `gable`, `hip`. (Mansard/shed = deferred.) | Covers the user's three named types; the "etc" is future. |
| Default type | **`flat`** — no roof mesh (the flat mass top is the roof). Pre-v7 params render byte-identical. | Same "absent = old behavior" invariant as sections/massing. Pitched roofs are opt-in / generated. |
| Orientation | `parallel` \| `perpendicular` to street = the RIDGE direction. Parallel = ridge along facade width (street sees a slope; gable ends on the party sides). Perpendicular = ridge front-to-back (street sees the gable end / hip slope). Ignored for flat. | Directly the user's "perpendicular or parallel to street." |
| Ridge height | `roofHeight` metres above the eaves, clamped [0.5, 8], default 3. Absolute (not a pitch angle) so a wide shallow building can't produce an absurdly tall roof. | Predictable, matches the massing "depth in metres" pattern; clamps trivially. |
| Eave (roof base) | `y = layout.wallTop`. Cornice/parapet coexist unchanged (a parapet in front of a pitched roof is a real, if uncommon, combo). | Simplest; the wall body top is the eaves. |
| Footprint | Lot width × mass depth: x ∈ [−W/2, W/2], z ∈ [−WALL_THICKNESS, −massingDepth]. One roof per LOT (spans all sections), not per section. | The roof caps the whole building; section relief is all below the eaves. |
| Hip ridge inset | Standard equal-pitch hip: ridge inset from each end (along the ridge axis) by half the cross-span, clamped so it degenerates to a pyramid when the cross-span exceeds the length. | Classic hip geometry; the pyramid degenerate is handled, never invalid. |
| Material | Fixed slate-grey matte (not per-lot color for v7). `roofColor` deferred. | "Just roofs"; a color field is easy to add later. |
| Corners | Roof `type` + `height` are SHELL fields (synced across a corner so both wings match); `orientation` is per-wing (each faces its own street). Valley-merge of the two wings' roof solids is DEFERRED — they overlap opaquely. | Cheap coherence now; true hip-valley merging at arbitrary angles is a large separate piece. |
| Generation | `generateLot` picks a type (weighted: some flat, some gable, some hip), an orientation, and a height, all seeded. | Street variety. |

## Data model

`FacadeParams` gains:
```ts
roofType?: "flat" | "gable" | "hip";          // absent = "flat"
roofOrientation?: "parallel" | "perpendicular"; // absent = "parallel"
roofHeight?: number;                            // absent = ROOF_HEIGHT_DEFAULT
```
Layout/`roof.ts` constants: `ROOF_HEIGHT_MIN = 0.5`, `ROOF_HEIGHT_MAX = 8`,
`ROOF_HEIGHT_DEFAULT = 3`.

## Pure module `src/lib/facade/roof.ts`

```ts
interface RoofPlan {
  type: "gable" | "hip";     // flat resolves to null (no plan)
  eaveY: number;             // wallTop
  ridgeY: number;            // wallTop + clamped height
  x0: number; x1: number;    // −W/2, W/2
  zFront: number; zBack: number; // −WALL_THICKNESS, −massingDepth
  /** ridge line endpoints in plan [x,z] (at ridgeY) */
  ridge: { a: [number, number]; b: [number, number] };
}
resolveRoof(params, wallTop, massingDepth): RoofPlan | null
```
- flat → `null`.
- gable: ridge spans the full length along the orientation axis at the
  cross-center.
- hip: ridge inset by `min(crossSpan/2, length/2)` at each end (pyramid when
  clamped to length/2).
- All clamping (height range, non-finite sanitize, degenerate footprint)
  lives here. Emitted on `FacadeLayout.roof` from `computeLayout`.

## Mesh (`FacadeMesh.tsx`)

One roof mesh per lot (rendered after the sections loop, using `layout.roof`):
build a `THREE.BufferGeometry` from the plan —
- **gable**: 2 slope quads (eave edge → ridge) + 2 vertical gable triangles.
- **hip**: 2 slope trapezoids (eave → ridge) + 2 end slope triangles (eave
  corners → near ridge end).
Compute vertex normals; slate-grey `meshStandardMaterial`, castShadow +
receiveShadow. The geometry is built with `new THREE.BufferGeometry` and
attached via `geometry=`, so it is disposed with the same
`useMemo`+`useEffect(()=>()=>geo.dispose())` pattern the wall strips use.
`null` roof → render nothing.

## Corner shell sync

`corners.ts` `SHELL_FIELDS` gains `roofType`, `roofHeight` (NOT
`roofOrientation`). Corner wings then share roof style/height.

## Controls

New "Roof" `Section` in the lot panel: type buttons (Flat / Gable / Hip);
when not flat, an orientation toggle (Parallel / Perpendicular to street)
and a Height slider (0.5–8 m, step 0.25).

## Testing (vitest, pure)

- `resolveRoof`: flat → null; gable ridge spans full length at cross-center
  for both orientations; hip ridge inset = crossSpan/2, pyramid when
  crossSpan ≥ length; height clamp [0.5,8] + default + non-finite sanitize;
  ridgeY = wallTop + height; footprint z from massingDepth.
- Orientation swaps the ridge axis (parallel = along x, perpendicular =
  along z).
- No-roof-field path (`roofType` absent) → `layout.roof === null` and no
  other layout output changes (existing suite pins it).
- `generateLot`: type ∈ {flat,gable,hip}, orientation ∈ set, height in
  [0.5,8], deterministic, reroll pins.
- `SHELL_FIELDS` includes roofType/roofHeight, excludes roofOrientation.
- Mesh triangle assembly verified in the browser.

## Not in scope (deferred)

Corner hip-valley merge; mansard/shed/gambrel; per-lot roof color;
dormers/chimneys; roof overhang/eave projection; AI prompt for roofs;
roof interaction with parapet (they simply coexist).
