# Real-City Import — Milestone 4: Promote a Footprint to an Editable Lot — Design Spec

**Date:** 2026-07-26
**Status:** Design approved (brainstorming). Fourth and final milestone of the
real-city integration (see [[project-roadmap-arcgis]]).
**Depends on:** M1 real terrain (`2026-07-24-arcgis-terrain-import-design.md`)
for the `GeoAnchor` projection frame and `groundHeightAt` draping seam; M2
context buildings (`2026-07-25-context-buildings-design.md`) for
`ContextBuilding`, the merged-mesh picking path and `hiddenIds`; M3 streets
(`2026-07-25-street-import-design.md`) for the imported `StreetNetwork` the
frontage derivation orients against.

## Purpose

User requirement (verbatim, 2026-07-25): *"outlines should be lots on land not
bounding box."*

M2 imported real footprints as **inert grey backdrop** — you could look at them
and demolish them, nothing more. M4 makes one editable: click a real building,
promote it, and its **real parcel polygon** becomes a lot you design on. The
plot boundary is the true footprint, never a bounding-box approximation.

## Non-negotiable invariant

**No `parcel` field → byte-identical to today.** One optional field is added to
`FacadeBlock`; every new code path is gated on its presence. `SCENE_VERSION`
stays **1** — additive optional, exactly as M1–M3 did (`deserializeScene`
rejects a version mismatch, so a bump would reject every existing beta save).

## Measured scale (why the decisions below are what they are)

All figures measured against the committed Amsterdam fixture
(`public/fixtures/amsterdam/`, 1,585 buildings, 212 streets), not estimated.

| Metric | p05/p10 | median | p90/p95 |
|---|---|---|---|
| Vertices per footprint | 4 | **7** | 20 (p95 30, max 162) |
| Best-fit **oriented** bbox fill ratio | 0.71 | 0.91 | 1.00 |
| Plot aspect (long/short) | 1.20 | **2.25** | 4.21 |
| Longest single edge ÷ perimeter | 0.19 | **0.31** | 0.39 |

Three consequences drive the whole design:

1. **Only 18% of footprints are quads.** A bbox is not a rounding error; it is
   the wrong shape for 82% of the city. This is what makes the user's
   constraint binding rather than cosmetic.
2. Even the *generous* case — a min-area **oriented** bbox, not axis-aligned —
   misses ≥10% of plot area on **47%** of buildings, and ≥5% on **62%**.
3. **The longest edge is only ~31% of the perimeter.** There is no single
   "front edge" to grab. A frontage is a *chain* of short edges, so any design
   that picks the longest edge as the facade is dead on arrival.

Frontage derivation (near-collinear chains scored by length, street proximity
**and facing**) run over all 1,585 fixture buildings:

```
frontage derived: 1571 / 1585  (99.1%)   failed: 14
frontage length (m)   p05 3.2   median  6.5   p95 26.9
parcel depth   (m)   p05 3.0   median 12.5   p95 33.6
depth < 3 m  (below MASSING_DEPTH_MIN):   5.0%
depth > 20 m (above MASSING_DEPTH_MAX):  22.3%
frontage >= 10 m:                           34%
```

**The facing term is load-bearing, and an early prototype without it was
wrong.** Scoring on `length / (1 + k·dist)` alone puts the facade on a canal
house's 25 m PARTY WALL instead of its 6 m canal frontage, because a long edge
running away from the street is still close to it at one end. That prototype
reported median frontage **13.9 m** and median depth **6.0 m** — Amsterdam
exactly backwards — and still "succeeded" on 99.3% of buildings, because
success measures whether a frontage was produced, not whether it was the right
one. With facing included the same corpus reads 6.5 m wide and 12.5 m deep,
which is what a canal house actually is. Regression-tested in
`parcel.test.ts` ("puts the facade on a canal house's NARROW end").

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| **How faithful is the 3D mass?** | **Parcel outline only.** The real polygon is the lot boundary drawn on the ground; the building is the EXISTING rectangular box engine, its width and depth derived from the polygon. | The engine's core assumption is *straight facade line + rectangular box body* — `blockFrame` reduces a block to `origin/dir/normal/length`, and roofs, section strips, basements, corner miters and the window instancer are all built on that box. A polygon mass would degrade every one of them on 82% of the city. This choice turns M4 from "teach the engine about polygons" into "derive four numbers from a polygon", which is a pure-function problem. **Accepted tradeoff:** the box under-fills the parcel (median 91%, p10 71%); the outline shows exactly where. |
| **What does promotion produce?** | **A fresh design on the plot.** Reality contributes the *plot* — frontage line, facing, width, depth. The generator contributes storeys, style, roof, colour, ornament. | The user's call. Removes any need for a height→storeys mapping, so `ContextBuilding.height` is not consumed by promotion at all. **Accepted tradeoff:** the promoted building's height no longer matches the real one, so the skyline changes on promotion. |
| **Where does `massingDepth` come from?** | **The parcel, not the generator.** | `generateLot` draws `massingDepth` from 6–12 m, but real plot depth spans p05 3.0 m to p95 33.6 m around a 12.5 m median. A generated depth would sit inside its own parcel only by luck — too deep on a shallow plot (pushing the box out through the back of its outline) and far too shallow on a deep one. Depth is plot geometry, not building character. |
| **Depth clamps** | Clamp to the existing `[MASSING_DEPTH_MIN, MASSING_DEPTH_MAX]` = `[3, 20]`. Do NOT widen the range. | The 22.3% of plots deeper than 20 m get a 20 m building and a deep back garden — which is how Amsterdam plots actually work (deep courtyards and gardens behind the canal houses), so the clamp is architecturally right rather than merely tolerable. The 5.0% shallower than 3 m overshoot their plot by a few centimetres; the outline makes it visible. Widening `MASSING_DEPTH_MAX` would change the depth slider's range for every existing building. |
| **Subdivision** | **One outline → one lot**, plus a reversible **Subdivide ↔ Merge** pair in the block panel. | 34% of real frontages are ≥10 m, so the default `lotWidth` of 5–9 m would silently turn one real building in three into 2+ designed ones. Defaulting to 1:1 preserves the parcel→lot relationship the constraint implies; the action makes a terrace an explicit, per-building choice. (An earlier prototype put this at 73%, but that was the pre-facing scoring measuring side walls as frontages.) |
| **Promotion gesture** | **One at a time, via a Context Building inspector** (same idiom as the Street / Intersection / Square / Corner inspectors). | Smallest surface. The pure core (`polygon → FacadeBlock`) is identical for bulk, so marquee promote is cheap additive work later. It also retires a real wart: today a single Select-tool click **instantly demolishes** a real building with no confirmation. |
| **Suppressing the grey original** | **Derived, not stored:** `promotedSources = new Set(blocks.map(b => b.parcel?.source).filter(Boolean))`; rendering hides `hiddenIds ∪ promotedSources`. | Matches the codebase's dominant pattern (nodes, corners, intersections, squares, junction pads and open blocks are all derived). Two behaviours fall out free: **Restore hidden** cannot resurrect a grey copy on top of a promoted block, and **deleting a promoted block brings the real building back** — a natural undo with no undo stack. |
| **Does the outline move with the block?** | **No. The parcel outline is fixed.** | It is a real plot boundary. Dragging the building off its plot is then *visible*, which is information the designer wants. |
| **Clear terrain** | **Promoted blocks survive.** | They are user work built on real geometry, exactly like the hand-drawn blocks and streets that M3's Clear-terrain already preserves. Their outlines keep rendering because the polygon is stored on the block, not re-fetched. |
| **Interaction with `syncStreetBlocks`** | **No new guard needed.** | Verified at `src/lib/facade/streetBlocks.ts:58-60`: it partitions on `b.source`, and source-less blocks pass through untouched. A promoted block carries `parcel` but no `source`, so it is treated as hand-drawn. |

## Data model

**One new optional field on `FacadeBlock`** (`src/lib/facade/blocks.ts`):

```ts
/** Set on blocks promoted from an imported real footprint (M4). The real
 * parcel polygon in local metres, the source OSM id, and the CLAMPED plot
 * depth. Absent on drawn and street-derived blocks. */
parcel?: { source: string; outline: [number, number][]; depth: number };
```

**Why `depth` is stored rather than re-derived.** `generateLot` draws
`massingDepth` from 6–12 m, and BOTH `rerollBlock` and `refit` call it — so
without a recoverable parcel depth, a reroll or a node drag would silently push
a promoted building out through the back of its own outline. Re-deriving from
the live block line is not an option either: the parcel is fixed while the line
is not, so after a node drag the derived depth would change for a plot that has
not moved. A pure `applyParcelDepth(block)` in `blocks.ts` (there, not in
`promote.ts`, to avoid a `generate.ts ↔ promote.ts` import cycle) re-pins every
lot after those mutations and returns non-promoted blocks by identity.

**Page state:** adds `selectedContextBuilding: string | null`. No other new
state — the suppression set is derived (above).

**Document:** `parcel` rides along inside each block, already serialized.
`deserializeScene` validates the shape (`source` a string, `outline` an array
of ≥3 finite `[number, number]` pairs) and **drops a malformed parcel rather
than throwing**, matching its existing "validates, defaults, never throws"
contract.

## Pure module `src/lib/geo/parcel.ts`

Polygon geometry only. It imports `nearestPointOnStreets` from
`lib/street/geometry` and nothing from `lib/facade`, so the dependency runs
`facade → geo` and never both ways.

```ts
type Vec2 = [number, number];

interface Chain {
  /** First vertex of the run. */ a: Vec2;
  /** Vertex after the last edge of the run. */ b: Vec2;
  /** Source edge indices, in order. */ idx: number[];
}

interface FrontageFit {
  line: { a: Vec2; b: Vec2 };
  flipped: boolean;
  /** RAW parcel extent behind the frontage, in metres — deliberately
   *  unclamped. `MASSING_DEPTH_MIN/MAX` live in `facade/layout.ts`, and
   *  importing them here would invert the module dependency; `promoteParcel`
   *  owns the clamp instead, so there is exactly one place that applies it. */
  depth: number;
}

/** Maximal near-collinear runs of consecutive edges. Starts scanning from a
 *  real corner so a run is never split arbitrarily at index 0. Pure. */
export function edgeChains(outline: Vec2[], toleranceDeg?: number): Chain[];

/** Shoelace area, always positive. */
export function parcelArea(outline: Vec2[]): number;

/** Pick the street-facing frontage chain and fit the block line, facing and
 *  depth. `network` null or empty → the longest chain wins via the SAME
 *  scoring expression, not a separate branch. Returns null for a polygon
 *  that cannot carry a facade. Pure. */
export function fitFrontage(
  outline: Vec2[], network: StreetNetwork | null,
): FrontageFit | null;
```

**Algorithm.**

1. Signed area → winding. Real OSM ways wind **both ways** (`ContextBuildings`
   already documents this, which is why it renders `DoubleSide`), so "outward"
   must be derived per polygon and never assumed.
2. Group edges into maximal near-collinear chains, tolerance **20°**.
3. Discard any chain shorter than `MIN_FRONTAGE` — too short to carry a facade
   makes it a non-candidate, **not** a reason to reject the plot. A stepped
   frontage often has its best-facing run in a 1.5 m step, and rejecting there
   refused promotable buildings that had a longer usable chain right beside
   them (measured: 98.6% → 99.1%).
4. Score each surviving chain
   `length * facing / (1 + STREET_PULL * distToStreet)`, with
   `STREET_PULL = 0.35`, `probe` = the chain midpoint pushed
   `PROBE_OUT = 0.5` m along the outward normal, and
   `facing = OFF_STREET_FLOOR + (1 − OFF_STREET_FLOOR) · max(0, nOut · toStreetUnit)`
   where `OFF_STREET_FLOOR = 0.25`. Probing *outward* stops the far side of a
   narrow plot scoring as well as the near side; the `facing` factor is what
   stops a long side wall beating a short street frontage (see above). The
   floor is nonzero so a winner always exists — a plot ringed by streets, or
   one a street runs straight through, still resolves. With no network, no
   street in range, or a degenerate `toStreet`, `facing` is 1 and the longest
   chain simply wins.
5. The winner's endpoints become `line` **verbatim, unswapped**;
   `flipped = dot(n, nOut) < 0`, where `n = [-dir.z, dir.x]` is the normal
   `blockFrame` would derive unflipped and `nOut` is the chain's outward
   normal. `blockFrame` reads the endpoints in reverse when `flipped`, which
   negates the normal — so this single boolean is the whole facing decision,
   and it is the same field the existing `f` / Flip side control writes.
6. `depth = max over ALL outline vertices of (−nOut · (v − line.a))`,
   returned **unclamped** (`promoteParcel` clamps). Taking the max over every
   vertex, not just the winning chain's, is what makes an L-shaped plot's
   depth correct.
7. Return `null` when the outline has <3 vertices, zero area, or EVERY chain
   is shorter than `MIN_FRONTAGE = 2` m — a genuinely tiny footprint (a shed,
   a canopy). 14 of 1,585 real buildings, 0.9%.

**Two deliberate choices, with reasons:**

- **Chain endpoints, not a least-squares fit.** The building's ends must land
  on the plot's real corners; a fitted line floats off both. Using endpoints
  makes `params.width` exactly the real frontage span.
- **One scoring expression for both cases.** With no streets every chain
  scores `length / 1`, so the longest wins. The no-network path is therefore
  the *same* code, not a second fallback branch that tests would have to cover
  separately.

## Pure module `src/lib/facade/promote.ts`

Consumes the fit and builds blocks. Pure — no three, no React.

```ts
/** Real footprint → a ready-to-render FacadeBlock with ONE generated lot.
 *  null when the parcel cannot carry a facade (see fitFrontage). */
export function promoteParcel(
  building: ContextBuilding,
  network: StreetNetwork | null,
  gen: BlockGenSettings,
  seed: number,
): FacadeBlock | null;

/** One lot → a terrace via the existing generateBlock, propagating the
 *  parcel depth to every new lot. null when it cannot split. */
export function subdivideBlock(block: FacadeBlock, seed: number): FacadeBlock | null;

/** Terrace → one lot spanning the whole frame. null when any lot is
 *  customized (merging would silently discard hand edits). */
export function mergeBlock(block: FacadeBlock, seed: number): FacadeBlock | null;
```

`promoteParcel` sets, on its single lot:

- `params.width` = frontage length
- `params.massingDepth` = `fit.depth` **clamped** to
  `[MASSING_DEPTH_MIN, MASSING_DEPTH_MAX]` — the single place the clamp is
  applied
- `depthOffset: 0` — the generator's ±`depthJitter` would shove the building
  off its own plot
- `customized: false` — so Reroll still works on a promoted building
- `block.parcel = { source: building.id, outline: building.footprint }`

`subdivideBlock` is offered when `lots.length === 1` and the frontage is at
least `2 * gen.lotWidth.min`; `mergeBlock` when `lots.length > 1` and no lot is
`customized`.

## Integration

- **`ContextBuildings.tsx`** — gains `onSelect?: (id: string) => void`
  alongside `onHide`, and renders the selected building in a distinct colour
  through the existing single-building highlight-geometry path. `onSelect`
  undefined ⇒ not interactive, following the established convention.
- **`FacadeControls.tsx`** — new `ContextBuildingPanel`: OSM id, parcel area,
  vertex count, and a **live preview of the frontage length and depth the
  promotion would produce**. The preview is produced by calling
  `promoteParcel` itself and reading `lots[0].params` — not by re-deriving the
  numbers — so the panel can never disagree with the result, and the clamp is
  not duplicated. `promoteParcel` is pure and cheap, so previewing by building
  the real thing is the simplest correct option. Buttons **Promote to lot**
  (disabled, with the reason stated, when `promoteParcel` returns null) and
  **Demolish**. The block panel gains the **Subdivide / Merge to one lot**
  action.
- **`FacadeViewer.tsx`** — `onSelectContextBuilding` is threaded through the
  single `selectMode` gate at the props-destructuring point, so it is
  Select-tool-only for free and needs no per-call-site guard. Selecting a
  context building clears every other selection and vice versa.
- **`SceneContents.tsx`** — renders a `ParcelOutline` for each block carrying
  `parcel`: a closed draped line loop sampled through `groundHeightAt`, drawn
  with `NodeLine` so it works on both renderers, with the same small y-lift the
  sidewalk and street ribbons already use to clear the ground in the top-down
  plan view.
- **`app/facade/page.tsx`** — `handlePromote(id)` looks up the building, calls
  `promoteParcel`, appends the block through the existing `syncCorners` choke
  point, and clears the selection. Derives `promotedSources` and passes
  `hiddenIds ∪ promotedSources` to `ContextBuildings`.

## Testing (vitest, pure + visual)

`src/lib/geo/parcel.test.ts`:
- `edgeChains`: rectangle → 4; rectangle with a collinear midpoint → still 4;
  L-shape → 6; tolerance boundary (19° merges, 21° does not); identical result
  for CW and CCW windings.
- `fitFrontage`: unit square with a street to the north → north edge, resolved
  normal `+z`; same square, street south → south edge (via `flipped`, with the
  line endpoints unswapped); **no network → longest chain**; depth is the max
  over ALL vertices on an L-shaped plot and is returned **unclamped**; `null`
  for <3 vertices, zero area, and a sub-2 m winning chain.
- `parcelArea`: winding-independent, correct for a non-convex L.

`src/lib/facade/promote.test.ts`:
- `promoteParcel`: exactly one lot; `width` == frontage length;
  `massingDepth` == fit depth **clamped**, exercised on a 2 m-deep plot (→ 3)
  and a 28 m-deep plot (→ 20); `depthOffset` 0; `parcel.source` set;
  deterministic in `seed`; `null` propagates from `fitFrontage`.
- `subdivideBlock` / `mergeBlock`: widths sum to the frame length; parcel depth
  propagated to every lot; merge restores one lot; merge refuses when any lot
  is `customized`; subdivide refuses below `2 * lotWidth.min`.

`src/lib/facade/document.test.ts`: round-trips `parcel`; a malformed parcel is
dropped, not thrown.

**Fixture guard** (the `demoPlace.test.ts` idiom): run `fitFrontage` across all
1,585 fixture buildings and assert ≥99% succeed and that no returned line,
depth or normal is NaN. This is the test that catches a real regression,
because it runs the algorithm against real, adversarial geometry rather than
hand-written shapes.

**Visual** — and per AGENTS.md, in this codebase the bugs that mattered were
only findable by running the app, so a green suite is necessary, not
sufficient: load the demo place, promote a canal house, confirm the facade
faces the canal and the outline sits on the real plot; subdivide and merge;
save, reload, confirm the outline survives; delete the block and confirm the
grey building returns; confirm Restore hidden does not resurrect a promoted
one; confirm Clear terrain leaves promoted blocks standing.

## Not in scope (deferred)

- **Bulk / marquee promote.** The pure core is identical, so it is additive
  work: extend `marquee.hitTest` to context buildings and map `promoteParcel`
  over the selection.
- **Polygon-shaped mass.** Considered and rejected above; the parcel outline
  carries the real shape instead.
- **Welding adjacent promoted neighbours.** Blocks weld only on bit-identical
  endpoints (`nodes.ts:13`), and each frontage line is fitted independently, so
  two promoted party-wall neighbours abut without corner-merging. That is
  correct for now — they are separate buildings, not a corner.
- **Smarter facing with no street nearby.** The longest-chain guess stands; the
  existing `f` / Flip side control already corrects it.
- **Promoting the real height.** Explicitly traded away by the "fresh design on
  the plot" decision.
- **Merging a customized terrace.** Refused rather than silently discarding
  hand edits.

## Roadmap position

- **M1 — real terrain.** Shipped 2026-07-25.
- **M2 — context buildings.** Shipped 2026-07-25.
- **M3 — streets & canals.** Shipped 2026-07-25.
- **M4 — promote footprint → editable lot.** This spec. Closes the
  real-city-import roadmap; the binding requirement *"outlines should be lots
  on land not bounding box"* is satisfied by storing and drawing the true
  parcel polygon, with the box building fitted inside it.
