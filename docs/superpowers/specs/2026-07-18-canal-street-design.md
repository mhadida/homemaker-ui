# Canal Street Type — Design

**Status:** spec
**Date:** 2026-07-18
**Extends:** `2026-07-15-street-network-design.md`,
`2026-07-16-street-realism-design.md`, `2026-07-16-buildings-on-edges-design.md`.

## Problem / goal

Add a fifth street type, **`canal`**: a drawn waterway with a recessed water
channel held by stone quay walls, a walkable sidewalk along each bank, canal
houses fronting the water, and an arched stone footbridge wherever a land street
crosses it. Drawn with the existing Roads tool via the type selector — no new
tool, no new page state. It coexists additively with the road network; a scene
with no canals is byte-identical.

## Decisions (from brainstorming)

- **Recessed channel + quay walls** (Amsterdam/Venice), not a flush plane.
- **Arched stone footbridge** at every canal↔land crossing, pedestrian, the same
  at every crossing.
- **Canals auto-populate canal-house frontages** like every other street type —
  only the set-back offset differs.

## Cross-section

Symmetric about the centreline. From the centre outward, each side:

```
centre │──── water/2 ────│ quay │─── sidewalk ───│ building line
        (WATER_WIDTH/2)   (QUAY)   (SIDEWALK)
```

- `WATER_WIDTH` = `STREET_SPECS.canal.width` = **14** (overridable per canal via
  `Street.width`).
- `QUAY` = **0.5** m — the quay-wall thickness; the wall drops `WATER_DEPTH` from
  bank grade to the water surface.
- `SIDEWALK` = **3** m — paved walkable band at bank grade.
- `WATER_DEPTH` = **1.2** m — water surface below bank grade.

**Bank half-offset** (centreline → building line) is therefore
`WATER_WIDTH/2 + QUAY + SIDEWALK = 7 + 0.5 + 3 = 10.5` m.

## Constants and types

New `StreetType` member `"canal"` and `STREET_SPECS` row:

```ts
canal: { width: 14, allowsCars: false, label: "Canal", minRadius: 45 },
```

`minRadius: 45` (road-scale) — waterways turn gently.

Adding the union member is deliberately compiler-forcing: every
`Record<StreetType, …>` and exhaustive switch (e.g. `PAVING` in
`StreetRibbonMesh.tsx`) must gain a `canal` arm, so tsc enumerates every place
that must decide what a canal does. Canal-specific constants live in the new
`src/lib/street/canal.ts`:

```ts
export const CANAL_QUAY = 0.5;
export const CANAL_SIDEWALK = 3;
export const CANAL_WATER_DEPTH = 1.2;
export const BRIDGE_DECK_WIDTH = 3;   // pedestrian breadth (along the canal)
export const BRIDGE_RISE = 1.5;       // arch apex above bank grade
```

## Geometry — `src/lib/street/canal.ts` (pure, unit-tested)

The canal reuses the existing centreline pipeline: `filletCentreline` for the
smoothed alignment, then the **mitered** `streetRibbon` (post square-corners fix)
at three half-widths to produce four offset polylines per side:

| Offset half-width | Edge |
|---|---|
| `WATER_WIDTH/2` | water edge (top of quay wall, inner) |
| `WATER_WIDTH/2 + QUAY` | quay foot / sidewalk inner edge |
| `WATER_WIDTH/2 + QUAY + SIDEWALK` | sidewalk outer edge = building line |

From these, pure builders return triangle soup / vertex bands (facade-independent,
draping applied by the component — see below):

- `canalWaterSurface(centreline, width)` → the water quad strip between the two
  water edges.
- `canalQuayWalls(centreline, width)` → two vertical strips, each from a water
  edge (at `−WATER_DEPTH`) up to bank grade.
- `canalSidewalks(centreline, width)` → two flat bands between quay foot and
  sidewalk outer edge, at bank grade.

Each builder returns 2-D offset polylines + the y-rule (`grade` or
`grade − WATER_DEPTH`); the component lifts to world Y via `groundHeightAt` per
vertex (same drape as `StreetRibbonMesh`). Walls stay a constant `WATER_DEPTH`
tall because both the bank edge and the water edge drape together.

## Bridges — derived, like roundabouts

**Trigger (pure predicate).** For each `deriveIntersections` junction, a bridge
is placed iff its incident streets include **≥ 1 canal AND ≥ 1 non-canal** (a
land path meeting water). Canal↔canal junctions merge with no bridge;
land↔land junctions are unaffected.

```ts
export interface BridgePlacement {
  key: string;          // the intersection key
  pos: Vec2;            // junction point
  tangent: Vec2;        // unit canal direction at pos
  span: number;         // bank-to-bank crossing length
}
export function bridgesFor(net: StreetNetwork,
                           intersections: Intersection[]): BridgePlacement[];
```

- `tangent` — the canal centreline direction at `pos`, found by
  `closestPointOnSegment` across the incident canal street's segments (robust to
  the `incident.vertex` index ambiguity documented in `intersections.ts`; locate
  by `pos`, never `points[vertex]`).
- `span` = `WATER_WIDTH + 2·QUAY` = 15 m — the arch springs from each sidewalk's
  inner edge and crosses the channel **perpendicular to the canal** (along the
  canal normal); the deck's breadth (`BRIDGE_DECK_WIDTH`) runs along `tangent`.

**Arch geometry (pure).** `bridgeArchTriangles(placement)` → a humpback:
a deck strip `BRIDGE_DECK_WIDTH` wide following a segmental-arc profile that
rises `BRIDGE_RISE` at centre, springing at bank grade on each side, plus two
low stone parapets. Corner-frame construction, placed by the component at `pos`
with the yaw from `tangent`; draped so the springing points sit on the banks.

## Buildings on the banks

The only change to building derivation is the set-back. In
`src/lib/street/frontage.ts`, replace the hard-coded `PAVEMENT_GAP` term with a
per-type bank half-offset:

```ts
function bankHalf(s: Street): number {
  return s.type === "canal"
    ? effectiveWidth(s) / 2 + CANAL_QUAY + CANAL_SIDEWALK
    : effectiveWidth(s) / 2 + PAVEMENT_GAP;
}
```

Used for both the `StreetInfo.half` (the `insideOther` exclusion radius, so
other streets' buildings stay out of the canal + quay + sidewalk zone) and the
offset ribbon whose edges are the building lines. **The non-canal branch is
identical to today's formula**, so non-canal frontages are byte-identical.
Corner welding, refit, reroll, `syncStreetBlocks` — all unchanged; canal houses
are ordinary derived blocks that happen to sit 10.5 m off the centreline.

## Crossing streets need no trimming

Because the water is **recessed below grade**, a land street crossing the canal
stays a flat draped ribbon at bank grade and naturally forms the crossing
surface; water shows only in the open stretches between crossings, and the arch
sits on top as the visible bridge. This deliberately sidesteps the mid-span
land-ribbon trimming that the street-network spec already defers — nothing new
to untangle.

## Rendering

- **`src/components/street/CanalMesh.tsx`** — one canal street: water surface
  (translucent blue `meshStandardMaterial`, low roughness, `transparent`,
  `opacity ≈ 0.8`, `depthWrite` off), two quay-wall strips (stone grey), two
  sidewalk bands (light stone). Draped via `groundHeightAt`, mirroring
  `StreetRibbonMesh`'s per-vertex lift. Selectable/hoverable exactly like a road
  ribbon (`onSelect`, tint on select).
- **`src/components/street/BridgeMesh.tsx`** — one arch per `BridgePlacement`.
- **`src/components/street/StreetNetworkView.tsx`** — route each street:
  `type === "canal"` → `<CanalMesh>`, else `<StreetRibbonMesh>`; and render a
  `<BridgeMesh>` for each `bridgesFor(...)` placement. The intersection
  markers/roundabout logic is unchanged.

## UI

The Roads tool's type selector gains a **Canal** option, driven by
`STREET_SPECS` (the label is already data). The Street inspector already edits
any street (type, width override, delete) — no inspector change. A canal can
still become a roundabout junction only at a land↔land junction (canal
junctions carry no roundabout); no new inspector state.

## Save / Load

`FacadeDocument` already serializes `streetNetwork` verbatim; `"canal"` is just
another `type` string and `width` override. No version bump, no migration — an
old document with no canals loads identically, a saved canal round-trips.

## Deferred (documented, not built)

- Animated / rippling water (static surface for v1).
- Boats, mooring, locks/steps in the channel.
- True-horizontal (level) water on steep slopes — v1 drapes the surface parallel
  to the banks at constant depth.
- Land-ribbon trimming at crossings (unnecessary with the recessed channel).
- Bridges carrying a car street's width/paving — v1 is a fixed pedestrian arch,
  as chosen.
- Per-canal sidewalk/quay overrides — fixed constants for v1.

## Testing

`src/lib/street/canal.test.ts` (vitest, matching the existing street-module
pattern):

- `bankHalf` value for canal (10.5) and identity with the old formula for
  non-canal types.
- the three offset polylines sit at the correct half-widths from the centreline.
- quay walls are `WATER_DEPTH` tall; water surface is `WATER_DEPTH` below the
  bank band.
- `bridgesFor`: canal + non-canal → one bridge; canal + canal → none;
  land + land → none; `tangent` is the canal direction and `span = 15`.
- `bridgeArchTriangles`: apex rises `BRIDGE_RISE`, deck breadth
  `BRIDGE_DECK_WIDTH`, springs at bank grade, non-empty soup.

Plus `frontage` tests: a canal produces building lines at `bankHalf`; a
non-canal network's frontages are unchanged.

**Gates:** `npm test`, `npx tsc --noEmit`, `npx eslint src` (baseline 3
pre-existing warnings — no new ones).

**Visual check before merge** (CDP, established technique): seed a canal with a
crossing street and buildings, confirm recessed water + quay walls + sidewalks,
an arch at the crossing, and canal houses along both banks; confirm a flat-ground
canal and true byte-identical output for a canal-free scene.

## Byte-identical invariant

No `canal` streets in a scene → output unchanged: the `StreetType` union gains a
member but no existing street selects it, `bankHalf` non-canal branch equals the
current formula, `bridgesFor` returns empty, and `StreetNetworkView` routes every
existing street to `StreetRibbonMesh` as before.
