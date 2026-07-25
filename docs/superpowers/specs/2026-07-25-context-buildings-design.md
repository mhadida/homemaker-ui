# Real-City Import — Milestone 2: Context Buildings — Design Spec

**Date:** 2026-07-25
**Status:** Design approved (brainstorming). Second milestone of the real-city
integration (see [[project-roadmap-arcgis]]).
**Depends on:** M1 real-terrain import
(`2026-07-24-arcgis-terrain-import-design.md`, merged to main 2026-07-25) —
this milestone reuses M1's `GeoAnchor` projection frame, its
`TerrainProvider`-style source-agnostic seam, and its bbox validation pattern.

## Purpose

Loading a real place also loads its **real building footprints as grey backdrop
massing**, draped on M1's terrain. The user designs *around* and *into* a real
neighbourhood. Clicking a context building hides it ("demolition"), clearing a
site to design on.

Context buildings are **not editable**. Promoting a real footprint into an
editable parametric `FacadeBlock` is **M4** and explicitly out of scope here;
this milestone deliberately builds the click-selection plumbing M4 will need.

## Non-negotiable invariant

**No place loaded → no context buildings → byte-identical to today.** An empty
`contextBuildings` array renders nothing, and a document without the new
optional fields loads exactly as it does now.

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| **Persistence** | **Re-fetch from a stored bbox.** The document stores `bbox` + `hiddenIds` only; `contextBuildings` is page state, **never serialized**. | A city-scale pick is thousands of polygons (MBs). M1's review already flagged the ~370 KB heightfield straining the localStorage autosave; persisting footprints would break it. Cost: needs network on load, and the backdrop can drift as OSM is edited. |
| **Re-fetch key** | Add **`bbox?: LngLatBBox`** to the document. M1 persisted only `anchor`. | `anchor` alone cannot reproduce the fetch region. |
| **Overlap with drawn work** | **Click a context building to hide it**; `hiddenIds` persists the set. | Explicit user control over demolition, and it builds the click-selection groundwork M4 needs. NOT auto-hide-on-overlap (no way to keep a deliberate overlap) and not global-toggle-only (can't clear one site). |
| **Stable id** | The **OSM element id** (`way/123456`). | Durable across re-fetch — the requirement `hiddenIds` depends on. |
| **Height** | OSM **`height`** tag (metres; tolerate a `m`/unit suffix and decimal comma) → else **`building:levels` × 3** → else default **8 m**. Non-finite/≤0 results fall through to the next rule. | Standard OSM 3D convention; a always-valid height keeps the backdrop from collapsing on sparse data. |
| **Data source** | **OpenStreetMap via Overpass** (tokenless), behind a `BuildingProvider` interface. | Mirrors M1: source stays swappable (an Esri adapter implements the same interface later). No account needed. |
| **Geometry scope** | **`way["building"]` only.** Multipolygon **relations deferred** (documented). | Relations (courtyard holes, building parts) are a minority and a backdrop tolerates their absence; proper multipolygon assembly is disproportionate work for M2. |
| **Caps** | **`MAX_BUILDING_SPAN_DEG = 0.05`** (≈5 km) and **`MAX_BUILDINGS = 4000`**. Exceeding the count **truncates and REPORTS it** (`truncated`, `total`). | Buildings scale far worse than terrain — M1's 0.5° span would be ~10⁶ footprints. Truncation is surfaced in the UI, never silent ("no silent caps"). |
| **Rendering** | **One merged `BufferGeometry`** for all visible buildings: per footprint edge a wall quad, plus a triangulated roof cap. | Thousands of separate meshes would be thousands of draw calls. One merge = one draw call. |
| **Roof cap triangulation** | `THREE.ShapeUtils.triangulateShape`. | Footprints are frequently non-convex; a triangle fan would produce wrong caps. |
| **Draping** | Base = **minimum `groundHeightAt` over the footprint vertices**; top = `base + height`. | Never floats on a slope; buries slightly into the uphill side, which reads correctly for a backdrop. Flat ground → base 0. |
| **Picking** | Raycast the merged mesh → `intersection.faceIndex` → a parallel **`faceBuilding: string[]`** (one id per triangle) → building id. | The only way to resolve an individual building inside a merged mesh. |
| **Hover feedback** | A **second, small geometry** rebuilt for the hovered building only. | You cannot tint one building inside a merged mesh; without this nothing signals clickability. |
| **Un-hide** | A **"Restore hidden (N)"** button in the panel. | A hidden building cannot be clicked again — without this, demolition is irreversible. |
| **Selection gating** | Click-to-hide is active **only with the Select tool on**, like every other selectable thing. | The codebase's standing rule: with Select off, a click in any pane selects nothing. |
| **Load flow** | "Load place" fetches terrain and buildings **in parallel**; **a building failure must NOT roll back a successful terrain load** (non-blocking notice instead). | Overpass is slow and rate-limits (429/504). Terrain is the more valuable payload and must survive. |
| **Visibility** | A **Context** show/hide toggle (no re-fetch). | Cheap way to get the backdrop out of the way without losing it. |
| **Clear terrain** | Also clears `contextBuildings`, `bbox`, and `hiddenIds`. | "Clear" returns to the pristine no-place state. |
| **Version** | **`SCENE_VERSION` stays 1**; `bbox`/`hiddenIds` are additive OPTIONAL fields. | Same data-preservation rule as M1: `deserializeScene` rejects any unknown version, so a bump would reject every existing beta save. |

## Data model

**Pure types (`src/lib/geo/buildings.ts`):**
```ts
interface ContextBuilding {
  /** OSM element id, e.g. "way/123456" — the stable key `hiddenIds` uses. */
  id: string;
  /** Local metres [x, z], projected through M1's `project()`. */
  footprint: Vec2[];
  /** Resolved height in metres (always finite and > 0). */
  height: number;
}

interface FetchResult {
  buildings: ContextBuilding[];
  /** true when MAX_BUILDINGS clipped the result. */
  truncated: boolean;
  /** how many the source actually returned, before the cap. */
  total: number;
}
```

**Page state (`app/facade/page.tsx`):** `contextBuildings: ContextBuilding[]`
(default `[]`, never serialized), `bbox: LngLatBBox | null`,
`hiddenIds: Set<string>` (a **Set** in memory, serialized as a `string[]` —
the same in-memory-vs-disk split the existing `cornerChoices` Map⇄entries uses),
`contextVisible: boolean` (default `true`), plus loading/error/truncation
status for the buildings fetch — independent of the terrain fetch's status.

**Document (`src/lib/facade/document.ts`), additive optionals:**
```ts
bbox?: LngLatBBox;      // re-fetch key
hiddenIds?: string[];   // sparse; usually absent/empty
```
`deserializeScene` defaults both (missing `bbox` → `null`, missing
`hiddenIds` → empty) and validates shape defensively, never throwing —
mirroring M1's `validHeightfield` treatment. **`SCENE_VERSION` stays 1.**

## Pure modules

**`src/lib/geo/buildings.ts`** (no three, no React, no network):
```ts
function resolveHeight(tags: Record<string, string> | undefined): number;
function osmToContextBuildings(
  elements: OsmElement[], anchor: GeoAnchor, maxBuildings: number,
): FetchResult;                       // projects lat/lon → local metres, caps, reports
function footprintBase(footprint: Vec2[], ground: Ground): number;  // min groundHeightAt
function visibleBuildings(
  all: ContextBuilding[], hidden: ReadonlySet<string>,
): ContextBuilding[];
```

**`src/lib/geo/buildingProvider.ts`:**
```ts
interface BuildingProvider {
  fetchBuildings(bbox: LngLatBBox, anchor: GeoAnchor): Promise<FetchResult>;
}
class OsmBuildingProvider implements BuildingProvider {}   // Overpass
function parseBuildingsRequest(body: unknown):
  { bbox: LngLatBBox; anchor: GeoAnchor } | null;          // shared by route + test
export const MAX_BUILDING_SPAN_DEG = 0.05;
export const MAX_BUILDINGS = 4000;
```
`parseBuildingsRequest` applies the same guards M1 established — finiteness,
well-ordered (`west < east && south < north`), and span ≤
`MAX_BUILDING_SPAN_DEG` — returning `null` → HTTP 400.

Overpass query shape (ways only, geometry inline):
```
[out:json][timeout:25];
way["building"](south,west,north,east);
out geom;
```
Endpoint: `https://overpass-api.de/api/interpreter` (POST). The route maps a
non-OK/rate-limited response to a clear error message.

## Route

**`POST /api/buildings`** (`runtime = "nodejs"`, same shape as
`/api/terrain`): body `{ bbox, anchor }` → `200 { buildings, truncated, total }`
| `400 { error }` (validation) | `500 { error }` (upstream/parse failure).
The DEM/OSM source stays behind the route — nothing above it knows the source.

## Rendering (`src/components/facade/ContextBuildings.tsx`)

- Builds ONE merged `BufferGeometry` from `visibleBuildings(...)`: for each
  footprint edge a wall quad (2 triangles) from `base` to `base + height`, plus
  the roof cap triangulated at `base + height`. Accumulates `faceBuilding:
  string[]`, one entry per emitted triangle, for picking.
- Grey `meshStandardMaterial` (`#8d8880`, `roughness` 0.95 — reads as neutral
  backdrop against the app's warmer wall colours), `receiveShadow`; disposed
  the R3F way when the geometry is replaced.
- Rebuilds when `contextBuildings`, `hiddenIds`, or `ground` changes.
- A separate small geometry renders the hovered building in a highlight colour.
- `onClick` (Select tool on only) resolves `faceIndex → faceBuilding[i]` and
  adds that id to `hiddenIds`.
- Renders nothing when `contextVisible` is false or the list is empty.

## Controls

`FacadeControls` gains a **Context** section, shown only when a place is
loaded: the show/hide toggle, a count ("1,204 buildings"), the truncation
notice when `truncated` ("showing 4,000 of 12,880"), a buildings-fetch error
line, and **Restore hidden (N)** (enabled when `hiddenIds` is non-empty).

## Testing (vitest, pure + visual)

- `resolveHeight`: plain metres; `"12 m"`; `building:levels` × 3; missing tags →
  8; junk/negative/zero → falls through to the next rule.
- `osmToContextBuildings`: lat/lon → local metres via the anchor (a building at
  the anchor lands near the origin); ways lacking geometry are skipped; over
  `maxBuildings` → `truncated: true` with `total` = the pre-cap count and
  exactly `maxBuildings` returned.
- `footprintBase`: flat ground → 0; sloped ground → the minimum vertex height.
- `visibleBuildings`: filters hidden ids; empty hidden set → identity.
- `parseBuildingsRequest`: accepts a normal city bbox; rejects non-object,
  missing/non-finite fields, inverted bbox, and a span over
  `MAX_BUILDING_SPAN_DEG`.
- Document round-trip: `bbox` + `hiddenIds` survive; a document without them
  loads with `bbox: null` / no hidden ids and is otherwise unchanged
  (byte-identical guard); a malformed `bbox`/`hiddenIds` is dropped, not thrown on.
- Visual: backdrop renders draped on real terrain; hover highlights one
  building; click hides it; Restore brings it back; the Context toggle hides
  all; a forced buildings-fetch failure leaves the terrain load intact.

## Not in scope (deferred)

Multipolygon relations (courtyard holes); building *parts* (`building:part`);
roof shapes/colours/materials beyond flat grey; per-building textures or LOD;
caching/rate-limit backoff for Overpass; client-side span guard in the picker
(the server bound is the real protection); **promoting a context building to an
editable block (M4)**; street import (M3).

## Roadmap position

- **M1 — real terrain.** Shipped 2026-07-25.
- **M2 — context buildings.** This spec.
- **M3 — street import:** real centrelines + OSM class → `StreetType` → the
  existing editable `StreetNetwork`.
- **M4 — promote footprint → editable block:** derive a frontage line + lots
  from a real polygon. Uses the click-selection built here.
