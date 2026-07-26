# Real-City Import — Milestone 3: Streets & Canals — Design Spec

**Date:** 2026-07-25
**Status:** Design approved (brainstorming). Third milestone of the real-city
integration (see [[project-roadmap-arcgis]]).
**Depends on:** M1 real terrain (`2026-07-24-arcgis-terrain-import-design.md`)
for the `GeoAnchor` projection frame, and M2 context buildings
(`2026-07-25-context-buildings-design.md`) for the source-agnostic provider +
validated-route + Overpass-failover/cache pattern this milestone reuses.

## Purpose

User requirement (verbatim, 2026-07-25): *"turning the existing GIS data into
our data — streets to streets, buildings to buildings, canals to canals."*

Loading a real place also imports its **real streets and canals as ordinary,
editable `Street` objects** in the existing `StreetNetwork`. Unlike M2's
context buildings — inert backdrop — imported streets genuinely *become our
data*: they render as paved ribbons with fillets, junction pads and derived
intersections, they drape on M1's terrain, they can be selected, re-typed,
re-routed, deleted, and they persist in the saved document like any hand-drawn
street.

## Non-negotiable invariant

**No place loaded → no import → byte-identical to today.** Every new field is
additive and optional; an empty import changes nothing.

## Measured scale (why the decisions below are what they are)

One small central-Amsterdam bbox (the picker's default framing, ~0.018° ×
0.007°, the same one that yields 1,585 context buildings):

| Source | Count |
|---|---|
| `highway` ways | **780** (3,809 vertices) |
| of which `footway`/`cycleway`/`steps`/`path` | **373** (48%) |
| `waterway=canal` ways | **70** |

OSM fragments a single human street into many ways (one per tag change or
junction): "Nieuwe Herengracht" is **9** separate ways, "Herengracht" **8**.
The existing `StreetNetwork` was designed for 5–50 hand-drawn segments, and
every segment drives fillets, ribbon geometry, junction-pad derivation,
intersection derivation and square derivation.

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| **Auto-buildings interaction** | **Force the global `buildingsFromStreets` toggle OFF when a place is imported.** No per-street flag, no data-model change. | `syncStreetBlocks` generates parametric frontage buildings along EVERY street; on ~100+ imported streets that would spawn thousands of lots on top of M2's real footprints. Chosen over an `imported` flag for simplicity. **Accepted tradeoff:** it also stays off for streets drawn by hand afterwards until the user re-enables it. |
| **Which ways** | **Roads only.** Drop `footway`, `cycleway`, `steps`, `path`, `construction`. | 373 of 780 are pedestrian/cycle paths; importing them yields spaghetti, and steps are not streets. |
| **Fragmentation** | **Merge contiguous ways sharing `(name, mapped type)` into one polyline**, reversing where needed. Unnamed ways are NOT merged (no reliable key). | Turns ~470 fragments into ~100–130 real streets: fewer false junctions, cleaner ribbons, and behaviour much closer to hand-drawn streets. |
| **Class mapping** | `motorway`/`trunk`/`primary` (+`_link`) → **boulevard**; `secondary`/`tertiary` (+`_link`) → **road**; `residential`/`unclassified`/`living_street`/`busway` → **street**; `service` → **alley**; `pedestrian` → **street** with `traffic: "peds"`; `waterway=canal` → **canal**. **Every `*_link` follows its parent class** — a slip road off a secondary road is part of that road's continuity, and dropping it would leave visible gaps at junctions. | Maps OSM's hierarchy onto the five existing `StreetType`s by width/importance. `pedestrian` is a real street that happens to be car-free — exactly the Dutch city-centre case the traffic modes already model. |
| **Width** | OSM `width` tag when present and sane (finite, 1–60 m); else the `STREET_SPECS` type default. | Only 1 of 70 canals carries `width`, so defaults carry almost everything. |
| **Load semantics** | **Load place REPLACES `streetNetwork.streets`** (and prunes now-dangling roundabout/square choices). | Consistent with terrain and context buildings being replaced. Appending would duplicate on a second load of the same place. **Accepted tradeoff:** loading a place discards hand-drawn streets. |
| **Persistence** | Imported streets are ordinary `Street`s and ride the EXISTING `streetNetwork` field in the document. **No re-fetch on load** (unlike footprints). | They are "our data" now — editable and saved. This is the key asymmetry with M2. |
| **Provider** | `StreetProvider` interface + `OsmStreetProvider`, behind **`POST /api/streets`**. Reuses M2's Overpass mirror-failover, transient/fatal classification, `User-Agent`, timeout and TTL cache. | Same source-agnostic seam; an Esri adapter implements the same interface later. |
| **Caps** | Same bbox span guard as buildings (`MAX_BUILDING_SPAN_DEG`, 0.05). **`MAX_STREETS = 600`** post-merge, truncating **longest-first** with `truncated`/`total` reported. | Bounds derivation cost. Truncation is surfaced, never silent, and keeps the significant streets: ungroupable stubs would otherwise be emitted before merged named chains and survive the cut. **Measured basis:** the original "600 bounds derivation cost" claim was wrong by an order of magnitude — at 227 streets one `StreetNetworkView` pass cost 387 ms and ran on all four mounted panes (~1.5 s per network change, ~1.8 s per pointermove while dragging a vertex). After deriving intersections once per network and bucketing `deriveIntersections` through a spatial grid, one pass is **19 ms**, which is what makes 600 defensible. |
| **Failure isolation** | Terrain, buildings and streets fetch **in parallel and fail independently**. | Overpass is slow and rate-limits; one failure must not roll back the others. |
| **Ids** | `street-osm-<wayId>` for a single way, `street-osm-<firstWayId>m` for a merged chain. Passed through `reserveStreetIds` so later hand-drawn ids can't collide. | Stable, traceable to source, and safe alongside the existing `street-N` counter. |

## Data model

**No change to `Street`, `StreetNetwork`, or the document shape.** Imported
streets are ordinary `Street` objects (`id`, `type`, `points`, optional
`width`/`traffic`) in the existing `streetNetwork`, already serialized.

**Page state:** reuses M2's `bbox`; adds `streetsLoading`, `streetsError`,
`streetsInfo { truncated, total }` — independent of the buildings status.

## Pure module `src/lib/geo/streets.ts`

```ts
interface OsmWay {
  type: string; id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}
interface StreetFetchResult {
  streets: Street[]; truncated: boolean; total: number;
}

/** OSM highway/waterway class → our StreetType (+ forced traffic), or null to DROP. */
function classifyWay(tags): { type: StreetType; traffic?: TrafficMode } | null;

/** OSM `width` tag → metres, or undefined when absent/insane. */
function parseWidth(tags): number | undefined;

/** Chain contiguous ways sharing (name, type) into maximal polylines.
 *  Unnamed ways pass through unmerged. Pure, order-independent. */
function mergeWays(ways: OsmWay[]): OsmWay[][];

/** Full pipeline: filter → classify → merge → project → cap. */
function osmToStreets(
  ways: OsmWay[], anchor: GeoAnchor, maxStreets: number,
): StreetFetchResult;
```
All projection goes through M1's `project(lat, lon, anchor)` (`east→+x`,
`north→+z`).

## Route

**`POST /api/streets`** (`runtime = "nodejs"`), body `{ bbox, anchor }` →
`200 { streets, truncated, total }` | `400 { error }` | `500 { error }`.
Overpass query (both sources in one union):
```
[out:json][timeout:25];
(way["highway"](S,W,N,E);way["waterway"="canal"](S,W,N,E););
out geom;
```

## Integration (`app/facade/page.tsx`)

- `loadStreets(bbox, anchor)` mirrors `loadContextBuildings`: own request
  token, own error/loading state, never throws into the terrain path.
- `handleLoadPlace` fires terrain, buildings and streets; on street success:
  `setStreetNetwork({ ...EMPTY_NETWORK, streets })`, then
  `setBuildingsFromStreets(false)`.
- `handleClearTerrain` removes only the IMPORTED streets (`street-osm-` id prefix), composed with `pruneRoundabouts`/`pruneSquareMonuments`, and clears the street status. It must NOT wipe the whole network: hand-drawn streets are user work and survive, exactly as hand-drawn blocks already do. It also restores `buildingsFromStreets` to its **pre-import** value (stashed when the import forced it off), never unconditionally to `true`.
- The **Context** panel gains a street count, truncation notice and error line
  beside the buildings ones (same idiom, same `contextLoaded` gate).

## Testing (vitest, pure + visual)

- `classifyWay`: every mapped class → expected type; `pedestrian` → street +
  `traffic:"peds"`; `footway`/`cycleway`/`steps`/`path`/`construction` → null;
  `waterway=canal` → canal; unknown highway value → null.
- `parseWidth`: `"12"`, `"12.5 m"`, `"12,5"`; rejects junk, ≤0, >60.
- `mergeWays`: two ways sharing an endpoint merge (including when the second
  is reversed); three chain into one; unnamed ways never merge; different
  names/types never merge; a closed ring stays closed; order-independent.
- `osmToStreets`: projects through the anchor; drops path classes; caps at
  `maxStreets` reporting the pre-cap `total`; ids follow the documented form.
- `parseStreetsRequest`: accepts a city bbox; rejects non-object, non-finite,
  inverted/zero-area, and over-span (distinguishing the actionable
  "zoom in" message, as `/api/buildings` does).
- Provider: mirror failover, fail-fast on non-transient, `User-Agent` sent,
  cache hit avoids a second fetch.
- Visual: real Amsterdam streets and canals render as ribbons draped on
  terrain, with junction pads; canals show water + bridges; Auto-buildings is
  off after import; selecting an imported street opens the Street inspector
  and re-typing/deleting works; **perf is acceptable at ~100+ streets**.

## Not in scope (deferred)

`highway=*` polygons tagged `area=yes` (pedestrian squares) are DROPPED, not imported — they are areas, not centrelines, and importing them produced 15 ring-shaped "streets" tracing each plaza's perimeter. Mapping them to a plaza/open-space concept is future work. Dual-carriageway merging (OSM models a divided road as two parallel ways);
`oneway`/lane counts/turn restrictions; roundabout detection from
`junction=roundabout` (roundabouts stay a manual per-intersection choice);
bridges/tunnels from `layer`/`bridge` tags; sidewalk tags; rail/tram; relations
(route relations are ignored — ways only); **promoting a context building to an
editable block (M4)**.

## Roadmap position

- **M1 — real terrain.** Shipped 2026-07-25.
- **M2 — context buildings.** Shipped 2026-07-25.
- **M3 — streets & canals.** This spec.
- **M4 — promote footprint → editable block.** Binding requirement recorded:
  *"outlines should be lots on land not bounding box"* — the lot boundary must
  be the real parcel polygon, never a bbox approximation.
