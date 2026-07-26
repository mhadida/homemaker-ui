# Street & Canal Import (Milestone 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loading a real place also imports its real OSM streets and canals as ordinary, editable `Street` objects in the existing `StreetNetwork`.

**Architecture:** M2's Overpass client (mirror failover + cache) is extracted into a shared module, then a new pure `streets.ts` filters OSM ways to roads, maps their class onto the five existing `StreetType`s, merges OSM's fragmented ways back into whole named streets, and projects them into M1's `GeoAnchor` frame. A `StreetProvider` behind `POST /api/streets` serves them; the page replaces the street network on import and forces Auto-buildings off.

**Tech Stack:** Next.js 16.2.1 route handlers (`runtime = "nodejs"`), OpenStreetMap Overpass API, React + R3F (existing street rendering is reused unchanged), vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-street-import-design.md`

## Global Constraints

- **Byte-identical:** no place loaded ⇒ nothing imported ⇒ behaviour unchanged. Every addition is additive/optional.
- **No change to `Street`, `StreetNetwork`, or the document shape.** Imported streets are ordinary `Street`s in the existing `streetNetwork`, already serialized — so, unlike M2's footprints, they are NOT re-fetched on load.
- **Class mapping (verbatim):** `motorway`/`trunk`/`primary`(+`_link`) → `boulevard`; `secondary`/`tertiary` → `road`; `residential`/`unclassified`/`living_street`/`busway` → `street`; `service` → `alley`; `pedestrian` → `street` with `traffic: "peds"`; `waterway=canal` → `canal`. DROP `footway`, `cycleway`, `steps`, `path`, `construction`, and any unlisted highway value.
- **Merge key (verbatim):** contiguous ways sharing `(name, mapped type)` merge into one polyline, reversing a way where needed. Ways with no `name` NEVER merge.
- **Width:** OSM `width` tag when finite and in `1..60` m; else the `STREET_SPECS` type default (leave `width` undefined).
- **Caps:** bbox span guard `MAX_BUILDING_SPAN_DEG` (0.05, reused); `MAX_STREETS = 600` post-merge, truncating with `truncated`/`total` reported — never a silent cap.
- **Ids (verbatim):** `street-osm-<wayId>` for a single way; `street-osm-<firstWayId>m` for a merged chain. Run the result through `reserveStreetIds`.
- **Auto-buildings:** importing a place sets the global `buildingsFromStreets` to `false` (`syncStreetBlocks` would otherwise generate thousands of parametric lots over M2's real footprints).
- **Load semantics:** importing REPLACES `streetNetwork.streets`.
- **Failure isolation:** terrain, buildings and streets fetch in parallel and fail independently.
- **Overpass rules:** an identifying `User-Agent` is REQUIRED (Overpass 406s without it); mirror failover on `429/502/503/504`/network/timeout; fail fast on any other non-OK status.
- **Next.js 16.2.1 is NOT the Next.js you know** (`AGENTS.md`): mirror `src/app/api/buildings/route.ts`.
- **Deletion Policy:** additive/refactor only — Task 1 MOVES code, it must not drop behaviour.
- Every task ends with `npx tsc --noEmit`, `npx eslint <touched files>` (0 errors AND 0 warnings), and `npm test` green.

---

### Task 1: Extract the shared Overpass client

Pure refactor. M2's failover/UA/timeout/cache logic currently lives inside `buildingProvider.ts`; M3 needs the same thing, so lift it into one module rather than copy it. Buildings behaviour must be **unchanged**.

**Files:**
- Create: `src/lib/geo/overpass.ts`
- Modify: `src/lib/geo/buildingProvider.ts` (remove the moved internals, import them instead)
- Test: `src/lib/geo/overpass.test.ts` (new)

**Interfaces:**
- Consumes: `type GeoAnchor`, `type LngLatBBox` from `./project`.
- Produces:
  - `overpassFetch(query: string): Promise<{ elements?: unknown[] }>` — POSTs with the required `User-Agent`, `AbortSignal.timeout(30_000)`, mirror failover on transient failures, fail-fast otherwise; throws one actionable error when every mirror fails transiently.
  - `overpassCacheKey(bbox: LngLatBBox, anchor: GeoAnchor): string`
  - `makeTtlCache<V>(maxEntries: number, ttlMs: number): { get(k: string): V | undefined; set(k: string, v: V): void; clear(): void }`
  - `OVERPASS_CACHE_TTL_MS`, `OVERPASS_CACHE_MAX_ENTRIES`, `OVERPASS_ENDPOINTS`

- [ ] **Step 1: Read the source you are moving**

Read `src/lib/geo/buildingProvider.ts` in full. The pieces to move are `OVERPASS_ENDPOINTS`, `TRANSIENT_STATUSES`, `OVERPASS_USER_AGENT`, `hostOf`, the cache constants + `overpassCache` + `roundCoord` + `overpassCacheKey` + `getCachedBuildings`/`setCachedBuildings`, and the failover loop inside `OsmBuildingProvider.fetchBuildings`. Keep every comment — they record *why* (the 406, the rate limiter, the LRU-ish eviction) and must not be lost in the move.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/geo/overpass.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { overpassFetch, overpassCacheKey, makeTtlCache, OVERPASS_ENDPOINTS } from "./overpass";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const bad = (status: number) => ({ ok: false, status, json: async () => ({}) });

describe("overpassFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends an identifying User-Agent (Overpass 406s without one)", async () => {
    const f = vi.fn().mockResolvedValue(ok({ elements: [] }));
    vi.stubGlobal("fetch", f);
    await overpassFetch("[out:json];out;");
    const [, init] = f.mock.calls[0];
    expect(String(init.headers["user-agent"])).toBeTruthy();
  });

  it("fails over to the next mirror on a transient status", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(bad(504))
      .mockResolvedValueOnce(ok({ elements: [{ id: 1 }] }));
    vi.stubGlobal("fetch", f);
    const json = await overpassFetch("q");
    expect(json.elements).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0][0]).toBe(OVERPASS_ENDPOINTS[0]);
    expect(f.mock.calls[1][0]).toBe(OVERPASS_ENDPOINTS[1]);
  });

  it("still sends the User-Agent on the failover attempt", async () => {
    const f = vi.fn().mockResolvedValueOnce(bad(429)).mockResolvedValueOnce(ok({}));
    vi.stubGlobal("fetch", f);
    await overpassFetch("q");
    expect(String(f.mock.calls[1][1].headers["user-agent"])).toBeTruthy();
  });

  it("fails fast on a non-transient status (does not try other mirrors)", async () => {
    const f = vi.fn().mockResolvedValue(bad(400));
    vi.stubGlobal("fetch", f);
    await expect(overpassFetch("q")).rejects.toThrow(/400/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("throws an actionable error when every mirror fails transiently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bad(504)));
    await expect(overpassFetch("q")).rejects.toThrow(/busy|try again/i);
  });

  it("treats a fetch rejection as transient and moves on", async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(ok({ elements: [] }));
    vi.stubGlobal("fetch", f);
    await expect(overpassFetch("q")).resolves.toBeTruthy();
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("overpassCacheKey", () => {
  const bbox = { west: 4.1, south: 52.1, east: 4.2, north: 52.2 };
  const anchor = { lat0: 52.15, lon0: 4.15 };
  it("is stable for the same area", () => {
    expect(overpassCacheKey(bbox, anchor)).toBe(overpassCacheKey({ ...bbox }, { ...anchor }));
  });
  it("ignores float noise below ~11 cm", () => {
    expect(overpassCacheKey({ ...bbox, west: 4.1 + 1e-9 }, anchor)).toBe(overpassCacheKey(bbox, anchor));
  });
  it("differs for a different area", () => {
    expect(overpassCacheKey({ ...bbox, west: 4.15 }, anchor)).not.toBe(overpassCacheKey(bbox, anchor));
  });
});

describe("makeTtlCache", () => {
  it("returns a stored value and misses after clear", () => {
    const c = makeTtlCache<number>(4, 1000);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    c.clear();
    expect(c.get("a")).toBeUndefined();
  });
  it("evicts the oldest entry past maxEntries", () => {
    const c = makeTtlCache<number>(2, 1000);
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });
  it("re-setting a key keeps it fresh against eviction", () => {
    const c = makeTtlCache<number>(2, 1000);
    c.set("a", 1); c.set("b", 2); c.set("a", 9); c.set("c", 3);
    expect(c.get("a")).toBe(9);   // refreshed, so "b" is the oldest
    expect(c.get("b")).toBeUndefined();
  });
  it("expires an entry past its TTL", () => {
    const c = makeTtlCache<number>(4, 1000);
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    c.set("a", 1);
    now.mockReturnValue(1001);
    expect(c.get("a")).toBeUndefined();
    now.mockRestore();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/geo/overpass.test.ts`
Expected: FAIL — cannot resolve `./overpass`.

- [ ] **Step 4: Create `overpass.ts` by MOVING the code**

Move (do not retype from memory) the constants, `hostOf`, `roundCoord`, `overpassCacheKey`, and the failover loop out of `buildingProvider.ts`, preserving their comments verbatim. Shape the failover loop into:

```ts
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
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) { /* …existing transient handling, unchanged… */ continue; }
    if (!res.ok) {
      if (TRANSIENT_STATUSES.has(res.status)) { failures.push(`${hostOf(url)}: HTTP ${res.status}`); continue; }
      throw new Error(`Overpass HTTP ${res.status}`);
    }
    return (await res.json()) as { elements?: unknown[] };
  }
  throw new Error(/* …the existing all-mirrors-busy message, unchanged… */);
}
```

Generalise the cache into:

```ts
export function makeTtlCache<V>(maxEntries: number, ttlMs: number) {
  const map = new Map<string, { value: V; expiresAt: number }>();
  return {
    get(key: string): V | undefined {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) { map.delete(key); return undefined; }
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
    clear(): void { map.clear(); },
  };
}
```

- [ ] **Step 5: Rewire `buildingProvider.ts` onto the shared module**

Replace its moved internals with imports, and rebuild `fetchBuildings` as:

```ts
const buildingsCache = makeTtlCache<FetchResult>(
  OVERPASS_CACHE_MAX_ENTRIES,
  OVERPASS_CACHE_TTL_MS,
);

/** Test-only: clears the module-level Overpass cache. …(keep the existing comment)… */
export function __resetOverpassCacheForTests(): void {
  buildingsCache.clear();
}

export class OsmBuildingProvider implements BuildingProvider {
  async fetchBuildings(bbox: LngLatBBox, anchor: GeoAnchor): Promise<FetchResult> {
    const key = overpassCacheKey(bbox, anchor);
    const cached = buildingsCache.get(key);
    if (cached) return cached;
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
```

KEEP `parseBuildingsRequest`, `MAX_BUILDING_SPAN_DEG`, `MAX_BUILDINGS` and the exported `__resetOverpassCacheForTests` name exactly where they are — the route and the existing tests import them.

- [ ] **Step 6: Verify buildings behaviour is unchanged**

Run: `npx vitest run src/lib/geo/overpass.test.ts src/lib/geo/buildingProvider.test.ts`
Expected: the new suite passes AND **every pre-existing buildingProvider test still passes unmodified** — that is the regression guard for this refactor. If a buildings test needs editing to pass, the refactor changed behaviour: fix the refactor, not the test.

- [ ] **Step 7: Typecheck, lint, full suite, commit**

Run: `npx tsc --noEmit && npx eslint src/lib/geo/overpass.ts src/lib/geo/overpass.test.ts src/lib/geo/buildingProvider.ts && npm test`

```bash
git add src/lib/geo/overpass.ts src/lib/geo/overpass.test.ts src/lib/geo/buildingProvider.ts
git commit -m "refactor(geo): extract the shared Overpass client (failover + TTL cache)"
```

---

### Task 2: Pure street model (`lib/geo/streets.ts`)

Filter → classify → merge → project → cap. The heart of the milestone, and entirely pure.

**Files:**
- Create: `src/lib/geo/streets.ts`
- Test: `src/lib/geo/streets.test.ts`

**Interfaces:**
- Consumes: `project`, `type GeoAnchor` from `./project`; `type Street`, `type StreetType`, `type TrafficMode`, `reserveStreetIds` from `@/lib/street/types`.
- Produces:
  - `interface OsmWay { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }`
  - `interface StreetFetchResult { streets: Street[]; truncated: boolean; total: number }`
  - `classifyWay(tags: Record<string, string> | undefined): { type: StreetType; traffic?: TrafficMode } | null`
  - `parseWidth(tags: Record<string, string> | undefined): number | undefined`
  - `mergeWays(ways: OsmWay[]): OsmWay[][]`
  - `osmToStreets(ways: OsmWay[], anchor: GeoAnchor, maxStreets: number): StreetFetchResult`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/geo/streets.test.ts
import { describe, it, expect } from "vitest";
import { classifyWay, parseWidth, mergeWays, osmToStreets, type OsmWay } from "./streets";
import type { GeoAnchor } from "./project";

const ANCHOR: GeoAnchor = { lat0: 52.37, lon0: 4.89 };

describe("classifyWay", () => {
  it("maps the arterial classes to boulevard", () => {
    for (const h of ["motorway", "trunk", "primary", "primary_link"]) {
      expect(classifyWay({ highway: h })?.type).toBe("boulevard");
    }
  });
  it("maps secondary/tertiary to road", () => {
    expect(classifyWay({ highway: "secondary" })?.type).toBe("road");
    expect(classifyWay({ highway: "tertiary" })?.type).toBe("road");
  });
  it("maps the local classes to street", () => {
    for (const h of ["residential", "unclassified", "living_street", "busway"]) {
      expect(classifyWay({ highway: h })?.type).toBe("street");
    }
  });
  it("maps service to alley", () => {
    expect(classifyWay({ highway: "service" })?.type).toBe("alley");
  });
  it("maps pedestrian to a car-free street", () => {
    expect(classifyWay({ highway: "pedestrian" })).toEqual({ type: "street", traffic: "peds" });
  });
  it("maps waterway=canal to canal", () => {
    expect(classifyWay({ waterway: "canal" })?.type).toBe("canal");
  });
  it("drops paths, steps and anything unlisted", () => {
    for (const h of ["footway", "cycleway", "steps", "path", "construction", "raceway"]) {
      expect(classifyWay({ highway: h })).toBeNull();
    }
    expect(classifyWay(undefined)).toBeNull();
    expect(classifyWay({})).toBeNull();
  });
});

describe("parseWidth", () => {
  it("reads a plain, suffixed or comma-decimal width", () => {
    expect(parseWidth({ width: "12" })).toBe(12);
    expect(parseWidth({ width: "12.5 m" })).toBe(12.5);
    expect(parseWidth({ width: "12,5" })).toBe(12.5);
  });
  it("is undefined when absent or out of a sane 1..60 m range", () => {
    expect(parseWidth(undefined)).toBeUndefined();
    expect(parseWidth({})).toBeUndefined();
    expect(parseWidth({ width: "wide" })).toBeUndefined();
    expect(parseWidth({ width: "0" })).toBeUndefined();
    expect(parseWidth({ width: "-4" })).toBeUndefined();
    expect(parseWidth({ width: "500" })).toBeUndefined();
  });
});

const way = (id: number, name: string | undefined, coords: [number, number][], highway = "residential"): OsmWay => ({
  type: "way",
  id,
  tags: { highway, ...(name ? { name } : {}) },
  geometry: coords.map(([lat, lon]) => ({ lat, lon })),
});

describe("mergeWays", () => {
  it("chains two ways that share an endpoint", () => {
    const a = way(1, "Herengracht", [[0, 0], [0, 1]]);
    const b = way(2, "Herengracht", [[0, 1], [0, 2]]);
    const groups = mergeWays([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((w) => w.id).sort()).toEqual([1, 2]);
  });
  it("chains a way that is stored reversed", () => {
    const a = way(1, "Herengracht", [[0, 0], [0, 1]]);
    const b = way(2, "Herengracht", [[0, 2], [0, 1]]); // shares its END with a's end
    expect(mergeWays([a, b])).toHaveLength(1);
  });
  it("chains three ways into one run", () => {
    const ws = [
      way(1, "Keizersgracht", [[0, 0], [0, 1]]),
      way(2, "Keizersgracht", [[0, 1], [0, 2]]),
      way(3, "Keizersgracht", [[0, 2], [0, 3]]),
    ];
    const groups = mergeWays(ws);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
  it("never merges unnamed ways", () => {
    const a = way(1, undefined, [[0, 0], [0, 1]]);
    const b = way(2, undefined, [[0, 1], [0, 2]]);
    expect(mergeWays([a, b])).toHaveLength(2);
  });
  it("never merges different names or different types", () => {
    expect(mergeWays([
      way(1, "A", [[0, 0], [0, 1]]),
      way(2, "B", [[0, 1], [0, 2]]),
    ])).toHaveLength(2);
    expect(mergeWays([
      way(1, "A", [[0, 0], [0, 1]], "residential"),
      way(2, "A", [[0, 1], [0, 2]], "primary"),
    ])).toHaveLength(2);
  });
  it("does not merge same-named ways that do not touch", () => {
    expect(mergeWays([
      way(1, "A", [[0, 0], [0, 1]]),
      way(2, "A", [[5, 5], [5, 6]]),
    ])).toHaveLength(2);
  });
  it("is order-independent", () => {
    const ws = [
      way(3, "X", [[0, 2], [0, 3]]),
      way(1, "X", [[0, 0], [0, 1]]),
      way(2, "X", [[0, 1], [0, 2]]),
    ];
    const groups = mergeWays(ws);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
});

describe("osmToStreets", () => {
  it("projects through the anchor and keeps the merged run contiguous", () => {
    const ws = [
      way(1, "Herengracht", [[ANCHOR.lat0, ANCHOR.lon0], [ANCHOR.lat0, ANCHOR.lon0 + 0.001]]),
      way(2, "Herengracht", [[ANCHOR.lat0, ANCHOR.lon0 + 0.001], [ANCHOR.lat0, ANCHOR.lon0 + 0.002]]),
    ];
    const r = osmToStreets(ws, ANCHOR, 100);
    expect(r.streets).toHaveLength(1);
    expect(r.streets[0].points.length).toBe(3);            // 2+2 with the shared node once
    expect(r.streets[0].points[0][0]).toBeCloseTo(0, 6);   // first vertex sits at the anchor
    expect(r.streets[0].points[0][1]).toBeCloseTo(0, 6);
    expect(r.streets[0].id).toMatch(/^street-osm-1m$/);
  });
  it("ids a lone way without the merge suffix", () => {
    const r = osmToStreets([way(7, undefined, [[0, 0], [0, 1]])], ANCHOR, 100);
    expect(r.streets[0].id).toBe("street-osm-7");
  });
  it("drops path classes entirely", () => {
    const r = osmToStreets([
      way(1, "P", [[0, 0], [0, 1]], "footway"),
      way(2, "S", [[0, 0], [0, 1]], "residential"),
    ], ANCHOR, 100);
    expect(r.streets).toHaveLength(1);
    expect(r.streets[0].type).toBe("street");
  });
  it("skips ways with fewer than 2 vertices", () => {
    const r = osmToStreets([{ type: "way", id: 1, tags: { highway: "residential" }, geometry: [{ lat: 0, lon: 0 }] }], ANCHOR, 100);
    expect(r.streets).toHaveLength(0);
  });
  it("caps at maxStreets and reports the pre-cap total", () => {
    const ws = Array.from({ length: 5 }, (_, i) => way(i + 1, undefined, [[i, 0], [i, 1]]));
    const r = osmToStreets(ws, ANCHOR, 3);
    expect(r.streets).toHaveLength(3);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(5);
  });
  it("carries a sane width tag through and omits an insane one", () => {
    const wide = way(1, undefined, [[0, 0], [0, 1]]);
    wide.tags!.width = "18";
    const junk = way(2, undefined, [[1, 0], [1, 1]]);
    junk.tags!.width = "999";
    const r = osmToStreets([wide, junk], ANCHOR, 10);
    expect(r.streets.find((s) => s.id === "street-osm-1")!.width).toBe(18);
    expect(r.streets.find((s) => s.id === "street-osm-2")!.width).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/geo/streets.test.ts`
Expected: FAIL — cannot resolve `./streets`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/geo/streets.ts
/** Real-world streets and canals imported as ordinary, editable Streets (M3).
 * Pure — no three, no React, no network. */
import type { GeoAnchor } from "./project";
import { project } from "./project";
import type { Street, StreetType, TrafficMode, Vec2 } from "@/lib/street/types";
import { reserveStreetIds } from "@/lib/street/types";

export interface OsmWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

export interface StreetFetchResult {
  streets: Street[];
  truncated: boolean;
  total: number;
}

/** OSM highway class → our StreetType. Anything absent from this table is
 * DROPPED: footways, cycleways, steps and paths are 48% of the ways in a city
 * bbox and are not streets in this model. */
const HIGHWAY_TYPES: Record<string, StreetType> = {
  motorway: "boulevard",
  motorway_link: "boulevard",
  trunk: "boulevard",
  trunk_link: "boulevard",
  primary: "boulevard",
  primary_link: "boulevard",
  secondary: "road",
  secondary_link: "road",
  tertiary: "road",
  tertiary_link: "road",
  residential: "street",
  unclassified: "street",
  living_street: "street",
  busway: "street",
  service: "alley",
};

export function classifyWay(
  tags: Record<string, string> | undefined,
): { type: StreetType; traffic?: TrafficMode } | null {
  if (!tags) return null;
  if (tags.waterway === "canal") return { type: "canal" };
  const hw = tags.highway;
  if (!hw) return null;
  // A real street that happens to be car-free — exactly what the existing
  // `peds` traffic mode models (Dutch city centres).
  if (hw === "pedestrian") return { type: "street", traffic: "peds" };
  const type = HIGHWAY_TYPES[hw];
  return type ? { type } : null;
}

const WIDTH_MIN = 1;
const WIDTH_MAX = 60;

/** OSM `width` in metres. Tolerates a unit suffix ("12 m") and a decimal
 * comma; rejects anything outside a sane road width so a mis-tagged value
 * cannot produce an absurd ribbon. */
export function parseWidth(tags: Record<string, string> | undefined): number | undefined {
  const raw = tags?.width;
  if (typeof raw !== "string") return undefined;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(raw);
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n < WIDTH_MIN || n > WIDTH_MAX) return undefined;
  return n;
}

const endKey = (p: { lat: number; lon: number }) => `${p.lat},${p.lon}`;

/** OSM splits one human street into many ways (at every tag change and
 * junction) — "Herengracht" is 8 separate ways. Chain contiguous ways sharing
 * (name, mapped type) back into whole streets so the network reads like
 * hand-drawn work instead of a field of stubs. Unnamed ways have no reliable
 * key, so they never merge. */
export function mergeWays(ways: OsmWay[]): OsmWay[][] {
  const out: OsmWay[][] = [];
  const groups = new Map<string, OsmWay[]>();
  for (const w of ways) {
    const cls = classifyWay(w.tags);
    const name = w.tags?.name;
    const g = w.geometry;
    if (!cls || !name || !g || g.length < 2) {
      out.push([w]); // ungroupable — stands alone
      continue;
    }
    const key = `${cls.type} ${name}`;
    const list = groups.get(key);
    if (list) list.push(w);
    else groups.set(key, [w]);
  }
  for (const list of groups.values()) {
    const remaining = [...list];
    while (remaining.length) {
      const chain = [remaining.shift()!];
      let grew = true;
      while (grew) {
        grew = false;
        const head = chain[0].geometry!;
        const tail = chain[chain.length - 1].geometry!;
        for (let i = 0; i < remaining.length; i++) {
          const cand = remaining[i].geometry!;
          const cs = endKey(cand[0]);
          const ce = endKey(cand[cand.length - 1]);
          if (ce === endKey(head[0])) { chain.unshift(remaining.splice(i, 1)[0]); grew = true; break; }
          if (cs === endKey(head[0])) {
            const w = remaining.splice(i, 1)[0];
            chain.unshift({ ...w, geometry: [...w.geometry!].reverse() });
            grew = true; break;
          }
          if (cs === endKey(tail[tail.length - 1])) { chain.push(remaining.splice(i, 1)[0]); grew = true; break; }
          if (ce === endKey(tail[tail.length - 1])) {
            const w = remaining.splice(i, 1)[0];
            chain.push({ ...w, geometry: [...w.geometry!].reverse() });
            grew = true; break;
          }
        }
      }
      out.push(chain);
    }
  }
  return out;
}

/** Overpass ways → local-frame Streets: filter, classify, merge, project, cap.
 * The pre-cap total is reported so callers can surface truncation. */
export function osmToStreets(
  ways: OsmWay[],
  anchor: GeoAnchor,
  maxStreets: number,
): StreetFetchResult {
  const usable = ways.filter((w) => classifyWay(w.tags) && (w.geometry?.length ?? 0) >= 2);
  const all: Street[] = [];
  for (const chain of mergeWays(usable)) {
    const cls = classifyWay(chain[0].tags);
    if (!cls) continue;
    const points: Vec2[] = [];
    for (const w of chain) {
      for (const p of w.geometry!) {
        const xz = project(p.lat, p.lon, anchor);
        // Drop the duplicated shared node where two ways join.
        const last = points[points.length - 1];
        if (last && last[0] === xz[0] && last[1] === xz[1]) continue;
        points.push(xz);
      }
    }
    if (points.length < 2) continue;
    const width = parseWidth(chain[0].tags);
    all.push({
      id: `street-osm-${chain[0].id}${chain.length > 1 ? "m" : ""}`,
      type: cls.type,
      points,
      ...(width !== undefined ? { width } : {}),
      ...(cls.traffic ? { traffic: cls.traffic } : {}),
    });
  }
  const total = all.length;
  const truncated = total > maxStreets;
  const streets = truncated ? all.slice(0, maxStreets) : all;
  // Keep the session id counter clear of these ids so a later hand-drawn
  // street can never collide with an imported one.
  reserveStreetIds(streets);
  return { streets, truncated, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/geo/streets.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, full suite, commit**

Run: `npx tsc --noEmit && npx eslint src/lib/geo/streets.ts src/lib/geo/streets.test.ts && npm test`

```bash
git add src/lib/geo/streets.ts src/lib/geo/streets.test.ts
git commit -m "feat(geo): pure OSM street model — classify, width, merge, project"
```

---

### Task 3: Street provider + `POST /api/streets`

**Files:**
- Create: `src/lib/geo/streetProvider.ts`
- Create: `src/app/api/streets/route.ts`
- Test: `src/lib/geo/streetProvider.test.ts`

**Interfaces:**
- Consumes: `overpassFetch`, `overpassCacheKey`, `makeTtlCache`, `OVERPASS_CACHE_TTL_MS`, `OVERPASS_CACHE_MAX_ENTRIES` (Task 1); `osmToStreets`, `type OsmWay`, `type StreetFetchResult` (Task 2); `MAX_BUILDING_SPAN_DEG` from `./buildingProvider`.
- Produces:
  - `interface StreetProvider { fetchStreets(bbox: LngLatBBox, anchor: GeoAnchor): Promise<StreetFetchResult> }`
  - `class OsmStreetProvider implements StreetProvider`
  - `parseStreetsRequest(body: unknown): { bbox; anchor } | { error: "malformed" | "span" }`
  - `MAX_STREETS = 600`, `__resetStreetCacheForTests()`
  - Route `POST /api/streets` → `200 { streets, truncated, total }` | `400 { error }` | `500 { error }`

- [ ] **Step 1: Read the pattern you are mirroring**

Read `src/lib/geo/buildingProvider.ts` (post-Task-1) and `src/app/api/buildings/route.ts`. `parseStreetsRequest` must reproduce `parseBuildingsRequest`'s validation ORDER and its discriminated `{ error: "malformed" | "span" }` return, and the route must map `"span"` to the actionable zoom-in message exactly as `/api/buildings` does.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/geo/streetProvider.test.ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  parseStreetsRequest,
  OsmStreetProvider,
  __resetStreetCacheForTests,
} from "./streetProvider";
import { MAX_BUILDING_SPAN_DEG } from "./buildingProvider";

const anchor = { lat0: 52.37, lon0: 4.89 };
const good = { bbox: { west: 4.88, south: 52.36, east: 4.9, north: 52.38 }, anchor };

beforeEach(() => __resetStreetCacheForTests());
afterEach(() => vi.unstubAllGlobals());

describe("parseStreetsRequest", () => {
  it("accepts a normal city bbox", () => {
    expect(parseStreetsRequest(good)).toEqual(good);
  });
  it("reports malformed input", () => {
    expect(parseStreetsRequest("nope")).toEqual({ error: "malformed" });
    expect(parseStreetsRequest({ anchor })).toEqual({ error: "malformed" });
    expect(parseStreetsRequest({ ...good, bbox: { ...good.bbox, west: NaN } })).toEqual({ error: "malformed" });
    expect(parseStreetsRequest({ ...good, bbox: { west: 5, south: 52.36, east: 4, north: 52.38 } })).toEqual({ error: "malformed" });
  });
  it("reports an over-span bbox separately from malformed", () => {
    const wide = { west: 4, south: 52, east: 4 + MAX_BUILDING_SPAN_DEG + 0.01, north: 52.01 };
    expect(parseStreetsRequest({ ...good, bbox: wide })).toEqual({ error: "span" });
  });
});

describe("OsmStreetProvider", () => {
  const body = {
    elements: [
      {
        type: "way", id: 42, tags: { highway: "residential", name: "Testlaan" },
        geometry: [{ lat: 52.37, lon: 4.89 }, { lat: 52.3701, lon: 4.8901 }],
      },
      {
        type: "way", id: 43, tags: { waterway: "canal", name: "Testgracht" },
        geometry: [{ lat: 52.372, lon: 4.892 }, { lat: 52.3721, lon: 4.8921 }],
      },
    ],
  };

  it("queries Overpass for highways AND canals over the bbox", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal("fetch", f);
    const r = await new OsmStreetProvider().fetchStreets(good.bbox, anchor);
    const sent = String(f.mock.calls[0][1].body);
    expect(sent).toContain(encodeURIComponent('way["highway"]'));
    expect(sent).toContain(encodeURIComponent('way["waterway"="canal"]'));
    expect(sent).toContain(
      encodeURIComponent(`(${good.bbox.south},${good.bbox.west},${good.bbox.north},${good.bbox.east})`),
    );
    expect(r.streets.map((s) => s.type).sort()).toEqual(["canal", "street"]);
    expect(r.truncated).toBe(false);
    expect(r.total).toBe(2);
  });

  it("serves a repeat request from cache without re-fetching", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal("fetch", f);
    const p = new OsmStreetProvider();
    const a = await p.fetchStreets(good.bbox, anchor);
    const b = await p.fetchStreets(good.bbox, anchor);
    expect(f).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it("propagates a fatal Overpass error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }));
    await expect(new OsmStreetProvider().fetchStreets(good.bbox, anchor)).rejects.toThrow(/400/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/geo/streetProvider.test.ts`
Expected: FAIL — cannot resolve `./streetProvider`.

- [ ] **Step 4: Write the provider**

```ts
// src/lib/geo/streetProvider.ts
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
    const query =
      `[out:json][timeout:30];` +
      `(way["highway"]${b};way["waterway"="canal"]${b};);` +
      `out geom;`;
    const json = await overpassFetch(query);
    const result = osmToStreets((json.elements ?? []) as OsmWay[], anchor, MAX_STREETS);
    streetCache.set(key, result);
    return result;
  }
}
```

- [ ] **Step 5: Write the route**

```ts
// src/app/api/streets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { OsmStreetProvider, parseStreetsRequest } from "@/lib/geo/streetProvider";

export const runtime = "nodejs";

const provider = new OsmStreetProvider();

export async function POST(req: NextRequest) {
  try {
    const parsed = parseStreetsRequest(await req.json());
    if ("error" in parsed) {
      return NextResponse.json(
        {
          error:
            parsed.error === "span"
              ? "Area too large for streets — zoom in to roughly 5 km across."
              : "Bad request: need { bbox, anchor } with a small, well-ordered bbox.",
        },
        { status: 400 },
      );
    }
    const result = await provider.fetchStreets(parsed.bbox, parsed.anchor);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/streets]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run src/lib/geo/streetProvider.test.ts && npx tsc --noEmit && npx eslint src/lib/geo/streetProvider.ts src/lib/geo/streetProvider.test.ts src/app/api/streets/route.ts && npm test`

Then a live smoke test against the dev server (find its port with `lsof -nP -iTCP -sTCP:LISTEN | grep node`; do NOT start or kill one):
```bash
curl -s -X POST http://localhost:3100/api/streets -H 'content-type: application/json' \
  -d '{"bbox":{"west":4.8952,"south":52.3643,"east":4.9130,"north":52.3709},"anchor":{"lat0":52.3676,"lon0":4.9041}}' \
  | head -c 300
```
Expected: JSON beginning `{"streets":[{"id":"street-osm-` with `truncated` and `total`. Report the real street count and how many are canals.

- [ ] **Step 7: Commit**

```bash
git add src/lib/geo/streetProvider.ts src/lib/geo/streetProvider.test.ts src/app/api/streets/route.ts
git commit -m "feat(api): /api/streets — OSM roads + canals behind StreetProvider"
```

---

### Task 4: Page integration

**Files:**
- Modify: `src/app/facade/page.tsx`

**Interfaces:**
- Consumes: `type StreetFetchResult` shape from Task 2 (via the route's JSON); `EMPTY_NETWORK`, `reserveStreetIds` from `@/lib/street/types`.
- Produces: page state `streetsLoading`, `streetsError`, `streetsInfo`; `loadStreets(bbox, anchor)`; imported-street handling in `handleLoadPlace` and `handleClearTerrain`.

- [ ] **Step 1: Read the pattern you are mirroring**

Read `loadContextBuildings`, `handleLoadPlace` and `handleClearTerrain` in `src/app/facade/page.tsx`. Your street loader must copy their structure exactly: its own request-token ref, its own loading/error/info state, a `try/catch/finally` that never throws into the terrain path, and a token bump in `handleClearTerrain`.

- [ ] **Step 2: Add state + loader**

```ts
  const [streetsLoading, setStreetsLoading] = useState(false);
  const [streetsError, setStreetsError] = useState<string | null>(null);
  const [streetsInfo, setStreetsInfo] = useState<{ truncated: boolean; total: number } | null>(null);
  const streetsReqRef = useRef(0);
```

```ts
  /** Fetch real streets + canals for a bbox and adopt them as the network.
   * Like the buildings loader, this deliberately swallows its error: a failed
   * street import must never roll back a good terrain load. */
  const loadStreets = useCallback(async (box: LngLatBBox, a: GeoAnchor) => {
    const token = ++streetsReqRef.current;
    setStreetsError(null);
    setStreetsInfo(null);
    setStreetsLoading(true);
    try {
      const res = await fetch("/api/streets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bbox: box, anchor: a }),
      });
      const json = (await res.json()) as {
        streets?: Street[]; truncated?: boolean; total?: number; error?: string;
      };
      if (!res.ok || !json.streets) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (streetsReqRef.current !== token) return;
      reserveStreetIds(json.streets);
      // Importing REPLACES the network (consistent with terrain and context
      // buildings being replaced); appending would duplicate on a second load
      // of the same place.
      setStreetNetwork({ ...EMPTY_NETWORK, streets: json.streets });
      setStreetsInfo({ truncated: !!json.truncated, total: json.total ?? json.streets.length });
      // syncStreetBlocks would otherwise generate parametric frontage
      // buildings along EVERY imported street — thousands of lots on top of
      // the real footprints already loaded as context.
      setBuildingsFromStreets(false);
    } catch (e) {
      if (streetsReqRef.current !== token) return;
      setStreetsError(e instanceof Error ? e.message : String(e));
    } finally {
      if (streetsReqRef.current === token) setStreetsLoading(false);
    }
  }, []);
```

Add the imports it needs (`type Street`, `EMPTY_NETWORK`, `reserveStreetIds` from `@/lib/street/types`) — extend the existing street-types import rather than adding a second line.

- [ ] **Step 3: Fire it from `handleLoadPlace`**

Beside the existing `void loadContextBuildings(bbox, a);` add:
```ts
      void loadStreets(bbox, a);
```
and add `loadStreets` to that `useCallback`'s dependency array.

- [ ] **Step 4: Clear it in `handleClearTerrain`**

Alongside the existing buildings resets:
```ts
    streetsReqRef.current++;
    setStreetsLoading(false);
    setStreetsError(null);
    setStreetsInfo(null);
    setStreetNetwork(EMPTY_NETWORK);
```
(The same stuck-flag reasoning as the buildings loader: bumping the token makes the in-flight `finally` a no-op, so the loading flag must be reset here explicitly.)

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit && npx eslint src/app/facade/page.tsx && npm test`
Expected: clean and green. (If the React Compiler reports a hook dependency broader than the declared array, narrow what the body READS — never widen the array.)

```bash
git add src/app/facade/page.tsx
git commit -m "feat(facade): import real streets and canals with a place"
```

---

### Task 5: Street status in the Context panel

**Files:**
- Modify: `src/components/facade/FacadeControls.tsx` (the `ContextPanel` component)
- Modify: `src/app/facade/page.tsx` (pass the new props)

**Interfaces:**
- Produces: `ContextPanel` accepts `streetCount?: number`, `streetsLoading?: boolean`, `streetsTruncated?: boolean`, `streetsTotal?: number`, `streetsError?: string | null`.

- [ ] **Step 1: Add the props and the rows**

In `ContextPanel`, mirroring the existing buildings rows exactly (same classes, same `role="alert"` on the error, same `.toLocaleString()`), add a streets line beneath them:

```tsx
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--muted)]">
              {streetsLoading
                ? "Loading streets…"
                : `${(streetCount ?? 0).toLocaleString()} streets`}
            </span>
          </div>
          {streetsTruncated && (
            <p className="text-[11px] text-[var(--muted)]">
              Showing the first {(streetCount ?? 0).toLocaleString()} of{" "}
              {(streetsTotal ?? 0).toLocaleString()} streets — zoom into a smaller area for the rest.
            </p>
          )}
          {streetsError && (
            <p className="text-[11px] text-red-400" role="alert">
              Streets unavailable: {streetsError}
            </p>
          )}
```

Every prop stays optional so existing usages remain valid. No colored edge stripes.

- [ ] **Step 2: Pass them from the page**

At the `<ContextPanel .../>` element:
```tsx
          streetCount={streetNetwork.streets.length}
          streetsLoading={streetsLoading}
          streetsTruncated={!!streetsInfo?.truncated}
          streetsTotal={streetsInfo?.total ?? 0}
          streetsError={streetsError}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx eslint src/components/facade/FacadeControls.tsx src/app/facade/page.tsx && npm test`

```bash
git add src/components/facade/FacadeControls.tsx src/app/facade/page.tsx
git commit -m "feat(facade): street count, truncation and error in the Context panel"
```

---

## Verification (controller runs this after Task 5)

Against the running dev server (find the port; do NOT start/kill one):

1. **Load place** → real Amsterdam streets AND canals render as paved ribbons draped on the terrain, with junction pads; canals show water and bridges.
2. The Context panel shows a street count (expect ~100–200 after merging) alongside the building count.
3. **Auto-buildings is OFF** after import, and no parametric frontage buildings were generated.
4. Click an imported street → the Street inspector opens; changing its type re-renders it at the new width; Delete removes it.
5. **Perf is acceptable** at this street count — pan/zoom the plan pane and orbit the 3D pane; note any stutter.
6. **Clear terrain** → streets, buildings and terrain all clear together.
7. Save → reload → streets are restored from the document **without** a re-fetch (unlike footprints).

## Self-Review

**Spec coverage:** class mapping → T2; width → T2; merge → T2; caps/truncation → T2 (cap) + T3 (constant, route); provider/route/failover reuse → T1 + T3; parallel load + failure isolation → T4; replace semantics → T4; Auto-buildings off → T4; clear → T4; panel status → T5; no document change → by construction (T4 writes the existing `streetNetwork`); testing → each task; visual → Verification.

**Placeholder scan:** none — every code step carries complete code. Task 1's move is described against named symbols in a file the implementer is told to read in full first.

**Type consistency:** `OsmWay`, `StreetFetchResult`, `classifyWay`, `parseWidth`, `mergeWays`, `osmToStreets`, `overpassFetch`, `overpassCacheKey`, `makeTtlCache`, `parseStreetsRequest`, `MAX_STREETS`, `__resetStreetCacheForTests` are each defined once and consumed with matching signatures. `/api/streets` returns `{ streets, truncated, total }` in T3 and is read with those keys in T4.

**Scope:** M3 only. Dual carriageways, oneway/lanes, `junction=roundabout`, bridge/tunnel tags, rail/tram and relations are deferred per the spec; M4 untouched.
