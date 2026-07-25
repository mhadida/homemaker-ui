import type { GeoAnchor, LngLatBBox } from "./project";
import type { FetchResult, OsmElement } from "./buildings";
import { osmToContextBuildings } from "./buildings";

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

// Ordered Overpass mirrors to fail over across. Measured directly against
// this exact query + headers on 2026-07-25:
//   - overpass.kumi.systems  → 200, 1585 elements, 12.4s   (goes first)
//   - overpass-api.de        → 504 (rate-limited/busy)     (canonical, kept as fallback)
// kumi.systems leads because it was healthy AND is a generously-provisioned
// mirror, so routing there first also takes load off the canonical instance.
// This list is deliberately short: overpass.private.coffee (timed out at
// 45s), overpass.osm.ch (200 but 0 elements — unusable), and overpass.osm.jp
// (connection failure) were all tried and are NOT included — only
// verified-good endpoints belong here, since a known-bad one just burns a
// full timeout on every request before falling through.
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

// HTTP statuses worth retrying on the next mirror — rate-limiting/overload
// signals. Anything else (400 malformed query, 406 missing User-Agent, ...)
// means every mirror would reject the identical request the same way, so we
// fail fast instead of hammering the rest.
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

// Overpass's usage policy requires an identifying User-Agent and 406s any
// request without one — Node's server-side fetch sends no UA by default, so
// this is required for the request to succeed at all. Do not remove. Sent on
// every mirror attempt, not just the first.
const OVERPASS_USER_AGENT = "homemaker-ui/0.1 (+https://github.com/mhadida/homemaker-ui)";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// --- Response cache -------------------------------------------------------
// A page reload (or a second look at the same area) would otherwise re-run
// the identical ~1.7 MB / 12-15s Overpass query, which is exactly what drives
// the rate limiter. This is a per-process, in-memory cache only: it does not
// survive a cold start / new instance, and that's fine — the goal is just to
// stop a warm instance from re-fetching the same bbox, not durable caching.
const OVERPASS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const OVERPASS_CACHE_MAX_ENTRIES = 32; // each entry can be ~2 MB; bound total memory

const overpassCache = new Map<string, { result: FetchResult; expiresAt: number }>();

/** Round to ~6 decimal places (~11 cm at the equator) so float noise in the
 * bbox/anchor never causes a cache miss for what is really the same area. */
function roundCoord(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function overpassCacheKey(bbox: LngLatBBox, anchor: GeoAnchor): string {
  return [bbox.west, bbox.south, bbox.east, bbox.north, anchor.lat0, anchor.lon0]
    .map(roundCoord)
    .join(",");
}

function getCachedBuildings(key: string): FetchResult | undefined {
  const entry = overpassCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    overpassCache.delete(key);
    return undefined;
  }
  return entry.result;
}

function setCachedBuildings(key: string, result: FetchResult): void {
  // Delete-then-set moves the key to the end of Map's iteration order, so
  // the size check below evicts the actual oldest entry (an LRU-ish policy)
  // rather than whichever key happens to sort first.
  overpassCache.delete(key);
  overpassCache.set(key, { result, expiresAt: Date.now() + OVERPASS_CACHE_TTL_MS });
  while (overpassCache.size > OVERPASS_CACHE_MAX_ENTRIES) {
    const oldestKey = overpassCache.keys().next().value;
    if (oldestKey === undefined) break;
    overpassCache.delete(oldestKey);
  }
}

/** Test-only: clears the module-level Overpass cache. Tests that reuse the
 * same bbox/anchor across `it` blocks would otherwise see a stale hit from an
 * earlier test — a hit skips `fetch` entirely, which breaks that test's own
 * `toHaveBeenCalled*` assertions. Not used by app code. */
export function __resetOverpassCacheForTests(): void {
  overpassCache.clear();
}

export class OsmBuildingProvider implements BuildingProvider {
  async fetchBuildings(bbox: LngLatBBox, anchor: GeoAnchor): Promise<FetchResult> {
    const cacheKey = overpassCacheKey(bbox, anchor);
    const cached = getCachedBuildings(cacheKey);
    if (cached) return cached;

    // Ways only — multipolygon relations (courtyard holes) are deferred.
    // `out geom` inlines each way's node coordinates so one request suffices.
    const query =
      `[out:json][timeout:25];` +
      `way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
      `out geom;`;

    const failures: string[] = [];
    for (const url of OVERPASS_ENDPOINTS) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": OVERPASS_USER_AGENT,
          },
          body: `data=${encodeURIComponent(query)}`,
          // `[timeout:25]` above only bounds Overpass's own query execution,
          // not queue wait or transfer — without an AbortSignal a busy
          // mirror could hold this serverless function open until the
          // platform limit.
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        // Any fetch rejection — timeout, DNS failure, connection refused,
        // network drop — is transient: a different mirror may still answer.
        if (e instanceof Error && e.name === "TimeoutError") {
          failures.push(`${hostOf(url)}: timed out`);
        } else {
          failures.push(`${hostOf(url)}: ${e instanceof Error ? e.message : String(e)}`);
        }
        continue;
      }
      if (!res.ok) {
        if (TRANSIENT_STATUSES.has(res.status)) {
          failures.push(`${hostOf(url)}: HTTP ${res.status}`);
          continue;
        }
        // Non-transient — e.g. 400 malformed query, 406 missing User-Agent.
        // Every mirror would reject this identical request the same way, so
        // fail immediately rather than working through the rest.
        throw new Error(`Overpass HTTP ${res.status}`);
      }
      const json = (await res.json()) as { elements?: OsmElement[] };
      const result = osmToContextBuildings(json.elements ?? [], anchor, MAX_BUILDINGS);
      setCachedBuildings(cacheKey, result);
      return result;
    }

    throw new Error(
      `Overpass is rate-limiting or busy across every mirror we tried (${failures.join(", ")}) — try again shortly.`,
    );
  }
}
