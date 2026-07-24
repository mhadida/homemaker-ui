# ArcGIS Terrain Import (Milestone 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick a real place on a mini-map and stand on its real terrain, using every existing hand-drawn tool, with nothing-imported staying byte-identical to today.

**Architecture:** A real DEM slots in behind the existing `groundHeightAt(x,z,g)` seam as an optional `Heightfield` on `Ground`. A MapLibre bbox picker → `anchor {lat0,lon0}` → `POST /api/terrain` (open AWS Terrain Tiles, decoded/resampled server-side) → the heightfield. The ground mesh becomes a displaced grid when a heightfield is present; leveling basements/streets/trees follow the real surface for free because they already sample `groundHeightAt`.

**Tech Stack:** Next.js 16.2.1 (App Router route handlers, `runtime = "nodejs"`), React + React-Three-Fiber + three.js, MapLibre GL (tokenless basemap), `pngjs` (server-side terrarium decode), vitest.

**Spec:** `docs/superpowers/specs/2026-07-24-arcgis-terrain-import-design.md`

## Global Constraints

- **Byte-identical invariant:** `ground.hf` absent ⇒ existing plane math, existing flat-quad-tilted-by-`groundNormal` rendering, existing save round-trip. Every task preserves this. It is the primary regression guard.
- **`SCENE_VERSION` stays `1`.** `hf` + `anchor` are additive OPTIONAL fields. `deserializeScene` rejects any `version !== SCENE_VERSION` (`document.ts:161`), so bumping would reject every existing beta save.
- **Axis convention (verbatim):** `east → +x`, `north → +z`. WGS84 radius `R = 6378137`. Confirmed at `BuildingViewer.tsx:33,151` and matches the topography azimuth math.
- **Terrarium decode (verbatim):** `height_m = R·256 + G + B/256 − 32768` (so RGB `(128,0,0)` = 0 m).
- **Heightfield grid cap:** `cols`, `rows` ≤ `128` (bounds document + localStorage size).
- **Next.js 16.2.1 is NOT the Next.js you know** (per `AGENTS.md`): before writing the route handler, read `node_modules/next/dist/docs/` for the current route-handler API. Mirror the working pattern in `src/app/api/facade-prompt/route.ts` (`import { NextRequest, NextResponse } from "next/server"; export const runtime = "nodejs"; export async function POST(req)`).
- **Design rules (picker UI):** dark-only; use the existing CSS vars (`--panel-bg`, `--border`, `--muted`, `--foreground`, `--accent`); reuse the header button class from `page.tsx:1197`. No colored edge stripes.
- **Pure geometry stays import-source-agnostic** (roadmap note): the DEM source lives only behind the `TerrainProvider` interface + the route; nothing in `lib/facade/*` or `lib/geo/project.ts` knows the source.

---

### Task 1: Projection module (`lib/geo/project.ts`)

Pure lon/lat ↔ local-metre projection. No three, no React. Foundation for every later task.

**Files:**
- Create: `src/lib/geo/project.ts`
- Test: `src/lib/geo/project.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface GeoAnchor { lat0: number; lon0: number }`
  - `interface LngLatBBox { west: number; south: number; east: number; north: number }`
  - `anchorOf(b: LngLatBBox): GeoAnchor`
  - `project(lat: number, lon: number, a: GeoAnchor): [number, number]`  // [x, z]
  - `unproject(x: number, z: number, a: GeoAnchor): [number, number]`   // [lat, lon]

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/geo/project.test.ts
import { describe, it, expect } from "vitest";
import { project, unproject, anchorOf, type GeoAnchor } from "./project";

const AMS: GeoAnchor = { lat0: 52.3676, lon0: 4.9041 };

describe("anchorOf", () => {
  it("is the bbox centre", () => {
    expect(anchorOf({ west: 4, south: 52, east: 6, north: 54 })).toEqual({
      lat0: 53,
      lon0: 5,
    });
  });
});

describe("project", () => {
  it("maps the anchor to the origin", () => {
    const [x, z] = project(AMS.lat0, AMS.lon0, AMS);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("1° north ≈ 111.32 km on +z, east on +x", () => {
    const [, z] = project(AMS.lat0 + 1, AMS.lon0, AMS);
    expect(z).toBeCloseTo(111319, 0);
    const [x] = project(AMS.lat0, AMS.lon0 + 1, AMS);
    expect(x).toBeGreaterThan(0); // east is +x
  });

  it("longitude metres shrink by cos(lat0)", () => {
    const eq: GeoAnchor = { lat0: 0, lon0: 0 };
    const hi: GeoAnchor = { lat0: 60, lon0: 0 };
    const [xEq] = project(0, 1, eq);
    const [xHi] = project(60, 1, hi);
    expect(xHi).toBeCloseTo(xEq * Math.cos((60 * Math.PI) / 180), 3);
  });
});

describe("unproject", () => {
  it("round-trips project", () => {
    const [x, z] = project(52.4, 4.95, AMS);
    const [lat, lon] = unproject(x, z, AMS);
    expect(lat).toBeCloseTo(52.4, 9);
    expect(lon).toBeCloseTo(4.95, 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/geo/project.test.ts`
Expected: FAIL — cannot resolve `./project`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/geo/project.ts
/** Local ENU tangent-plane projection between WGS84 lon/lat and the app's
 * plan metres [x, z]. east→+x, north→+z. Flat-earth error at ≤~2 km city
 * scale is <0.1 m. Pure — no three/React. */

export interface GeoAnchor {
  lat0: number;
  lon0: number;
}

export interface LngLatBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const R = 6378137; // WGS84 equatorial radius (m)
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** bbox centre → the local-frame origin anchor. */
export function anchorOf(b: LngLatBBox): GeoAnchor {
  return { lat0: (b.south + b.north) / 2, lon0: (b.west + b.east) / 2 };
}

/** lon/lat → local plan metres [x, z]. */
export function project(lat: number, lon: number, a: GeoAnchor): [number, number] {
  const x = rad(lon - a.lon0) * Math.cos(rad(a.lat0)) * R;
  const z = rad(lat - a.lat0) * R;
  return [x, z];
}

/** Inverse of project. */
export function unproject(x: number, z: number, a: GeoAnchor): [number, number] {
  const lat = a.lat0 + deg(z / R);
  const lon = a.lon0 + deg(x / (Math.cos(rad(a.lat0)) * R));
  return [lat, lon];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/geo/project.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo/project.ts src/lib/geo/project.test.ts
git commit -m "feat(geo): ENU lon/lat ↔ local-metre projection"
```

---

### Task 2: Heightfield sampler + terrain seam (`lib/facade/terrain.ts`)

Add the optional heightfield to `Ground`, a bilinear sampler, the `groundHeightAt` guard, and a position-dependent normal. This is the whole terrain-seam widening; the byte-identical regression lives here.

**Files:**
- Modify: `src/lib/facade/terrain.ts`
- Test: `src/lib/facade/terrain.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `interface Heightfield { originX: number; originZ: number; spacing: number; cols: number; rows: number; data: number[] }`
  - `Ground` gains `hf?: Heightfield`
  - `sampleHF(hf: Heightfield, x: number, z: number): number`
  - `groundNormalAt(x: number, z: number, g: Ground): [number, number, number]`
  - `groundHeightAt` unchanged signature, now heightfield-aware.

- [ ] **Step 1: Write the failing test** (append to `src/lib/facade/terrain.test.ts`)

```ts
import {
  sampleHF,
  groundNormalAt,
  type Heightfield,
} from "./terrain";

// 3×3 ramp rising along +x: h = 10·(x/20), flat in z. spacing 10.
const RAMP: Heightfield = {
  originX: 0,
  originZ: 0,
  spacing: 10,
  cols: 3,
  rows: 3,
  data: [0, 10, 20, 0, 10, 20, 0, 10, 20],
};

describe("sampleHF", () => {
  it("is exact at grid nodes", () => {
    expect(sampleHF(RAMP, 0, 0)).toBeCloseTo(0, 9);
    expect(sampleHF(RAMP, 10, 0)).toBeCloseTo(10, 9);
    expect(sampleHF(RAMP, 20, 20)).toBeCloseTo(20, 9);
  });
  it("bilinearly interpolates between nodes", () => {
    expect(sampleHF(RAMP, 5, 0)).toBeCloseTo(5, 9);
    expect(sampleHF(RAMP, 15, 12)).toBeCloseTo(15, 9);
  });
  it("clamps to the edge outside the grid", () => {
    expect(sampleHF(RAMP, -100, 0)).toBeCloseTo(0, 9);
    expect(sampleHF(RAMP, 999, 0)).toBeCloseTo(20, 9);
  });
});

describe("groundHeightAt with a heightfield", () => {
  it("routes to the sampler when hf is present", () => {
    expect(groundHeightAt(5, 0, { slope: 0.2, azimuth: 33, hf: RAMP })).toBeCloseTo(5, 9);
  });
  it("stays plane-identical when hf is absent (byte-identical guard)", () => {
    expect(groundHeightAt(5, 0, { slope: 0, azimuth: 0 })).toBe(0);
    expect(groundHeightAt(0, 10, { slope: 0.1, azimuth: 0 })).toBeCloseTo(1, 9);
  });
});

describe("groundNormalAt", () => {
  it("is +y over a flat heightfield", () => {
    const flat: Heightfield = { ...RAMP, data: [5, 5, 5, 5, 5, 5, 5, 5, 5] };
    expect(groundNormalAt(10, 10, { slope: 0, azimuth: 0, hf: flat })).toEqual([0, 1, 0]);
  });
  it("is a unit vector that tilts toward downhill (−x) on the ramp", () => {
    const n = groundNormalAt(10, 10, { slope: 0, azimuth: 0, hf: RAMP });
    expect(Math.hypot(...n)).toBeCloseTo(1, 9);
    expect(n[0]).toBeLessThan(0); // uphill is +x ⇒ normal leans −x
    expect(n[1]).toBeGreaterThan(0.9);
  });
  it("falls back to the plane normal when hf is absent", () => {
    expect(groundNormalAt(0, 0, { slope: 0, azimuth: 0 })).toEqual([0, 1, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/facade/terrain.test.ts`
Expected: FAIL — `sampleHF`/`groundNormalAt`/`Heightfield` not exported.

- [ ] **Step 3: Write minimal implementation** (edit `src/lib/facade/terrain.ts`)

Add the `Heightfield` interface and `hf?` field near the top:

```ts
export interface Heightfield {
  /** world metres of sample [0][0] */
  originX: number;
  originZ: number;
  /** metre grid step */
  spacing: number;
  cols: number;
  rows: number;
  /** row-major heights (m), length cols·rows */
  data: number[];
}

export interface Ground {
  slope: number;
  azimuth: number;
  /** present ⇒ real terrain, overrides the plane */
  hf?: Heightfield;
}
```

Add the sampler and route `groundHeightAt` through it (replace the existing `groundHeightAt` body's first lines):

```ts
/** Bilinear sample of a heightfield at world (x, z); clamps to the edge
 * outside the grid. */
export function sampleHF(hf: Heightfield, x: number, z: number): number {
  const { originX, originZ, spacing, cols, rows, data } = hf;
  const clampTo = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  const cx = clampTo((x - originX) / spacing, cols - 1);
  const cz = clampTo((z - originZ) / spacing, rows - 1);
  const x0 = Math.floor(cx);
  const z0 = Math.floor(cz);
  const x1 = Math.min(x0 + 1, cols - 1);
  const z1 = Math.min(z0 + 1, rows - 1);
  const tx = cx - x0;
  const tz = cz - z0;
  const at = (ix: number, iz: number) => data[iz * cols + ix];
  const top = at(x0, z0) * (1 - tx) + at(x1, z0) * tx;
  const bot = at(x0, z1) * (1 - tx) + at(x1, z1) * tx;
  return top * (1 - tz) + bot * tz;
}

/** Ground height at plan (x, z). */
export function groundHeightAt(x: number, z: number, g: Ground): number {
  if (g.hf) return sampleHF(g.hf, x, z);
  if (!g.slope) return 0;
  const a = rad(g.azimuth);
  return g.slope * (x * Math.sin(a) + z * Math.cos(a));
}
```

Add the position-dependent normal (keep the existing `groundNormal` for the plane tilt):

```ts
/** Upward unit normal at world (x, z): central differences on the heightfield,
 * else the analytic plane normal. */
export function groundNormalAt(
  x: number,
  z: number,
  g: Ground,
): [number, number, number] {
  if (!g.hf) return groundNormal(g);
  const e = g.hf.spacing;
  const hx = (sampleHF(g.hf, x + e, z) - sampleHF(g.hf, x - e, z)) / (2 * e);
  const hz = (sampleHF(g.hf, x, z + e) - sampleHF(g.hf, x, z - e)) / (2 * e);
  const nx = -hx;
  const nz = -hz;
  const len = Math.hypot(nx, 1, nz);
  return [nx / len, 1 / len, nz / len];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/terrain.test.ts`
Expected: PASS — new cases green AND every pre-existing `groundHeightAt`/`levelingFor`/`groundNormal` case still green (the byte-identical guard).

- [ ] **Step 5: Commit**

```bash
git add src/lib/facade/terrain.ts src/lib/facade/terrain.test.ts
git commit -m "feat(terrain): optional heightfield behind the groundHeightAt seam"
```

---

### Task 3: DEM decode + resample (`lib/geo/dem.ts`)

Pure terrarium decode, web-mercator tile math, per-tile bilinear sampling, and resampling onto our local grid. No network here — network lives in Task 4. Keeping these pure makes the hard part testable.

**Files:**
- Create: `src/lib/geo/dem.ts`
- Test: `src/lib/geo/dem.test.ts`

**Interfaces:**
- Consumes: `GeoAnchor`, `LngLatBBox`, `project`, `unproject` (Task 1); `Heightfield` (Task 2).
- Produces:
  - `terrariumToMetres(r: number, g: number, b: number): number`
  - `lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number }` (fractional)
  - `tilesForBBox(b: LngLatBBox, z: number): { z: number; x: number; y: number }[]`
  - `interface DecodedTile { z: number; x: number; y: number; size: number; heights: number[] }`  // size×size row-major metres
  - `elevAtFromTiles(tiles: DecodedTile[], lon: number, lat: number): number`
  - `resampleToGrid(bbox: LngLatBBox, anchor: GeoAnchor, elevAt: (lon: number, lat: number) => number, maxDim?: number): Heightfield`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/geo/dem.test.ts
import { describe, it, expect } from "vitest";
import {
  terrariumToMetres,
  lonLatToTile,
  tilesForBBox,
  elevAtFromTiles,
  resampleToGrid,
  type DecodedTile,
} from "./dem";
import { anchorOf } from "./project";

describe("terrariumToMetres", () => {
  it("decodes the RGB elevation encoding", () => {
    expect(terrariumToMetres(128, 0, 0)).toBe(0); // sea level
    expect(terrariumToMetres(129, 0, 0)).toBe(256);
    expect(terrariumToMetres(128, 0, 128)).toBeCloseTo(0.5, 9);
  });
});

describe("lonLatToTile / tilesForBBox", () => {
  it("puts (0,0) at the centre tile boundary at z1", () => {
    const { x, y } = lonLatToTile(0, 0, 1);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(1, 6);
  });
  it("covers a small bbox with at least one tile", () => {
    const tiles = tilesForBBox({ west: 4.9, south: 52.36, east: 4.91, north: 52.37 }, 13);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.every((t) => t.z === 13)).toBe(true);
  });
});

describe("elevAtFromTiles", () => {
  it("bilinearly samples a single tile", () => {
    // one z13 tile covering Amsterdam, 2×2 ramp rising west→east
    const { x, y } = lonLatToTile(4.9, 52.37, 13);
    const tile: DecodedTile = {
      z: 13,
      x: Math.floor(x),
      y: Math.floor(y),
      size: 2,
      heights: [0, 10, 0, 10], // left col 0, right col 10
    };
    // sampling the tile's own west edge ≈ 0, east edge ≈ 10
    const west = elevAtFromTiles([tile], 4.9, 52.37);
    expect(west).toBeGreaterThanOrEqual(0);
    expect(west).toBeLessThan(10);
  });
});

describe("resampleToGrid", () => {
  const bbox = { west: 4.9, south: 52.36, east: 4.92, north: 52.38 };
  const anchor = anchorOf(bbox);

  it("returns a bounded grid with metadata", () => {
    const hf = resampleToGrid(bbox, anchor, () => 7, 128);
    expect(hf.cols).toBeGreaterThanOrEqual(2);
    expect(hf.rows).toBeGreaterThanOrEqual(2);
    expect(Math.max(hf.cols, hf.rows)).toBeLessThanOrEqual(128);
    expect(hf.data.length).toBe(hf.cols * hf.rows);
    expect(hf.data.every((h) => h === 7)).toBe(true); // constant sampler
    expect(hf.spacing).toBeGreaterThan(0);
  });

  it("samples the elevation function across the grid", () => {
    const hf = resampleToGrid(bbox, anchor, (lon) => lon * 1000, 32);
    expect(hf.data[0]).not.toBe(hf.data[hf.cols - 1]); // varies along +x (lon)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/geo/dem.test.ts`
Expected: FAIL — cannot resolve `./dem`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/geo/dem.ts
import type { GeoAnchor, LngLatBBox } from "./project";
import { project, unproject } from "./project";
import type { Heightfield } from "@/lib/facade/terrain";

/** Terrarium PNG RGB → metres. */
export function terrariumToMetres(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** lon/lat → fractional web-mercator tile coords at zoom z. */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Every integer tile covering the bbox at zoom z. */
export function tilesForBBox(b: LngLatBBox, z: number): { z: number; x: number; y: number }[] {
  const tl = lonLatToTile(b.west, b.north, z); // north = smaller tile-y
  const br = lonLatToTile(b.east, b.south, z);
  const x0 = Math.floor(tl.x);
  const x1 = Math.floor(br.x);
  const y0 = Math.floor(tl.y);
  const y1 = Math.floor(br.y);
  const out: { z: number; x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y });
  return out;
}

export interface DecodedTile {
  z: number;
  x: number;
  y: number;
  size: number;
  /** size×size row-major heights (m) */
  heights: number[];
}

/** Bilinear elevation at lon/lat from decoded tiles (nearest tile if the exact
 * one is missing). */
export function elevAtFromTiles(tiles: DecodedTile[], lon: number, lat: number): number {
  if (tiles.length === 0) return 0;
  const z = tiles[0].z;
  const g = lonLatToTile(lon, lat, z);
  const tx = Math.floor(g.x);
  const ty = Math.floor(g.y);
  const tile = tiles.find((t) => t.x === tx && t.y === ty) ?? tiles[0];
  const size = tile.size;
  const fx = (g.x - tx) * (size - 1);
  const fy = (g.y - ty) * (size - 1);
  const clamp = (v: number) => Math.max(0, Math.min(size - 1, v));
  const cx = clamp(fx);
  const cy = clamp(fy);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, size - 1);
  const y1 = Math.min(y0 + 1, size - 1);
  const sx = cx - x0;
  const sy = cy - y0;
  const h = (ix: number, iy: number) => tile.heights[iy * size + ix];
  const top = h(x0, y0) * (1 - sx) + h(x1, y0) * sx;
  const bot = h(x0, y1) * (1 - sx) + h(x1, y1) * sx;
  return top * (1 - sy) + bot * sy;
}

/** Build a local-frame Heightfield by sampling `elevAt(lon,lat)` on a square
 * grid spanning the bbox. Grid step chosen so max(cols,rows) ≤ maxDim. */
export function resampleToGrid(
  bbox: LngLatBBox,
  anchor: GeoAnchor,
  elevAt: (lon: number, lat: number) => number,
  maxDim = 128,
): Heightfield {
  const [xW, zS] = project(bbox.south, bbox.west, anchor);
  const [xE, zN] = project(bbox.north, bbox.east, anchor);
  const width = xE - xW;
  const height = zN - zS;
  const spacing = Math.max(width, height) / (maxDim - 1);
  const cols = Math.max(2, Math.ceil(width / spacing) + 1);
  const rows = Math.max(2, Math.ceil(height / spacing) + 1);
  const data: number[] = new Array(cols * rows);
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const [lat, lon] = unproject(xW + ix * spacing, zS + iz * spacing, anchor);
      data[iz * cols + ix] = elevAt(lon, lat);
    }
  }
  return { originX: xW, originZ: zS, spacing, cols, rows, data };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/geo/dem.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo/dem.ts src/lib/geo/dem.test.ts
git commit -m "feat(geo): terrarium decode + tile math + local resample (pure)"
```

---

### Task 4: Terrain provider + `POST /api/terrain`

Wire the pure DEM helpers to the open source (AWS Terrain Tiles) behind the source-agnostic `TerrainProvider` and expose a route handler. The route is the only place that knows the DEM source (Esri implements the same interface later).

**Files:**
- Create: `src/lib/geo/terrainProvider.ts`
- Create: `src/app/api/terrain/route.ts`
- Modify: `package.json` (add `pngjs` + `@types/pngjs`)
- Test: `src/lib/geo/terrainProvider.test.ts` (pure request-validation + a mock-provider path)

**Interfaces:**
- Consumes: `LngLatBBox`, `GeoAnchor` (Task 1); `Heightfield` (Task 2); `tilesForBBox`, `terrariumToMetres`, `elevAtFromTiles`, `resampleToGrid`, `DecodedTile` (Task 3).
- Produces:
  - `interface TerrainProvider { fetchHeightfield(bbox: LngLatBBox, anchor: GeoAnchor): Promise<Heightfield> }`
  - `class OpenTerrainProvider implements TerrainProvider`
  - `parseTerrainRequest(body: unknown): { bbox: LngLatBBox; anchor: GeoAnchor } | null` (exported for the route + test)
  - Route: `POST /api/terrain` → `{ heightfield: Heightfield }` (200) | `{ error }` (400/500)

- [ ] **Step 1: Read the Next.js route-handler doc**

Run: `ls node_modules/next/dist/docs/ && grep -ril "route handler\|route.ts\|NextResponse" node_modules/next/dist/docs/ | head`
Read the matching doc. Confirm the `export async function POST` + `NextResponse.json` pattern used in `src/app/api/facade-prompt/route.ts` is still current for 16.2.1. Heed any deprecation notice.

- [ ] **Step 2: Add the PNG decoder dependency**

Run: `npm install pngjs && npm install -D @types/pngjs`
Expected: `pngjs` in `dependencies`, `@types/pngjs` in `devDependencies`.

- [ ] **Step 3: Write the failing test** (request validation — the pure seam of the route)

```ts
// src/lib/geo/terrainProvider.test.ts
import { describe, it, expect } from "vitest";
import { parseTerrainRequest } from "./terrainProvider";

describe("parseTerrainRequest", () => {
  const good = {
    bbox: { west: 4.9, south: 52.36, east: 4.92, north: 52.38 },
    anchor: { lat0: 52.37, lon0: 4.91 },
  };
  it("accepts a well-formed body", () => {
    expect(parseTerrainRequest(good)).toEqual(good);
  });
  it("rejects a missing bbox", () => {
    expect(parseTerrainRequest({ anchor: good.anchor })).toBeNull();
  });
  it("rejects non-finite coordinates", () => {
    expect(
      parseTerrainRequest({ ...good, bbox: { ...good.bbox, west: NaN } }),
    ).toBeNull();
  });
  it("rejects a non-object", () => {
    expect(parseTerrainRequest("nope")).toBeNull();
    expect(parseTerrainRequest(null)).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/lib/geo/terrainProvider.test.ts`
Expected: FAIL — cannot resolve `./terrainProvider`.

- [ ] **Step 5: Write the provider**

```ts
// src/lib/geo/terrainProvider.ts
import { PNG } from "pngjs";
import type { GeoAnchor, LngLatBBox } from "./project";
import type { Heightfield } from "@/lib/facade/terrain";
import {
  tilesForBBox,
  terrariumToMetres,
  elevAtFromTiles,
  resampleToGrid,
  type DecodedTile,
} from "./dem";

export interface TerrainProvider {
  fetchHeightfield(bbox: LngLatBBox, anchor: GeoAnchor): Promise<Heightfield>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validate an untrusted request body. Exported so the route and its test share
 * one definition. */
export function parseTerrainRequest(
  body: unknown,
): { bbox: LngLatBBox; anchor: GeoAnchor } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = (body as { bbox?: unknown }).bbox as Partial<LngLatBBox> | undefined;
  const a = (body as { anchor?: unknown }).anchor as Partial<GeoAnchor> | undefined;
  if (!b || !a) return null;
  if (!isNum(b.west) || !isNum(b.south) || !isNum(b.east) || !isNum(b.north)) return null;
  if (!isNum(a.lat0) || !isNum(a.lon0)) return null;
  return {
    bbox: { west: b.west, south: b.south, east: b.east, north: b.north },
    anchor: { lat0: a.lat0, lon0: a.lon0 },
  };
}

const ZOOM = 13; // ~19 m/px at mid-latitudes — a few tiles cover a city bbox
const TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

async function decodeTile(z: number, x: number, y: number): Promise<DecodedTile> {
  const res = await fetch(TILE_URL(z, x, y));
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const png = PNG.sync.read(buf);
  const size = png.width; // terrarium tiles are square (256)
  const heights: number[] = new Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4; // RGBA
    heights[i] = terrariumToMetres(png.data[o], png.data[o + 1], png.data[o + 2]);
  }
  return { z, x, y, size, heights };
}

export class OpenTerrainProvider implements TerrainProvider {
  async fetchHeightfield(bbox: LngLatBBox, anchor: GeoAnchor): Promise<Heightfield> {
    const coords = tilesForBBox(bbox, ZOOM);
    const tiles = await Promise.all(coords.map((t) => decodeTile(t.z, t.x, t.y)));
    return resampleToGrid(bbox, anchor, (lon, lat) => elevAtFromTiles(tiles, lon, lat));
  }
}
```

- [ ] **Step 6: Write the route handler**

```ts
// src/app/api/terrain/route.ts
import { NextRequest, NextResponse } from "next/server";
import { OpenTerrainProvider, parseTerrainRequest } from "@/lib/geo/terrainProvider";

export const runtime = "nodejs";

const provider = new OpenTerrainProvider();

export async function POST(req: NextRequest) {
  try {
    const parsed = parseTerrainRequest(await req.json());
    if (!parsed) {
      return NextResponse.json({ error: "Bad request: need { bbox, anchor }." }, { status: 400 });
    }
    const heightfield = await provider.fetchHeightfield(parsed.bbox, parsed.anchor);
    return NextResponse.json({ heightfield });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/terrain]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 7: Run the unit test to verify it passes**

Run: `npx vitest run src/lib/geo/terrainProvider.test.ts`
Expected: PASS.

- [ ] **Step 8: Smoke-test the live route**

Run (in one terminal `npm run dev`, then):
```bash
curl -s -X POST http://localhost:3000/api/terrain \
  -H 'content-type: application/json' \
  -d '{"bbox":{"west":4.88,"south":52.36,"east":4.90,"north":52.38},"anchor":{"lat0":52.37,"lon0":4.89}}' \
  | head -c 300
```
Expected: JSON beginning `{"heightfield":{"originX":...,"spacing":...,"cols":...` with a `data` array. (Amsterdam is near sea level, so heights hover around 0 — a non-flat inland bbox shows variation.)

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/lib/geo/terrainProvider.ts src/lib/geo/terrainProvider.test.ts src/app/api/terrain/route.ts
git commit -m "feat(api): /api/terrain — open DEM provider behind TerrainProvider"
```

---

### Task 5: Displaced ground mesh (`SceneContents.tsx`)

Render real terrain: when `ground.hf` is present, the ground becomes a displaced grid and the rigid tilt + drawing grid + contact shadows switch off. Rendering is verified visually (project convention).

**Files:**
- Modify: `src/components/facade/SceneContents.tsx` (`useGroundGeometry` at `:113`, `groundQuat` at `:447`, the ground `<mesh>` at `:754`, the grid group `:769`, `ContactShadows` `:807`)

**Interfaces:**
- Consumes: `Ground`, `groundHeightAt`, `groundNormal` (Task 2); `GROUND_HALF` (existing).
- Produces: no new exports — internal rendering behavior only.

- [ ] **Step 1: Add the displaced-geometry builder** (new module-scope helper in `SceneContents.tsx`, next to `useGroundGeometry`)

```ts
import { GROUND_HALF } from "@/lib/facade/clip";
import { groundHeightAt, groundNormal, type Ground } from "@/lib/facade/terrain";

/** A world-oriented (XZ, +Y up) plane over ±GROUND_HALF, each vertex displaced
 * to the real ground height. Resolution tracks the heightfield spacing (the
 * bbox gets detail; the clamp-to-edge far field stays coarse & flat). */
function displacedGroundGeometry(ground: Ground): THREE.BufferGeometry {
  const seg = Math.max(64, Math.min(400, Math.round((2 * GROUND_HALF) / ground.hf!.spacing)));
  const g = new THREE.PlaneGeometry(2 * GROUND_HALF, 2 * GROUND_HALF, seg, seg);
  g.rotateX(-Math.PI / 2); // bake lie-flat: geometry now spans XZ, +Y up
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, groundHeightAt(pos.getX(i), pos.getZ(i), ground));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
```

- [ ] **Step 2: Branch `useGroundGeometry` on the heightfield** (replace the hook at `:113`)

```ts
function useGroundGeometry(streetNetwork: StreetNetwork | undefined, ground: Ground) {
  const geo = useMemo(() => {
    if (ground.hf) return displacedGroundGeometry(ground);
    const shape = new THREE.Shape([
      new THREE.Vector2(-GROUND_HALF, -GROUND_HALF),
      new THREE.Vector2(GROUND_HALF, -GROUND_HALF),
      new THREE.Vector2(GROUND_HALF, GROUND_HALF),
      new THREE.Vector2(-GROUND_HALF, GROUND_HALF),
    ]);
    for (const s of streetNetwork?.streets ?? []) {
      if (s.type !== "canal") continue;
      const cl = filletCentreline(s.points, minRadiusOf(s), 8, s.closed);
      const outline = canalHoleOutline(cl, effectiveWidth(s));
      if (!outline) continue;
      shape.holes.push(
        new THREE.Path(outline.map(([x, z]) => new THREE.Vector2(x, -z))),
      );
    }
    return new THREE.ShapeGeometry(shape);
  }, [streetNetwork, ground.hf]);
  useEffect(() => () => geo.dispose(), [geo]);
  return geo;
}
```

Update its call site to pass `ground` (at `:446`): `const groundGeo = useGroundGeometry(streetNetwork, ground);`

- [ ] **Step 3: Make the tilt identity + the mesh un-rotated under a heightfield**

`groundQuat` (at `:447`):
```ts
const groundQuat = useMemo(() => {
  const q = new THREE.Quaternion();
  if (ground.hf) return q; // identity — displacement IS the terrain
  q.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(...groundNormal(ground)),
  );
  return q;
}, [ground]);
```

The ground `<mesh>` (at `:754`) — the displaced geometry already lies in XZ, so drop the extra rotation for the hf case:
```tsx
<mesh
  rotation={ground.hf ? [0, 0, 0] : [-Math.PI / 2, 0, 0]}
  receiveShadow
  geometry={groundGeo}
>
```

- [ ] **Step 4: Suppress the flat drawing grid + contact shadows over terrain**

Wrap the grid group (`:769`) so it renders only without a heightfield:
```tsx
{!ground.hf && (
  <group rotation={[0, ((gridAngleDeg ?? 0) * Math.PI) / 180, 0]}>
    {/* …existing NodeGrid / Grid ternary unchanged… */}
  </group>
)}
```
And the `ContactShadows` condition (`:807`):
```tsx
{!isWebGPUPath() && !ground.hf && (
  <ContactShadows /* …unchanged props… */ />
)}
```

- [ ] **Step 5: Typecheck + full test run (no regressions)**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all vitest suites pass (rendering isn't unit-tested, but nothing pure regressed).

- [ ] **Step 6: Visual check**

Run `npm run dev`, open `/facade`. Temporarily set a synthetic heightfield to verify rendering before the picker exists — in the browser devtools console is not enough (state is closed over), so instead seed it in code TEMPORARILY: in `page.tsx` initial `ground` state, set `useState<Ground>({ slope: 0, azimuth: 0, hf: { originX: -100, originZ: -100, spacing: 20, cols: 11, rows: 11, data: Array.from({length:121},(_,i)=> (i%11)*2) } })`. Confirm:
  - the ground reads as a tilted/rippled surface (not a flat quad),
  - a drawn block's basement grows to meet the real ground,
  - the infinite drawing grid and contact-shadow blob are gone,
  - removing the seed (`hf` back to undefined) returns the exact old flat ground.
Then REVERT the temporary seed.

- [ ] **Step 7: Commit**

```bash
git add src/components/facade/SceneContents.tsx
git commit -m "feat(scene): displaced ground mesh when a heightfield is present"
```

---

### Task 6: MapLibre place picker (`components/facade/PlacePicker.tsx`)

A modal with a tokenless slippy map and a fixed centre framing box. "Load this area" reads the box corners as a bbox. Pure UI + a `readBBox` helper; visually verified.

**Files:**
- Create: `src/components/facade/PlacePicker.tsx`
- Modify: `package.json` (add `maplibre-gl`)

**Interfaces:**
- Consumes: `LngLatBBox` (Task 1).
- Produces: `export default function PlacePicker(props: { onLoad: (bbox: LngLatBBox) => void; onCancel: () => void; loading: boolean; error: string | null }): JSX.Element`

- [ ] **Step 1: Add the map dependency**

Run: `npm install maplibre-gl`
Expected: `maplibre-gl` in `dependencies`.

- [ ] **Step 2: Write the component**

```tsx
// src/components/facade/PlacePicker.tsx
"use client";
import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LngLatBBox } from "@/lib/geo/project";

/** Modal map picker. The user frames an area inside a fixed centre box (the
 * middle 60% of the map) and loads it; readBBox unprojects the box corners. */
export default function PlacePicker({
  onLoad,
  onCancel,
  loading,
  error,
}: {
  onLoad: (bbox: LngLatBBox) => void;
  onCancel: () => void;
  loading: boolean;
  error: string | null;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  // maplibre's Map type isn't imported statically (dynamic import below); the
  // ref is intentionally loosely typed.
  const mapRef = useRef<{ unproject: (p: [number, number]) => { lng: number; lat: number }; remove: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: { remove: () => void } | null = null;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !mapEl.current) return;
      const m = new maplibregl.Map({
        container: mapEl.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [4.9041, 52.3676], // Amsterdam
        zoom: 14,
      });
      mapRef.current = m as unknown as typeof mapRef.current;
      map = m;
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  const readBBox = (): LngLatBBox | null => {
    const map = mapRef.current;
    const el = mapEl.current;
    if (!map || !el) return null;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const mx = w * 0.2;
    const my = h * 0.2;
    const nw = map.unproject([mx, my]);
    const se = map.unproject([w - mx, h - my]);
    return { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat };
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[720px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Load a place</span>
          <button
            type="button"
            onClick={onCancel}
            className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
          >
            Cancel
          </button>
        </div>
        <div className="relative h-[420px] w-full overflow-hidden rounded">
          <div ref={mapEl} className="absolute inset-0" />
          {/* fixed centre framing box (middle 60%) */}
          <div className="pointer-events-none absolute inset-[20%] border-2 border-[var(--accent)] rounded-sm" />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-[var(--muted)]">
            Pan &amp; zoom so the box frames your area.
          </span>
          <div className="flex items-center gap-2">
            {error && (
              <span className="text-[11px] text-red-400" role="alert">
                {error}
              </span>
            )}
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                const bbox = readBBox();
                if (bbox) onLoad(bbox);
              }}
              className="text-[11px] px-3 py-1 rounded border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-50"
            >
              {loading ? "Loading terrain…" : "Load this area"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/facade/PlacePicker.tsx
git commit -m "feat(facade): MapLibre place picker modal (bbox framing)"
```

---

### Task 7: Wire picker + anchor into the page and save/load

Hook the picker to `/api/terrain`, store the `anchor`, add the header buttons, hide the manual Topography controls while terrain is loaded, and persist `hf` + `anchor` (defensively) across save/load — version unchanged.

**Files:**
- Modify: `src/app/facade/page.tsx` (state near `:250-261`, header `:1193-1220`, save `:323-344`, autosave `:388-401`, load `:305-320`, `SceneContents`/`FacadeControls` props)
- Modify: `src/lib/facade/document.ts` (`SceneState` `:18`, `FacadeDocument` `:29`, `serializeScene` `:44`, `deserializeScene` return `:216`)
- Modify: `src/components/facade/FacadeControls.tsx` (gate the Topography `Section`)
- Test: `src/lib/facade/document.test.ts` (round-trip `hf` + `anchor`; old-save default)

**Interfaces:**
- Consumes: `GeoAnchor`, `LngLatBBox`, `anchorOf` (Task 1); `Heightfield`, `Ground` (Task 2); `PlacePicker` (Task 6); `/api/terrain` (Task 4).
- Produces:
  - `SceneState` gains `anchor: GeoAnchor | null`; `FacadeDocument` gains `anchor?: GeoAnchor`.
  - `document.ts` exports `validHeightfield(v: unknown): v is Heightfield` (defensive load guard).

- [ ] **Step 1: Write the failing document test** (append to `src/lib/facade/document.test.ts`)

```ts
import { serializeScene, deserializeScene } from "./document";
import type { Heightfield } from "./terrain";

const HF: Heightfield = {
  originX: -100, originZ: -100, spacing: 20, cols: 3, rows: 3,
  data: [0, 1, 2, 3, 4, 5, 6, 7, 8],
};

function baseScene() {
  return {
    blocks: [],
    cornerChoices: new Map(),
    ground: { slope: 0, azimuth: 0 },
    streetWidth: 14,
    maxCornerAngle: 60,
    streetNetwork: { streets: [], roundabouts: [], squares: [] },
    anchor: null,
  };
}

describe("document terrain round-trip", () => {
  it("round-trips a heightfield + anchor", () => {
    const scene = { ...baseScene(), ground: { slope: 0, azimuth: 0, hf: HF }, anchor: { lat0: 52.37, lon0: 4.91 } };
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.ground.hf).toEqual(HF);
    expect(back.scene.anchor).toEqual({ lat0: 52.37, lon0: 4.91 });
  });

  it("an old save with no hf/anchor loads flat (byte-identical)", () => {
    const doc = { version: 1, blocks: [], cornerChoices: [], ground: { slope: 0, azimuth: 0 }, streetWidth: 14, maxCornerAngle: 60, streetNetwork: { streets: [], roundabouts: [], squares: [] } };
    const back = deserializeScene(doc);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.ground.hf).toBeUndefined();
    expect(back.scene.anchor).toBeNull();
  });

  it("drops a malformed heightfield rather than crashing", () => {
    const doc = { version: 1, blocks: [], cornerChoices: [], ground: { slope: 0, azimuth: 0, hf: { cols: 3 } }, streetWidth: 14, maxCornerAngle: 60, streetNetwork: { streets: [], roundabouts: [], squares: [] } };
    const back = deserializeScene(doc);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.ground.hf).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/facade/document.test.ts`
Expected: FAIL — `anchor` missing from `SceneState`; malformed hf not stripped.

- [ ] **Step 3: Extend the document types + serializer**

In `src/lib/facade/document.ts`, import the anchor type and heightfield type:
```ts
import type { GeoAnchor } from "@/lib/geo/project";
import type { Ground, Heightfield } from "./terrain";
```
Add `anchor` to `SceneState` (`:18`) and `FacadeDocument` (`:29`):
```ts
// SceneState:
  anchor: GeoAnchor | null;
// FacadeDocument:
  anchor?: GeoAnchor;
```
In `serializeScene` (`:44`) add:
```ts
    anchor: s.anchor ?? undefined,
```

- [ ] **Step 4: Add the defensive heightfield guard + strip/parse on load**

Add near the other validators in `document.ts`:
```ts
export function validHeightfield(v: unknown): v is Heightfield {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  const nums = ["originX", "originZ", "spacing", "cols", "rows"];
  if (!nums.every((k) => isFiniteNumber(h[k]))) return false;
  return (
    Array.isArray(h.data) &&
    h.data.length === (h.cols as number) * (h.rows as number) &&
    (h.data as unknown[]).every((n) => isFiniteNumber(n))
  );
}
```
Change the `ground` construction (`:182-188`) so a present-but-malformed `hf` is stripped rather than trusted:
```ts
  const rawGround = doc.ground as (Ground & { hf?: unknown }) | undefined;
  const ground: Ground =
    typeof rawGround === "object" &&
    rawGround !== null &&
    isFiniteNumber(rawGround.slope) &&
    isFiniteNumber(rawGround.azimuth)
      ? {
          slope: rawGround.slope,
          azimuth: rawGround.azimuth,
          ...(validHeightfield(rawGround.hf) ? { hf: rawGround.hf } : {}),
        }
      : DEFAULT_GROUND;
```
Parse `anchor` and add it to the returned scene (`:216`):
```ts
  const rawAnchor = doc.anchor as Partial<GeoAnchor> | undefined;
  const anchor: GeoAnchor | null =
    rawAnchor && isFiniteNumber(rawAnchor.lat0) && isFiniteNumber(rawAnchor.lon0)
      ? { lat0: rawAnchor.lat0, lon0: rawAnchor.lon0 }
      : null;
  // …in the returned scene object, add:  anchor,
```

- [ ] **Step 5: Run the document test to verify it passes**

Run: `npx vitest run src/lib/facade/document.test.ts`
Expected: PASS.

- [ ] **Step 6: Add page state + the terrain load flow** (`src/app/facade/page.tsx`)

Imports:
```ts
import { anchorOf, type GeoAnchor, type LngLatBBox } from "@/lib/geo/project";
import type { Heightfield } from "@/lib/facade/terrain";
const PlacePicker = dynamic(() => import("@/components/facade/PlacePicker"), { ssr: false });
```
State (near `:260`):
```ts
  const [anchor, setAnchor] = useState<GeoAnchor | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [terrainLoading, setTerrainLoading] = useState(false);
  const [terrainError, setTerrainError] = useState<string | null>(null);
```
Load handler (near the Save/Load callbacks, ~`:300`):
```ts
  const handleLoadPlace = useCallback(async (bbox: LngLatBBox) => {
    setTerrainError(null);
    setTerrainLoading(true);
    try {
      const a = anchorOf(bbox);
      const res = await fetch("/api/terrain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bbox, anchor: a }),
      });
      const json = (await res.json()) as { heightfield?: Heightfield; error?: string };
      if (!res.ok || !json.heightfield) throw new Error(json.error ?? `HTTP ${res.status}`);
      setGround((g) => ({ ...g, hf: json.heightfield }));
      setAnchor(a);
      setPickerOpen(false);
    } catch (e) {
      setTerrainError(e instanceof Error ? e.message : String(e));
    } finally {
      setTerrainLoading(false);
    }
  }, []);

  const handleClearTerrain = useCallback(() => {
    setGround((g) => ({ slope: g.slope, azimuth: g.azimuth })); // drop hf
    setAnchor(null);
  }, []);
```
Thread `anchor` through save (`:323-344`), autosave (`:388-401`), and load (`:305-320`): add `anchor` to each `serializeScene({ … })` payload, and `setAnchor(s.anchor)` in the load handler alongside `setGround(s.ground)`.

- [ ] **Step 7: Add the header buttons + mount the picker**

After the Load `<input>` block (~`:1214`) add:
```tsx
          <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
          >
            Load place
          </button>
          {ground.hf && (
            <button
              type="button"
              onClick={handleClearTerrain}
              className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
            >
              Clear terrain
            </button>
          )}
```
Near the end of the component's JSX (with the other overlays), mount:
```tsx
      {pickerOpen && (
        <PlacePicker
          onLoad={handleLoadPlace}
          onCancel={() => setPickerOpen(false)}
          loading={terrainLoading}
          error={terrainError}
        />
      )}
```

- [ ] **Step 8: Hide the manual Topography controls while terrain is loaded**

In `src/components/facade/FacadeControls.tsx`, find the global **Topography** `Section` (the Slope + Azimuth sliders). Add a prop `terrainImported?: boolean` to the controls component and wrap that Section:
```tsx
{!terrainImported && (
  /* …existing Topography Section (Slope + Azimuth sliders)… */
)}
```
Pass it from `page.tsx` where `FacadeControls` is rendered: `terrainImported={!!ground.hf}`.

- [ ] **Step 9: Typecheck + full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all suites pass.

- [ ] **Step 10: End-to-end visual check**

`npm run dev` → `/facade`:
  - **Load place** opens the map modal; pan to a hilly city (e.g. search-free: drag to a place with relief), **Load this area** → the ground becomes that terrain; the Topography sliders disappear.
  - Draw a block on the slope — it levels + grows a basement to the real ground.
  - **Save** → reload the page → autosave restores the same terrain; **Load** the saved file in a fresh tab → same place.
  - **Clear terrain** → returns to the flat/manual ground and the Topography sliders reappear (byte-identical).

- [ ] **Step 11: Commit**

```bash
git add src/app/facade/page.tsx src/lib/facade/document.ts src/lib/facade/document.test.ts src/components/facade/FacadeControls.tsx
git commit -m "feat(facade): load real terrain via the place picker; persist hf + anchor"
```

---

## Self-Review

**Spec coverage** — every spec decision maps to a task:

| Spec item | Task |
|---|---|
| Optional `hf` on `Ground`; `groundHeightAt` guard; byte-identical | 2 |
| `Heightfield` model + bilinear sampler + clamp-to-edge | 2 |
| ENU projection `east→+x north→+z`, R=6378137 | 1 |
| Displaced mesh; `groundQuat` identity; grid/shadows off | 5 |
| `groundNormalAt` (central differences), isolated | 2 |
| Route handler `POST /api/terrain`; token stays server-side | 4 |
| Open AWS Terrain Tiles + terrarium decode | 3, 4 |
| MapLibre bbox picker + "Load this area" + "Clear terrain" | 6, 7 |
| Stored `anchor {lat0,lon0}` for M2/M3 | 7 |
| Manual topography overridden while terrain loaded | 7 |
| `SCENE_VERSION` stays 1; additive optionals; old saves default | 7 |
| Grid cap ≤128² | 3 (`resampleToGrid maxDim=128`) |
| Testing (project/sampler/normal/decode/round-trip/visual) | 1–7 |

**Placeholder scan:** No "TBD/handle errors/similar-to". The two intentionally-descriptive steps (5.6 visual seed, 7.8 locate the Topography Section) name concrete edits; every code step ships complete code. The one place I could not quote exact line numbers — the Topography `Section` in `FacadeControls.tsx` — is because I did not open that file; the instruction ("wrap the Slope + Azimuth Section in `{!terrainImported && …}`") is unambiguous. **Implementer note:** open `FacadeControls.tsx`, confirm the Section's exact JSX before wrapping.

**Type consistency:** `Heightfield`, `GeoAnchor`, `LngLatBBox`, `DecodedTile`, `TerrainProvider`, `parseTerrainRequest`, `validHeightfield`, `anchorOf`, `resampleToGrid`, `elevAtFromTiles`, `sampleHF`, `groundNormalAt` all defined once and consumed with matching signatures. `/api/terrain` returns `{ heightfield }` in Task 4 and is read as `json.heightfield` in Task 7 — consistent.

**Scope:** Single milestone (terrain). M2–M4 stay in the spec's roadmap, no tasks here.
