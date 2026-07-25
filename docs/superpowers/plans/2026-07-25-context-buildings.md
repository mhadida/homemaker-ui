# Context Buildings (Milestone 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loading a real place also loads its real OSM building footprints as grey backdrop massing draped on M1's terrain, with click-to-hide demolition.

**Architecture:** A `BuildingProvider` (Overpass adapter) behind `POST /api/buildings` returns footprints already projected into M1's local-metre `GeoAnchor` frame. They live in page state only — never serialized — and are re-fetched on load from a `bbox` stored in the document. All visible buildings render as ONE merged `BufferGeometry`; a parallel per-triangle id array turns a raycast `faceIndex` back into a building id for click-to-hide.

**Tech Stack:** Next.js 16.2.1 route handlers (`runtime = "nodejs"`), React + React-Three-Fiber + three.js (`THREE.ShapeUtils`, `BufferGeometry`), OpenStreetMap Overpass API (tokenless), vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-context-buildings-design.md`

## Global Constraints

- **Byte-identical invariant:** no place loaded ⇒ `contextBuildings` empty ⇒ nothing renders; a document without the new optional fields loads exactly as today.
- **`SCENE_VERSION` stays 1.** `bbox` + `hiddenIds` are additive OPTIONAL fields. `deserializeScene` rejects any `version !== SCENE_VERSION`, so a bump would reject every existing beta save.
- **`contextBuildings` is NEVER serialized.** Only `bbox` (re-fetch key) and `hiddenIds` persist.
- **Stable id format (verbatim):** `` `${el.type}/${el.id}` `` → e.g. `way/123456`. This is what `hiddenIds` stores and must survive re-fetch.
- **Height resolution (verbatim order):** OSM `height` tag → else `building:levels × 3` → else **8 m**. Non-finite or ≤ 0 falls through to the next rule.
- **Caps (verbatim):** `MAX_BUILDING_SPAN_DEG = 0.05`, `MAX_BUILDINGS = 4000`. Exceeding the count truncates and **reports** it (`truncated`, `total`) — never a silent cap.
- **Ways only.** `way["building"]`; multipolygon relations are deferred (documented, not implemented).
- **Failure isolation:** a buildings-fetch failure must NOT roll back a successful terrain load.
- **Selection gating:** click-to-hide is active only with the Select tool on. Follow the codebase convention at `FacadeViewer.tsx:2195-2197` — pass the callback as `undefined` (not a no-op) when Select is off, so hover highlighting disables too.
- **Next.js 16.2.1 is NOT the Next.js you know** (`AGENTS.md`): mirror the working route at `src/app/api/terrain/route.ts`.
- **Design rules:** dark-only; CSS vars (`--panel-bg`, `--border`, `--muted`, `--foreground`, `--accent`); reuse the header/panel button classes. No colored edge stripes.
- **Deletion Policy:** additive only — do not delete existing code.

---

### Task 1: Pure buildings module (`lib/geo/buildings.ts`)

Types + all the pure math: height resolution, OSM→local-metre projection with capping, ground base, hidden filtering. No three, no React, no network.

**Files:**
- Create: `src/lib/geo/buildings.ts`
- Test: `src/lib/geo/buildings.test.ts`

**Interfaces:**
- Consumes: `project(lat, lon, anchor): [number, number]` and `type GeoAnchor` from `./project`; `groundHeightAt(x, z, ground): number` and `type Ground` from `@/lib/facade/terrain`.
- Produces:
  - `type Vec2 = [number, number]`
  - `interface ContextBuilding { id: string; footprint: Vec2[]; height: number }`
  - `interface FetchResult { buildings: ContextBuilding[]; truncated: boolean; total: number }`
  - `interface OsmElement { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }`
  - `DEFAULT_BUILDING_HEIGHT = 8`
  - `resolveHeight(tags: Record<string, string> | undefined): number`
  - `osmToContextBuildings(elements: OsmElement[], anchor: GeoAnchor, maxBuildings: number): FetchResult`
  - `footprintBase(footprint: Vec2[], ground: Ground): number`
  - `visibleBuildings(all: ContextBuilding[], hidden: ReadonlySet<string>): ContextBuilding[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/geo/buildings.test.ts
import { describe, it, expect } from "vitest";
import {
  resolveHeight,
  osmToContextBuildings,
  footprintBase,
  visibleBuildings,
  DEFAULT_BUILDING_HEIGHT,
  type ContextBuilding,
  type OsmElement,
} from "./buildings";
import type { GeoAnchor } from "./project";
import type { Ground } from "@/lib/facade/terrain";

const ANCHOR: GeoAnchor = { lat0: 52.37, lon0: 4.89 };

describe("resolveHeight", () => {
  it("uses the height tag in metres", () => {
    expect(resolveHeight({ height: "12" })).toBe(12);
    expect(resolveHeight({ height: "12.5" })).toBe(12.5);
  });
  it("tolerates a unit suffix and a decimal comma", () => {
    expect(resolveHeight({ height: "12 m" })).toBe(12);
    expect(resolveHeight({ height: "12,5" })).toBe(12.5);
  });
  it("falls back to building:levels x 3", () => {
    expect(resolveHeight({ "building:levels": "4" })).toBe(12);
  });
  it("prefers height over levels", () => {
    expect(resolveHeight({ height: "20", "building:levels": "2" })).toBe(20);
  });
  it("defaults when tags are missing, junk, or non-positive", () => {
    expect(resolveHeight(undefined)).toBe(DEFAULT_BUILDING_HEIGHT);
    expect(resolveHeight({})).toBe(DEFAULT_BUILDING_HEIGHT);
    expect(resolveHeight({ height: "tall" })).toBe(DEFAULT_BUILDING_HEIGHT);
    expect(resolveHeight({ height: "0" })).toBe(DEFAULT_BUILDING_HEIGHT);
    expect(resolveHeight({ height: "-5" })).toBe(DEFAULT_BUILDING_HEIGHT);
  });
  it("falls through a junk height to a valid levels tag", () => {
    expect(resolveHeight({ height: "0", "building:levels": "3" })).toBe(9);
  });
});

const square = (id: number, lat: number, lon: number, tags?: Record<string, string>): OsmElement => ({
  type: "way",
  id,
  tags,
  geometry: [
    { lat, lon },
    { lat, lon: lon + 0.0001 },
    { lat: lat + 0.0001, lon: lon + 0.0001 },
    { lat: lat + 0.0001, lon },
    { lat, lon }, // Overpass repeats the first node on a closed way
  ],
});

describe("osmToContextBuildings", () => {
  it("projects to local metres and drops the repeated closing node", () => {
    const r = osmToContextBuildings([square(1, ANCHOR.lat0, ANCHOR.lon0)], ANCHOR, 100);
    expect(r.buildings).toHaveLength(1);
    expect(r.buildings[0].id).toBe("way/1");
    expect(r.buildings[0].footprint).toHaveLength(4); // 5 nodes - 1 repeat
    // first vertex sits at the anchor => the local origin
    expect(r.buildings[0].footprint[0][0]).toBeCloseTo(0, 6);
    expect(r.buildings[0].footprint[0][1]).toBeCloseTo(0, 6);
  });
  it("skips elements without enough geometry", () => {
    const r = osmToContextBuildings(
      [{ type: "way", id: 2 }, { type: "way", id: 3, geometry: [{ lat: 1, lon: 1 }] }],
      ANCHOR,
      100,
    );
    expect(r.buildings).toHaveLength(0);
    expect(r.total).toBe(0);
  });
  it("caps at maxBuildings and reports truncation with the pre-cap total", () => {
    const els = Array.from({ length: 5 }, (_, i) => square(i + 1, ANCHOR.lat0, ANCHOR.lon0));
    const r = osmToContextBuildings(els, ANCHOR, 3);
    expect(r.buildings).toHaveLength(3);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(5);
  });
  it("reports no truncation under the cap", () => {
    const r = osmToContextBuildings([square(1, ANCHOR.lat0, ANCHOR.lon0)], ANCHOR, 100);
    expect(r.truncated).toBe(false);
    expect(r.total).toBe(1);
  });
  it("resolves each building's height from its tags", () => {
    const r = osmToContextBuildings(
      [square(1, ANCHOR.lat0, ANCHOR.lon0, { "building:levels": "5" })],
      ANCHOR,
      100,
    );
    expect(r.buildings[0].height).toBe(15);
  });
});

describe("footprintBase", () => {
  const FLAT: Ground = { slope: 0, azimuth: 0 };
  it("is 0 on flat ground", () => {
    expect(footprintBase([[0, 0], [10, 0], [10, 10]], FLAT)).toBe(0);
  });
  it("is the lowest vertex height on a slope", () => {
    // uphill = +z at 10%: h(z) = 0.1*z, so the lowest vertex is z = -20 => -2
    const g: Ground = { slope: 0.1, azimuth: 0 };
    expect(footprintBase([[0, 0], [5, -20], [5, 10]], g)).toBeCloseTo(-2, 9);
  });
  it("is 0 for an empty footprint (no vertices to sample)", () => {
    expect(footprintBase([], FLAT)).toBe(0);
  });
});

describe("visibleBuildings", () => {
  const bs: ContextBuilding[] = [
    { id: "way/1", footprint: [[0, 0]], height: 8 },
    { id: "way/2", footprint: [[1, 1]], height: 8 },
  ];
  it("returns everything when nothing is hidden", () => {
    expect(visibleBuildings(bs, new Set())).toEqual(bs);
  });
  it("filters out hidden ids", () => {
    expect(visibleBuildings(bs, new Set(["way/1"]))).toEqual([bs[1]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/geo/buildings.test.ts`
Expected: FAIL — cannot resolve `./buildings`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/geo/buildings.ts
/** Real-world building footprints loaded as inert backdrop context (M2).
 * Pure — no three, no React, no network. */
import type { GeoAnchor } from "./project";
import { project } from "./project";
import type { Ground } from "@/lib/facade/terrain";
import { groundHeightAt } from "@/lib/facade/terrain";

export type Vec2 = [number, number];

export interface ContextBuilding {
  /** OSM element id, e.g. "way/123456" — stable across re-fetch, so it is the
   * key `hiddenIds` stores. */
  id: string;
  /** Local metres [x, z], projected through the scene's GeoAnchor. */
  footprint: Vec2[];
  /** Resolved height in metres — always finite and > 0. */
  height: number;
}

export interface FetchResult {
  buildings: ContextBuilding[];
  /** true when maxBuildings clipped the result. */
  truncated: boolean;
  /** how many the source returned, BEFORE the cap. */
  total: number;
}

/** The subset of an Overpass `out geom` element we consume. */
export interface OsmElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

export const DEFAULT_BUILDING_HEIGHT = 8;
const METRES_PER_LEVEL = 3;

/** Leading number out of an OSM tag that may carry a unit suffix ("12 m") or
 * a decimal comma ("12,5"). null when there is no number at all. */
function parseNum(v: string | undefined): number | null {
  if (typeof v !== "string") return null;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(v);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** height tag → building:levels x 3 → DEFAULT_BUILDING_HEIGHT. A non-positive
 * or unparseable value falls through to the next rule. */
export function resolveHeight(tags: Record<string, string> | undefined): number {
  const h = parseNum(tags?.height);
  if (h !== null && h > 0) return h;
  const levels = parseNum(tags?.["building:levels"]);
  if (levels !== null && levels > 0) return levels * METRES_PER_LEVEL;
  return DEFAULT_BUILDING_HEIGHT;
}

/** Overpass elements → local-frame buildings, capped at maxBuildings with the
 * pre-cap total reported (callers surface truncation; never a silent cap). */
export function osmToContextBuildings(
  elements: OsmElement[],
  anchor: GeoAnchor,
  maxBuildings: number,
): FetchResult {
  const all: ContextBuilding[] = [];
  for (const el of elements) {
    const g = el.geometry;
    if (!Array.isArray(g) || g.length < 3) continue;
    const pts = g.slice();
    // A closed way repeats its first node last — drop it so the polygon has
    // no duplicate vertex.
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (pts.length > 3 && first.lat === last.lat && first.lon === last.lon) pts.pop();
    if (pts.length < 3) continue;
    all.push({
      id: `${el.type}/${el.id}`,
      footprint: pts.map((p) => project(p.lat, p.lon, anchor)),
      height: resolveHeight(el.tags),
    });
  }
  const total = all.length;
  const truncated = total > maxBuildings;
  return {
    buildings: truncated ? all.slice(0, maxBuildings) : all,
    truncated,
    total,
  };
}

/** Lowest ground height under the footprint — the base a context building sits
 * on, so it never floats on a slope (it buries into the uphill side instead). */
export function footprintBase(footprint: Vec2[], ground: Ground): number {
  let min = Infinity;
  for (const [x, z] of footprint) min = Math.min(min, groundHeightAt(x, z, ground));
  return Number.isFinite(min) ? min : 0;
}

/** Everything the user has not demolished. */
export function visibleBuildings(
  all: ContextBuilding[],
  hidden: ReadonlySet<string>,
): ContextBuilding[] {
  return hidden.size === 0 ? all : all.filter((b) => !hidden.has(b.id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/geo/buildings.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + lint, then commit**

Run: `npx tsc --noEmit && npx eslint src/lib/geo/buildings.ts src/lib/geo/buildings.test.ts`
Expected: both clean (0 errors).

```bash
git add src/lib/geo/buildings.ts src/lib/geo/buildings.test.ts
git commit -m "feat(geo): pure context-building model — height, projection, base, filtering"
```

---

### Task 2: Building provider + `POST /api/buildings`

Wire the pure model to Overpass behind a source-agnostic provider, exposed as a validated route. Mirrors `terrainProvider.ts` + `api/terrain/route.ts` exactly.

**Files:**
- Create: `src/lib/geo/buildingProvider.ts`
- Create: `src/app/api/buildings/route.ts`
- Test: `src/lib/geo/buildingProvider.test.ts`

**Interfaces:**
- Consumes: `type GeoAnchor`, `type LngLatBBox` from `./project`; `osmToContextBuildings`, `type FetchResult`, `type OsmElement` from `./buildings` (Task 1).
- Produces:
  - `interface BuildingProvider { fetchBuildings(bbox: LngLatBBox, anchor: GeoAnchor): Promise<FetchResult> }`
  - `class OsmBuildingProvider implements BuildingProvider`
  - `parseBuildingsRequest(body: unknown): { bbox: LngLatBBox; anchor: GeoAnchor } | null`
  - `MAX_BUILDING_SPAN_DEG = 0.05`, `MAX_BUILDINGS = 4000`
  - Route: `POST /api/buildings` → `200 { buildings, truncated, total }` | `400 { error }` | `500 { error }`

- [ ] **Step 1: Read the existing route + provider you are mirroring**

Read `src/lib/geo/terrainProvider.ts` (note `parseTerrainRequest`'s validation order and the `MAX_SPAN_DEG` comment style) and `src/app/api/terrain/route.ts`. Your new files must follow the same shape: `import { NextRequest, NextResponse } from "next/server"`, `export const runtime = "nodejs"`, `export async function POST(req: NextRequest)`.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/geo/buildingProvider.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseBuildingsRequest,
  OsmBuildingProvider,
  MAX_BUILDING_SPAN_DEG,
} from "./buildingProvider";

const anchor = { lat0: 52.37, lon0: 4.89 };
const good = { bbox: { west: 4.88, south: 52.36, east: 4.90, north: 52.38 }, anchor };

describe("parseBuildingsRequest", () => {
  it("accepts a normal city bbox", () => {
    expect(parseBuildingsRequest(good)).toEqual(good);
  });
  it("rejects a non-object or missing parts", () => {
    expect(parseBuildingsRequest("nope")).toBeNull();
    expect(parseBuildingsRequest(null)).toBeNull();
    expect(parseBuildingsRequest({ anchor })).toBeNull();
    expect(parseBuildingsRequest({ bbox: good.bbox })).toBeNull();
  });
  it("rejects non-finite coordinates", () => {
    expect(parseBuildingsRequest({ ...good, bbox: { ...good.bbox, west: NaN } })).toBeNull();
  });
  it("rejects an inverted or zero-area bbox", () => {
    expect(parseBuildingsRequest({ ...good, bbox: { west: 5, south: 52.36, east: 4, north: 52.38 } })).toBeNull();
    expect(parseBuildingsRequest({ ...good, bbox: { west: 4.9, south: 52.36, east: 4.9, north: 52.38 } })).toBeNull();
  });
  it("rejects a span wider than MAX_BUILDING_SPAN_DEG", () => {
    const wide = { west: 4, south: 52, east: 4 + MAX_BUILDING_SPAN_DEG + 0.01, north: 52.01 };
    expect(parseBuildingsRequest({ ...good, bbox: wide })).toBeNull();
  });
});

describe("OsmBuildingProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("queries Overpass and maps the response into local-frame buildings", async () => {
    const body = {
      elements: [
        {
          type: "way",
          id: 42,
          tags: { building: "yes", "building:levels": "3" },
          geometry: [
            { lat: 52.37, lon: 4.89 },
            { lat: 52.37, lon: 4.8901 },
            { lat: 52.3701, lon: 4.8901 },
            { lat: 52.37, lon: 4.89 },
          ],
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const r = await new OsmBuildingProvider().fetchBuildings(good.bbox, anchor);
    expect(fetchMock).toHaveBeenCalledOnce();
    // the query must be a ways-only building query over the bbox
    const [, init] = fetchMock.mock.calls[0];
    expect(String(init.body)).toContain(encodeURIComponent('way["building"]'));
    expect(r.buildings).toHaveLength(1);
    expect(r.buildings[0].id).toBe("way/42");
    expect(r.buildings[0].height).toBe(9); // 3 levels x 3 m
    expect(r.truncated).toBe(false);
    expect(r.total).toBe(1);
  });

  it("throws a clear error when Overpass rate-limits", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));
    await expect(new OsmBuildingProvider().fetchBuildings(good.bbox, anchor)).rejects.toThrow(/429/);
  });

  it("returns an empty result when the source has no elements", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    const r = await new OsmBuildingProvider().fetchBuildings(good.bbox, anchor);
    expect(r.buildings).toEqual([]);
    expect(r.total).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/geo/buildingProvider.test.ts`
Expected: FAIL — cannot resolve `./buildingProvider`.

- [ ] **Step 4: Write the provider**

```ts
// src/lib/geo/buildingProvider.ts
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

/** Validate an untrusted request body. Exported so the route and its test share
 * one definition. Mirrors parseTerrainRequest's guards with the tighter span. */
export function parseBuildingsRequest(
  body: unknown,
): { bbox: LngLatBBox; anchor: GeoAnchor } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = (body as { bbox?: unknown }).bbox as Partial<LngLatBBox> | undefined;
  const a = (body as { anchor?: unknown }).anchor as Partial<GeoAnchor> | undefined;
  if (!b || !a) return null;
  if (!isNum(b.west) || !isNum(b.south) || !isNum(b.east) || !isNum(b.north)) return null;
  if (!isNum(a.lat0) || !isNum(a.lon0)) return null;
  if (!(b.west < b.east && b.south < b.north)) return null;
  if (b.east - b.west > MAX_BUILDING_SPAN_DEG || b.north - b.south > MAX_BUILDING_SPAN_DEG) {
    return null;
  }
  return {
    bbox: { west: b.west, south: b.south, east: b.east, north: b.north },
    anchor: { lat0: a.lat0, lon0: a.lon0 },
  };
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export class OsmBuildingProvider implements BuildingProvider {
  async fetchBuildings(bbox: LngLatBBox, anchor: GeoAnchor): Promise<FetchResult> {
    // Ways only — multipolygon relations (courtyard holes) are deferred.
    // `out geom` inlines each way's node coordinates so one request suffices.
    const query =
      `[out:json][timeout:25];` +
      `way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
      `out geom;`;
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) {
      const hint =
        res.status === 429 || res.status === 504
          ? " — Overpass is rate-limiting or busy; try again shortly"
          : "";
      throw new Error(`Overpass HTTP ${res.status}${hint}`);
    }
    const json = (await res.json()) as { elements?: OsmElement[] };
    return osmToContextBuildings(json.elements ?? [], anchor, MAX_BUILDINGS);
  }
}
```

- [ ] **Step 5: Write the route handler**

```ts
// src/app/api/buildings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { OsmBuildingProvider, parseBuildingsRequest } from "@/lib/geo/buildingProvider";

export const runtime = "nodejs";

const provider = new OsmBuildingProvider();

export async function POST(req: NextRequest) {
  try {
    const parsed = parseBuildingsRequest(await req.json());
    if (!parsed) {
      return NextResponse.json(
        { error: "Bad request: need { bbox, anchor } with a small, well-ordered bbox." },
        { status: 400 },
      );
    }
    const result = await provider.fetchBuildings(parsed.bbox, parsed.anchor);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/buildings]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/geo/buildingProvider.test.ts && npm test`
Expected: the new suite passes; the full suite stays green.

- [ ] **Step 7: Typecheck + lint, then commit**

Run: `npx tsc --noEmit && npx eslint src/lib/geo/buildingProvider.ts src/app/api/buildings/route.ts src/lib/geo/buildingProvider.test.ts`
Expected: both clean.

```bash
git add src/lib/geo/buildingProvider.ts src/app/api/buildings/route.ts src/lib/geo/buildingProvider.test.ts
git commit -m "feat(api): /api/buildings — OSM footprints behind BuildingProvider"
```

---

### Task 3: Merged context-building mesh (`ContextBuildings.tsx`)

One merged geometry for every visible building, draped on the ground, with a per-triangle id array for picking, a hover highlight, and click-to-hide.

**Files:**
- Create: `src/components/facade/ContextBuildings.tsx`

**Interfaces:**
- Consumes: `type ContextBuilding`, `footprintBase`, `visibleBuildings` from `@/lib/geo/buildings` (Task 1); `type Ground` from `@/lib/facade/terrain`.
- Produces: `export default function ContextBuildings(props: { buildings: ContextBuilding[]; ground: Ground; hiddenIds: ReadonlySet<string>; visible: boolean; onHide?: (id: string) => void })`

- [ ] **Step 1: Write the component**

```tsx
// src/components/facade/ContextBuildings.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { ContextBuilding } from "@/lib/geo/buildings";
import { footprintBase, visibleBuildings } from "@/lib/geo/buildings";
import type { Ground } from "@/lib/facade/terrain";

/** Neutral grey — reads as backdrop against the app's warmer wall colours. */
const CONTEXT_COLOR = "#8d8880";
const HIGHLIGHT_COLOR = "#c0b8a8";

/** One merged geometry for every building, plus a per-TRIANGLE building-id
 * lookup: a raycast gives us `faceIndex`, and faceBuilding[faceIndex] is the
 * building that triangle belongs to. That is the only way to resolve an
 * individual building inside a merged mesh (which we need, because thousands
 * of separate meshes would be thousands of draw calls). */
function buildMerged(buildings: ContextBuilding[], ground: Ground) {
  const positions: number[] = [];
  const faceBuilding: string[] = [];
  for (const b of buildings) {
    const base = footprintBase(b.footprint, ground);
    const top = base + b.height;
    const n = b.footprint.length;
    // Walls: a quad (2 triangles) per footprint edge.
    for (let i = 0; i < n; i++) {
      const [x0, z0] = b.footprint[i];
      const [x1, z1] = b.footprint[(i + 1) % n];
      positions.push(x0, base, z0, x1, base, z1, x1, top, z1);
      positions.push(x0, base, z0, x1, top, z1, x0, top, z0);
      faceBuilding.push(b.id, b.id);
    }
    // Roof cap: real triangulation, because footprints are frequently
    // non-convex and a triangle fan would produce a wrong cap.
    const contour = b.footprint.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [ia, ib, ic] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const pa = b.footprint[ia];
      const pb = b.footprint[ib];
      const pc = b.footprint[ic];
      positions.push(pa[0], top, pa[1], pb[0], top, pb[1], pc[0], top, pc[1]);
      faceBuilding.push(b.id);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return { geo, faceBuilding };
}

/** Real building footprints as inert grey backdrop massing (M2). Renders
 * nothing when hidden or empty, so a scene with no place loaded is unchanged.
 * `onHide` undefined => not interactive (Select tool off): no hover, no click. */
export default function ContextBuildings({
  buildings,
  ground,
  hiddenIds,
  visible,
  onHide,
}: {
  buildings: ContextBuilding[];
  ground: Ground;
  hiddenIds: ReadonlySet<string>;
  visible: boolean;
  onHide?: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const shown = useMemo(
    () => visibleBuildings(buildings, hiddenIds),
    [buildings, hiddenIds],
  );
  const merged = useMemo(
    () => (shown.length ? buildMerged(shown, ground) : null),
    [shown, ground],
  );
  useEffect(() => () => merged?.geo.dispose(), [merged]);

  // Drop a stale hover when the set changes (e.g. the hovered one was
  // hidden) — DERIVED, not reset via a setState-in-effect round trip, which
  // the react-hooks/set-state-in-effect rule rejects.
  const validHovered = useMemo(
    () => (hovered && shown.some((b) => b.id === hovered) ? hovered : null),
    [hovered, shown],
  );

  // A hovered building needs its own little geometry — you cannot tint one
  // building inside a merged mesh.
  const hoverGeo = useMemo(() => {
    if (!onHide || !validHovered) return null;
    const b = shown.find((x) => x.id === validHovered);
    return b ? buildMerged([b], ground).geo : null;
  }, [onHide, validHovered, shown, ground]);
  useEffect(() => () => hoverGeo?.dispose(), [hoverGeo]);

  if (!visible || !merged) return null;

  // `faceIndex` is typed `number | null | undefined` (see @types/three's
  // Intersection) — a `=== undefined` check would leave `null` unnarrowed and
  // index the array with it, so test for a number.
  const idAt = (e: ThreeEvent<PointerEvent | MouseEvent>): string | undefined =>
    typeof e.faceIndex === "number" ? merged.faceBuilding[e.faceIndex] : undefined;

  return (
    <>
      <mesh
        geometry={merged.geo}
        receiveShadow
        onPointerMove={
          onHide
            ? (e) => {
                e.stopPropagation();
                setHovered(idAt(e) ?? null);
              }
            : undefined
        }
        onPointerOut={onHide ? () => setHovered(null) : undefined}
        onClick={
          onHide
            ? (e) => {
                e.stopPropagation();
                const id = idAt(e);
                if (id) onHide(id);
              }
            : undefined
        }
      >
        {/* DoubleSide: OSM ways wind either way, so a single-sided cap or wall
            would be invisible from outside on roughly half the buildings. */}
        <meshStandardMaterial
          color={CONTEXT_COLOR}
          roughness={0.95}
          side={THREE.DoubleSide}
        />
      </mesh>
      {hoverGeo && (
        <mesh geometry={hoverGeo}>
          <meshStandardMaterial
            color={HIGHLIGHT_COLOR}
            roughness={0.9}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/facade/ContextBuildings.tsx`
Expected: both clean (0 errors, 0 warnings). If the React Compiler lint rule complains that a `useMemo`'s inferred dependency is broader than the declared array, narrow what the memo body READS (this exact rule bit the M1 ground mesh — do not just widen the array).

- [ ] **Step 3: Run the full suite (no regressions)**

Run: `npm test`
Expected: all suites still pass (this task adds no tests — the component is verified visually once Task 6 mounts it).

- [ ] **Step 4: Commit**

```bash
git add src/components/facade/ContextBuildings.tsx
git commit -m "feat(facade): merged context-building mesh with faceIndex picking"
```

---

### Task 4: Persist `bbox` + `hiddenIds` (`document.ts`)

The re-fetch key and the demolition set. Additive optionals; `SCENE_VERSION` unchanged.

**Files:**
- Modify: `src/lib/facade/document.ts` (`SceneState` ~line 19, `FacadeDocument` ~line 30, `serializeScene` ~line 45, validators + `deserializeScene` return)
- Test: `src/lib/facade/document.test.ts` (extend)

**Interfaces:**
- Consumes: `type LngLatBBox` from `@/lib/geo/project`.
- Produces: `SceneState` gains `bbox: LngLatBBox | null` and `hiddenIds: Set<string>`; `FacadeDocument` gains `bbox?: LngLatBBox` and `hiddenIds?: string[]`; exports `validBBox(v: unknown): v is LngLatBBox`.

- [ ] **Step 1: Write the failing test** (append to `src/lib/facade/document.test.ts`)

```ts
describe("document context-building fields", () => {
  const BBOX = { west: 4.88, south: 52.36, east: 4.9, north: 52.38 };

  function sceneWith(over: Record<string, unknown>) {
    return {
      blocks: [],
      cornerChoices: new Map(),
      ground: { slope: 0, azimuth: 0 },
      streetWidth: 14,
      maxCornerAngle: 60,
      streetNetwork: { streets: [], roundabouts: [], squares: [] },
      anchor: null,
      bbox: null,
      hiddenIds: new Set<string>(),
      ...over,
    };
  }

  it("round-trips bbox and hiddenIds", () => {
    const scene = sceneWith({ bbox: BBOX, hiddenIds: new Set(["way/1", "way/2"]) });
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene as never))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.bbox).toEqual(BBOX);
    expect(Array.from(back.scene.hiddenIds).sort()).toEqual(["way/1", "way/2"]);
  });

  it("a document without the fields loads clean (byte-identical)", () => {
    const doc = {
      version: 1,
      blocks: [],
      cornerChoices: [],
      ground: { slope: 0, azimuth: 0 },
      streetWidth: 14,
      maxCornerAngle: 60,
      streetNetwork: { streets: [], roundabouts: [], squares: [] },
    };
    const back = deserializeScene(doc);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.bbox).toBeNull();
    expect(back.scene.hiddenIds.size).toBe(0);
  });

  it("drops a malformed bbox and non-string hiddenIds rather than throwing", () => {
    const doc = {
      version: 1,
      blocks: [],
      cornerChoices: [],
      ground: { slope: 0, azimuth: 0 },
      streetWidth: 14,
      maxCornerAngle: 60,
      streetNetwork: { streets: [], roundabouts: [], squares: [] },
      bbox: { west: 1, south: 2 },
      hiddenIds: ["way/1", 7, null],
    };
    const back = deserializeScene(doc);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.bbox).toBeNull();
    expect(Array.from(back.scene.hiddenIds)).toEqual(["way/1"]);
  });

  it("omits empty hiddenIds from the serialized document", () => {
    const doc = serializeScene(sceneWith({}) as never);
    expect(doc.hiddenIds).toBeUndefined();
    expect(doc.bbox).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/facade/document.test.ts`
Expected: FAIL — `bbox`/`hiddenIds` are not part of `SceneState`.

- [ ] **Step 3: Extend the document module**

Add the import at the top of `src/lib/facade/document.ts`:
```ts
import type { GeoAnchor, LngLatBBox } from "@/lib/geo/project";
```
(the file already imports `GeoAnchor`; extend that import rather than adding a second line).

Add to `SceneState`:
```ts
  /** bbox the context buildings were fetched for — the re-fetch key. The
   * footprints themselves are NEVER serialized (thousands of polygons). */
  bbox: LngLatBBox | null;
  /** Context buildings the user demolished, by OSM id. Sparse. */
  hiddenIds: Set<string>;
```

Add to `FacadeDocument`:
```ts
  bbox?: LngLatBBox;
  hiddenIds?: string[];
```

In `serializeScene`, add to the returned object:
```ts
    bbox: s.bbox ?? undefined,
    hiddenIds: s.hiddenIds.size ? Array.from(s.hiddenIds) : undefined,
```

Add the validator next to the other validators:
```ts
export function validBBox(v: unknown): v is LngLatBBox {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (["west", "south", "east", "north"] as const).every((k) => isFiniteNumber(b[k]));
}
```

In `deserializeScene`, before the return, parse both:
```ts
  const bbox: LngLatBBox | null = validBBox(doc.bbox) ? doc.bbox : null;
  const hiddenIds = new Set<string>(
    Array.isArray(doc.hiddenIds)
      ? (doc.hiddenIds as unknown[]).filter((s): s is string => typeof s === "string")
      : [],
  );
```
and add `bbox,` and `hiddenIds,` to the returned `scene` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/facade/document.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix other SceneState literals, then run the full suite**

`SceneState` gained two required fields, so any other place constructing one literally (page.tsx's save/autosave payloads are handled in Task 5; other test fixtures may exist) must add `bbox` and `hiddenIds`.

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/facade/document.ts src/lib/facade/document.test.ts
git commit -m "feat(facade): persist context bbox + hidden building ids (version unchanged)"
```

---

### Task 5: Page state + load flow (`page.tsx`)

Fetch buildings alongside terrain with failure isolation, re-fetch on document load, and thread the new fields through save/autosave/clear.

**Files:**
- Modify: `src/app/facade/page.tsx` (state ~line 262-272, `handleLoadPlace` ~line 377, `handleClearTerrain` ~line 400, `applyScene` ~line 318, save ~line 343, autosave ~line 441)

**Interfaces:**
- Consumes: `type ContextBuilding`, `type FetchResult` from `@/lib/geo/buildings`; `anchorOf`, `type GeoAnchor`, `type LngLatBBox` from `@/lib/geo/project` (already imported).
- Produces: page state `contextBuildings`, `bbox`, `hiddenIds`, `contextVisible`, `buildingsLoading`, `buildingsError`, `buildingsInfo`; callbacks `handleHideContextBuilding(id: string)`, `handleRestoreHidden()`, `setContextVisible`.

- [ ] **Step 1: Add state and the fetch helper**

Add the import:
```ts
import type { ContextBuilding } from "@/lib/geo/buildings";
```

Add state beside the existing terrain state (after `terrainError`):
```ts
  // Context buildings (M2). The footprints are page state ONLY — never
  // serialized; `bbox` is the key they are re-fetched from on load.
  const [contextBuildings, setContextBuildings] = useState<ContextBuilding[]>([]);
  const [bbox, setBbox] = useState<LngLatBBox | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [contextVisible, setContextVisible] = useState(true);
  const [buildingsLoading, setBuildingsLoading] = useState(false);
  const [buildingsError, setBuildingsError] = useState<string | null>(null);
  const [buildingsInfo, setBuildingsInfo] = useState<{ truncated: boolean; total: number } | null>(null);
```

Add the shared fetch helper (near `handleLoadPlace`):
```ts
  /** Fetch context footprints for a bbox. Deliberately swallows its error into
   * `buildingsError`: a failed backdrop must never roll back a good terrain
   * load (Overpass is slow and rate-limits). */
  const loadContextBuildings = useCallback(
    async (box: LngLatBBox, a: GeoAnchor) => {
      setBuildingsError(null);
      setBuildingsInfo(null);
      setBuildingsLoading(true);
      try {
        const res = await fetch("/api/buildings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bbox: box, anchor: a }),
        });
        const json = (await res.json()) as {
          buildings?: ContextBuilding[];
          truncated?: boolean;
          total?: number;
          error?: string;
        };
        if (!res.ok || !json.buildings) throw new Error(json.error ?? `HTTP ${res.status}`);
        setContextBuildings(json.buildings);
        setBuildingsInfo({ truncated: !!json.truncated, total: json.total ?? json.buildings.length });
      } catch (e) {
        setContextBuildings([]);
        setBuildingsError(e instanceof Error ? e.message : String(e));
      } finally {
        setBuildingsLoading(false);
      }
    },
    [],
  );
```

- [ ] **Step 2: Extend `handleLoadPlace` to also load buildings**

In `handleLoadPlace`, after `setAnchor(a);` add `setBbox(bbox);`, and after `setPickerOpen(false);` kick off the backdrop fetch (not awaited inside the terrain try/catch, so it cannot affect the terrain result):
```ts
      setGround((g) => ({ ...g, hf: json.heightfield }));
      setAnchor(a);
      setBbox(bbox);
      setHiddenIds(new Set());
      setPickerOpen(false);
      void loadContextBuildings(bbox, a);
```
and add `loadContextBuildings` to the `useCallback` dependency array.

- [ ] **Step 3: Extend `handleClearTerrain` and add the hide/restore callbacks**

```ts
  const handleClearTerrain = useCallback(() => {
    setGround((g) => ({ slope: g.slope, azimuth: g.azimuth })); // drop hf
    setAnchor(null);
    setBbox(null);
    setContextBuildings([]);
    setHiddenIds(new Set());
    setBuildingsError(null);
    setBuildingsInfo(null);
  }, []);

  /** Demolish one context building (click-to-hide). */
  const handleHideContextBuilding = useCallback((id: string) => {
    setHiddenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  /** Bring every demolished context building back — a hidden one cannot be
   * clicked again, so this is the only way out. */
  const handleRestoreHidden = useCallback(() => setHiddenIds(new Set()), []);
```

- [ ] **Step 4: Thread the fields through save / autosave / load**

In `applyScene` (where `setAnchor(s.anchor)` lives), add:
```ts
    setBbox(s.bbox);
    setHiddenIds(s.hiddenIds);
    setContextBuildings([]);
    setBuildingsError(null);
    setBuildingsInfo(null);
    // Footprints are not in the document — re-fetch them for the saved bbox.
    if (s.bbox && s.anchor) void loadContextBuildings(s.bbox, s.anchor);
```
and add `loadContextBuildings` to `applyScene`'s dependency array.

In BOTH `serializeScene({ … })` payloads (the `handleSave` callback and the debounced autosave effect) add:
```ts
      bbox,
      hiddenIds,
```
and add `bbox, hiddenIds` to both dependency arrays.

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors (the `SceneState` literals now satisfy Task 4's added fields); all suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/facade/page.tsx
git commit -m "feat(facade): load context buildings with a place; persist bbox + hidden ids"
```

---

### Task 6: Render + gate picking (`SceneContents.tsx`, `FacadeViewer.tsx`)

Mount the backdrop in the shared scene and gate its interactivity behind the Select tool.

**Files:**
- Modify: `src/components/facade/SceneContents.tsx` (props block ~line 425-445, render body)
- Modify: `src/components/facade/FacadeViewer.tsx` (props ~line 1347/1388, select gating ~line 2182-2197, the THREE `<SceneContents .../>` mounts at ~1503, ~1865, ~2053, and the inner-component prop plumbing)

**Interfaces:**
- Consumes: `ContextBuildings` (Task 3); page callbacks from Task 5.
- Produces: `SceneContents` and `FacadeViewer` both accept `contextBuildings: ContextBuilding[]`, `hiddenIds: ReadonlySet<string>`, `contextVisible: boolean`, `onHideContextBuilding?: (id: string) => void`.

- [ ] **Step 1: Render the backdrop in `SceneContents`**

Add the imports:
```ts
import ContextBuildings from "./ContextBuildings";
import type { ContextBuilding } from "@/lib/geo/buildings";
```

Add to the props type and the destructured parameter list (defaults keep every existing caller valid and the feature inert):
```ts
  /** Real footprints loaded as backdrop context (M2). Empty = nothing renders. */
  contextBuildings?: ContextBuilding[];
  hiddenIds?: ReadonlySet<string>;
  contextVisible?: boolean;
  /** undefined ⇒ not interactive (Select tool off). */
  onHideContextBuilding?: (id: string) => void;
```

Render it inside the returned fragment, right before the ground `<group quaternion={groundQuat}>` block:
```tsx
      <ContextBuildings
        buildings={contextBuildings ?? EMPTY_CONTEXT}
        ground={ground}
        hiddenIds={hiddenIds ?? EMPTY_HIDDEN}
        visible={contextVisible ?? true}
        onHide={onHideContextBuilding}
      />
```
with these module-scope constants next to the file's other constants (stable identities keep the memos in `ContextBuildings` from re-running every frame):
```ts
const EMPTY_CONTEXT: ContextBuilding[] = [];
const EMPTY_HIDDEN: ReadonlySet<string> = new Set();
```

- [ ] **Step 2: Thread + gate in `FacadeViewer`**

Add the four props to `FacadeViewer`'s props type and destructuring, and to the inner pane component that renders `<SceneContents>` (follow how `ground` is already threaded to all three mounts).

At the select-gating choke point (beside `onSelectStreet`/`onSelectIntersection`/`onSelectSquare`, ~line 2195), gate the hide callback the SAME way — `undefined` when Select is off, so hover highlighting stops too:
```ts
  const onHideContextBuilding = selectMode ? rawHideContextBuilding : undefined;
```
where `rawHideContextBuilding` is the prop passed in from the page. Pass `onHideContextBuilding` (plus `contextBuildings`, `hiddenIds`, `contextVisible`) down to **all three** `<SceneContents .../>` mounts.

- [ ] **Step 3: Pass the props from the page**

In `src/app/facade/page.tsx`, at the `<FacadeViewer .../>` element, add:
```tsx
              contextBuildings={contextBuildings}
              hiddenIds={hiddenIds}
              contextVisible={contextVisible}
              onHideContextBuilding={handleHideContextBuilding}
```

- [ ] **Step 4: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npx eslint src/components/facade/SceneContents.tsx src/components/facade/FacadeViewer.tsx && npm test`
Expected: all clean and green.

- [ ] **Step 5: Commit**

```bash
git add src/components/facade/SceneContents.tsx src/components/facade/FacadeViewer.tsx src/app/facade/page.tsx
git commit -m "feat(facade): render context buildings; gate click-to-hide behind Select"
```

---

### Task 7: Context panel (`FacadeControls.tsx`)

Visibility toggle, counts, truncation notice, fetch error, and Restore hidden.

**Files:**
- Modify: `src/components/facade/FacadeControls.tsx` (props ~line 86 + destructuring ~line 234; new `Section` near the Topography one ~line 723)
- Modify: `src/app/facade/page.tsx` (pass the new props at the `<FacadeControls .../>` element)

**Interfaces:**
- Consumes: page state/callbacks from Task 5.
- Produces: `FacadeControls` accepts `contextLoaded?: boolean`, `contextCount?: number`, `contextVisible?: boolean`, `onToggleContext?: () => void`, `contextTruncated?: boolean`, `contextTotal?: number`, `contextLoading?: boolean`, `contextError?: string | null`, `hiddenCount?: number`, `onRestoreHidden?: () => void`.

- [ ] **Step 1: Add the props**

Add to the props interface (~line 86, beside `terrainImported`) and the destructuring (~line 234):
```ts
  /** M2 context buildings — the section only renders when a place is loaded. */
  contextLoaded?: boolean;
  contextCount?: number;
  contextVisible?: boolean;
  onToggleContext?: () => void;
  contextTruncated?: boolean;
  contextTotal?: number;
  contextLoading?: boolean;
  contextError?: string | null;
  hiddenCount?: number;
  onRestoreHidden?: () => void;
```

- [ ] **Step 2: Add the section**

Render it immediately after the Topography `Section` block (the `{!terrainImported && ( … )}` at ~line 723), so world-level settings stay grouped:
```tsx
      {contextLoaded && (
        <Section title="Context">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--muted)]">
              {contextLoading
                ? "Loading buildings…"
                : `${(contextCount ?? 0).toLocaleString()} buildings`}
            </span>
            <button
              type="button"
              onClick={onToggleContext}
              aria-pressed={contextVisible ?? true}
              className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                contextVisible ?? true
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30"
              }`}
            >
              {contextVisible ?? true ? "Shown" : "Hidden"}
            </button>
          </div>
          {contextTruncated && (
            <p className="text-[11px] text-[var(--muted)]">
              Showing the first {(contextCount ?? 0).toLocaleString()} of{" "}
              {(contextTotal ?? 0).toLocaleString()} — zoom into a smaller area for the rest.
            </p>
          )}
          {contextError && (
            <p className="text-[11px] text-red-400" role="alert">
              Buildings unavailable: {contextError}
            </p>
          )}
          {(hiddenCount ?? 0) > 0 && (
            <button
              type="button"
              onClick={onRestoreHidden}
              className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
            >
              Restore hidden ({hiddenCount})
            </button>
          )}
        </Section>
      )}
```

- [ ] **Step 3: Pass the props from the page**

At the `<FacadeControls .../>` element in `src/app/facade/page.tsx`:
```tsx
                  contextLoaded={!!bbox}
                  contextCount={contextBuildings.length}
                  contextVisible={contextVisible}
                  onToggleContext={() => setContextVisible((v) => !v)}
                  contextTruncated={!!buildingsInfo?.truncated}
                  contextTotal={buildingsInfo?.total ?? 0}
                  contextLoading={buildingsLoading}
                  contextError={buildingsError}
                  hiddenCount={hiddenIds.size}
                  onRestoreHidden={handleRestoreHidden}
```

- [ ] **Step 4: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npx eslint src/components/facade/FacadeControls.tsx src/app/facade/page.tsx && npm test`
Expected: all clean and green.

- [ ] **Step 5: Commit**

```bash
git add src/components/facade/FacadeControls.tsx src/app/facade/page.tsx
git commit -m "feat(facade): Context panel — visibility, counts, truncation, restore"
```

---

## Verification (controller runs this after Task 7)

In-browser end-to-end against the dev server (find its port — it may not be
3000; check `lsof -nP -iTCP -sTCP:LISTEN | grep node`):

1. **Load place** on a dense area → grey footprints appear draped on the terrain, and the Context section shows a count.
2. Turn **Select** on → hover tints one building → click hides it → **Restore hidden (1)** brings it back.
3. Turn **Select** off → hovering tints nothing and clicking hides nothing.
4. **Context: Shown/Hidden** toggles the whole backdrop with no re-fetch.
5. **Save** → reload → the backdrop re-fetches from the stored bbox and the demolished building stays hidden.
6. **Clear terrain** → backdrop and hidden set clear with the terrain.
7. Force a buildings failure (e.g. temporarily point `OVERPASS_URL` at an invalid host) → the terrain still loads and only the Context error line appears. Revert afterwards.

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| `ContextBuilding` / `FetchResult` types | 1 |
| Height: `height` → `levels × 3` → 8 m | 1 |
| OSM → local metres via anchor; stable `way/N` id | 1 |
| `footprintBase` = min ground under footprint | 1 |
| `visibleBuildings` hidden filtering | 1 |
| `BuildingProvider` + Overpass adapter, ways only | 2 |
| `MAX_BUILDING_SPAN_DEG` 0.05, `MAX_BUILDINGS` 4000, truncation reported | 1 (cap/report), 2 (constants + span guard) |
| `POST /api/buildings` 200/400/500 | 2 |
| One merged BufferGeometry, walls + triangulated cap | 3 |
| Drape: base = min ground, top = base + height | 1 (`footprintBase`) + 3 (use) |
| Picking via `faceIndex` → `faceBuilding[]` | 3 |
| Hover highlight (separate geometry) | 3 |
| `bbox` + `hiddenIds` persisted, `SCENE_VERSION` 1, malformed dropped | 4 |
| Footprints never serialized; re-fetch on load | 4 (no field) + 5 (re-fetch) |
| Parallel load + failure isolation | 5 |
| Clear terrain clears context | 5 |
| Select-tool gating (`undefined` when off) | 6 |
| Context panel: toggle, count, truncation, error, Restore hidden | 7 |
| Visual verification list | Verification section |

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to Task N". Every code step carries complete code. Task 6's edits are described against named anchors rather than pasted whole-file, because the three `<SceneContents>` mounts and the props plumbing are mechanical repetitions of an existing pattern in a 2800-line file — the implementer is told exactly which lines and which existing prop (`ground`) to mirror.

**Type consistency:** `ContextBuilding`, `FetchResult`, `OsmElement`, `resolveHeight`, `osmToContextBuildings`, `footprintBase`, `visibleBuildings`, `BuildingProvider`, `OsmBuildingProvider`, `parseBuildingsRequest`, `MAX_BUILDING_SPAN_DEG`, `MAX_BUILDINGS`, `validBBox`, `ContextBuildings` props, and the page callbacks (`handleHideContextBuilding`, `handleRestoreHidden`, `loadContextBuildings`) are each defined once and consumed with matching signatures. `/api/buildings` returns `{ buildings, truncated, total }` in Task 2 and is read with exactly those keys in Task 5. `hiddenIds` is a `Set<string>` in memory everywhere and a `string[]` only on disk (Task 4).

**Scope:** Single milestone (context backdrop). Promote-to-editable (M4) and street import (M3) are untouched.
