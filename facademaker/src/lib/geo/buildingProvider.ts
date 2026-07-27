import type { GeoAnchor, LngLatBBox } from "./project";
import type { FetchResult, OsmElement } from "./buildings";
import { osmToContextBuildings } from "./buildings";
import {
  overpassFetch,
  overpassCacheKey,
  makeTtlCache,
  OVERPASS_CACHE_TTL_MS,
  OVERPASS_CACHE_MAX_ENTRIES,
} from "./overpass";

/** Source-agnostic footprint lookup: the route is the only caller, and the
 * OpenStreetMap adapter below is the only thing that knows where the
 * footprints come from (an Esri adapter implements this same interface later). */
export interface BuildingProvider {
  fetchBuildings(bbox: LngLatBBox, anchor: GeoAnchor): Promise<FetchResult>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Buildings scale far worse than terrain: M1's 0.5 degree terrain span would be
// ~10^6 footprints here. 0.05 degrees is ~5 km — a generous city-district pick,
// and small enough to keep one Overpass query bounded.
export const MAX_BUILDING_SPAN_DEG = 0.05;
// Hard cap on returned footprints. Exceeding it truncates and REPORTS it
// (FetchResult.truncated/total) so the UI can say so — never a silent cap.
export const MAX_BUILDINGS = 4000;

/** Why a request body was rejected — lets the route give an actionable
 * message for "too large" (zoom in) vs. genuinely malformed input, while the
 * server-side bound (MAX_BUILDING_SPAN_DEG) is enforced identically either
 * way. */
export type BuildingsRequestError = "malformed" | "span";

/** Validate an untrusted request body. Exported so the route and its test share
 * one definition. Mirrors parseTerrainRequest's guards with the tighter span. */
export function parseBuildingsRequest(
  body: unknown,
): { bbox: LngLatBBox; anchor: GeoAnchor } | { error: BuildingsRequestError } {
  if (typeof body !== "object" || body === null) return { error: "malformed" };
  const b = (body as { bbox?: unknown }).bbox as Partial<LngLatBBox> | undefined;
  const a = (body as { anchor?: unknown }).anchor as Partial<GeoAnchor> | undefined;
  if (!b || !a) return { error: "malformed" };
  if (!isNum(b.west) || !isNum(b.south) || !isNum(b.east) || !isNum(b.north)) {
    return { error: "malformed" };
  }
  if (!isNum(a.lat0) || !isNum(a.lon0)) return { error: "malformed" };
  if (!(b.west < b.east && b.south < b.north)) return { error: "malformed" };
  if (b.east - b.west > MAX_BUILDING_SPAN_DEG || b.north - b.south > MAX_BUILDING_SPAN_DEG) {
    return { error: "span" };
  }
  return {
    bbox: { west: b.west, south: b.south, east: b.east, north: b.north },
    anchor: { lat0: a.lat0, lon0: a.lon0 },
  };
}

// Response cache: a page reload (or a second look at the same area) would
// otherwise re-run the identical ~1.7 MB / 12-15s Overpass query, which is
// exactly what drives the rate limiter. This is a per-process, in-memory
// cache only: it does not survive a cold start / new instance, and that's
// fine — the goal is just to stop a warm instance from re-fetching the same
// bbox, not durable caching.
const buildingsCache = makeTtlCache<FetchResult>(
  OVERPASS_CACHE_MAX_ENTRIES,
  OVERPASS_CACHE_TTL_MS,
);

/** Test-only: clears the module-level Overpass cache. Tests that reuse the
 * same bbox/anchor across `it` blocks would otherwise see a stale hit from an
 * earlier test — a hit skips `fetch` entirely, which breaks that test's own
 * `toHaveBeenCalled*` assertions. Not used by app code. */
export function __resetOverpassCacheForTests(): void {
  buildingsCache.clear();
}

export class OsmBuildingProvider implements BuildingProvider {
  async fetchBuildings(bbox: LngLatBBox, anchor: GeoAnchor): Promise<FetchResult> {
    const key = overpassCacheKey(bbox, anchor);
    const cached = buildingsCache.get(key);
    if (cached) return cached;

    // Ways only — multipolygon relations (courtyard holes) are deferred.
    // `out geom` inlines each way's node coordinates so one request suffices.
    const query =
      `[out:json][timeout:25];` +
      `way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
      `out geom;`;

    const json = await overpassFetch(query);
    const result = osmToContextBuildings((json.elements ?? []) as OsmElement[], anchor, MAX_BUILDINGS);
    buildingsCache.set(key, result);
    return result;
  }
}
