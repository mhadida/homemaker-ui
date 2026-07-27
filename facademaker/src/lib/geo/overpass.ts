import type { GeoAnchor, LngLatBBox } from "./project";

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
export const OVERPASS_ENDPOINTS = [
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

/** POSTs `query` to the first healthy Overpass mirror, failing over to the
 * next on a transient status/error and failing fast otherwise. Throws one
 * actionable error when every mirror fails transiently. */
export async function overpassFetch(query: string): Promise<{ elements?: unknown[] }> {
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
    return (await res.json()) as { elements?: unknown[] };
  }

  throw new Error(
    `Overpass is rate-limiting or busy across every mirror we tried (${failures.join(", ")}) — try again shortly.`,
  );
}

// --- Response cache -------------------------------------------------------
// A page reload (or a second look at the same area) would otherwise re-run
// the identical ~1.7 MB / 12-15s Overpass query, which is exactly what drives
// the rate limiter. This is a per-process, in-memory cache only: it does not
// survive a cold start / new instance, and that's fine — the goal is just to
// stop a warm instance from re-fetching the same bbox, not durable caching.
export const OVERPASS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
export const OVERPASS_CACHE_MAX_ENTRIES = 32; // each entry can be ~2 MB; bound total memory

/** Round to ~6 decimal places (~11 cm at the equator) so float noise in the
 * bbox/anchor never causes a cache miss for what is really the same area. */
function roundCoord(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function overpassCacheKey(bbox: LngLatBBox, anchor: GeoAnchor): string {
  return [bbox.west, bbox.south, bbox.east, bbox.north, anchor.lat0, anchor.lon0]
    .map(roundCoord)
    .join(",");
}

/** A generic, in-memory TTL cache with LRU-ish eviction past `maxEntries`.
 * Used for the Overpass response cache above (buildings, and later streets),
 * kept generic so every Overpass-backed provider shares one implementation. */
export function makeTtlCache<V>(maxEntries: number, ttlMs: number) {
  const map = new Map<string, { value: V; expiresAt: number }>();
  return {
    get(key: string): V | undefined {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        map.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: V): void {
      // Delete-then-set moves the key to the end of Map's iteration order, so
      // the size check below evicts the actual oldest entry (an LRU-ish
      // policy) rather than whichever key happens to sort first.
      map.delete(key);
      map.set(key, { value, expiresAt: Date.now() + ttlMs });
      while (map.size > maxEntries) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    clear(): void {
      map.clear();
    },
  };
}
