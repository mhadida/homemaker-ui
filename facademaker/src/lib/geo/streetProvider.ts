import type { GeoAnchor, LngLatBBox } from "./project";
import type { OsmWay, StreetFetchResult } from "./streets";
import { osmToStreets } from "./streets";
import {
  overpassFetch,
  overpassCacheKey,
  makeTtlCache,
  OVERPASS_CACHE_TTL_MS,
  OVERPASS_CACHE_MAX_ENTRIES,
} from "./overpass";
import { MAX_BUILDING_SPAN_DEG } from "./buildingProvider";

/** Source-agnostic street lookup — the route is the only caller, and the OSM
 * adapter below is the only thing that knows where the data comes from. */
export interface StreetProvider {
  fetchStreets(bbox: LngLatBBox, anchor: GeoAnchor): Promise<StreetFetchResult>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Post-merge cap. ~100-130 merged streets is typical for a city-district
 * bbox; 600 leaves generous headroom while bounding the fillet / ribbon /
 * junction-pad derivation the network runs per street. */
export const MAX_STREETS = 600;

export function parseStreetsRequest(
  body: unknown,
): { bbox: LngLatBBox; anchor: GeoAnchor } | { error: "malformed" | "span" } {
  if (typeof body !== "object" || body === null) return { error: "malformed" };
  const b = (body as { bbox?: unknown }).bbox as Partial<LngLatBBox> | undefined;
  const a = (body as { anchor?: unknown }).anchor as Partial<GeoAnchor> | undefined;
  if (!b || !a) return { error: "malformed" };
  if (!isNum(b.west) || !isNum(b.south) || !isNum(b.east) || !isNum(b.north)) return { error: "malformed" };
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

const streetCache = makeTtlCache<StreetFetchResult>(
  OVERPASS_CACHE_MAX_ENTRIES,
  OVERPASS_CACHE_TTL_MS,
);

/** Test-only: clears the module-level street cache so a repeat bbox in a later
 * `it` block cannot skip `fetch` and break its call-count assertions. */
export function __resetStreetCacheForTests(): void {
  streetCache.clear();
}

export class OsmStreetProvider implements StreetProvider {
  async fetchStreets(bbox: LngLatBBox, anchor: GeoAnchor): Promise<StreetFetchResult> {
    const key = overpassCacheKey(bbox, anchor);
    const cached = streetCache.get(key);
    if (cached) return cached;
    // Roads and canals in one union query; `out geom` inlines the node
    // coordinates so a single request suffices.
    const b = `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
    // [timeout:25], not 30 — overpass.ts's client AbortSignal.timeout is a
    // fixed 30s, so a query-side timeout equal to it leaves no headroom for
    // queue wait or the ~90 KB transfer (buildingProvider uses the same
    // [timeout:25] for the same reason).
    const query =
      `[out:json][timeout:25];` +
      `(way["highway"]${b};way["waterway"="canal"]${b};);` +
      `out geom;`;
    const json = await overpassFetch(query);
    const result = osmToStreets((json.elements ?? []) as OsmWay[], anchor, MAX_STREETS);
    streetCache.set(key, result);
    return result;
  }
}
