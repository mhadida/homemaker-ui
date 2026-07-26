# M4 — Promote a Real Footprint to an Editable Lot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click an imported real building and turn it into an editable parametric lot whose boundary is the true parcel polygon, never a bounding box.

**Architecture:** Two new pure modules. `src/lib/geo/parcel.ts` reduces an arbitrary footprint polygon to four numbers — frontage line, facing, width, depth — by grouping edges into near-collinear chains and scoring them by length and street proximity. `src/lib/facade/promote.ts` turns that fit into an ordinary `FacadeBlock` with one generated lot. The existing rectangular-box facade engine is **not modified**; the real polygon is stored on the block and drawn on the ground as the lot boundary.

**Tech Stack:** TypeScript, Next.js 16.2.1 App Router, React 19, react-three-fiber + three (WebGPU by default), vitest, Tailwind v4, ESLint 9 flat config.

## Global Constraints

- **`SCENE_VERSION` stays `1`.** `deserializeScene` rejects a version mismatch, so a bump would reject every existing beta save. All new document fields are additive and optional.
- **No `parcel` field → byte-identical to today.** Every new code path is gated on `block.parcel` being present.
- **Every task runs all three gates before commit:** `npx tsc --noEmit`, `npx eslint <changed files>`, `npm test`. ESLint is not optional — a `react-hooks/preserve-manual-memoization` error once slipped through both `tsc` and `vitest` in this repo.
- **Pure modules import no `three` and no React.** `src/lib/geo/parcel.ts` additionally imports nothing from `src/lib/facade` (dependency runs `facade → geo`, never both ways).
- **Never mount an empty `NodeLine`.** Mounting a `Line2` with empty geometry compiles invalid WGSL that stays cached. Guard on point count before rendering.
- **Local metres are `[x, z]`** (`east→+x`, `north→+z`). Plan-space `Vec2` is always `[x, z]`, never `[x, y]`.
- **Real OSM ways wind both CW and CCW.** Never assume a winding; derive it per polygon from the signed area.
- Spec: `docs/superpowers/specs/2026-07-26-promote-footprint-design.md`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/geo/parcel.ts` | **create** | Pure polygon geometry: signed area, near-collinear edge chains, frontage fit. |
| `src/lib/geo/parcel.test.ts` | **create** | Unit tests + the 1,585-building fixture guard. |
| `src/lib/facade/promote.ts` | **create** | `promoteParcel`, `subdivideBlock`, `mergeBlock`. |
| `src/lib/facade/promote.test.ts` | **create** | Unit tests for the above. |
| `src/lib/facade/blocks.ts` | modify | `FacadeBlock.parcel` field + `applyParcelDepth` helper. |
| `src/lib/facade/generate.ts` | modify | `rerollBlock` / `refit` preserve parcel depth. |
| `src/lib/facade/document.ts` | modify | Validate + drop a malformed `parcel` on load. |
| `src/components/facade/SceneContents.tsx` | modify | `ParcelOutline` — draped plot boundary. |
| `src/components/facade/ContextBuildings.tsx` | modify | Select (not demolish) on click; selected highlight. |
| `src/components/facade/FacadeViewer.tsx` | modify | Thread `onSelectContextBuilding` through the `selectMode` gate. |
| `src/components/facade/FacadeControls.tsx` | modify | `ContextBuildingPanel`; Subdivide / Merge action. |
| `src/app/facade/page.tsx` | modify | Selection state, promote handler, derived `promotedSources`. |
| `AGENTS.md` | modify | Document M4. |

---

### Task 1: Polygon primitives — `parcelArea` and `edgeChains`

**Files:**
- Create: `src/lib/geo/parcel.ts`
- Test: `src/lib/geo/parcel.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Vec2 = [number, number]`; `interface Chain { a: Vec2; b: Vec2; idx: number[] }`; `parcelArea(outline: Vec2[]): number`; `signedArea(outline: Vec2[]): number`; `edgeChains(outline: Vec2[], toleranceDeg?: number): Chain[]`; `CHAIN_TOLERANCE_DEG: 20`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/geo/parcel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Vec2 } from "./parcel";
import { CHAIN_TOLERANCE_DEG, edgeChains, parcelArea, signedArea } from "./parcel";

// A unit square wound CCW by the (x, z) shoelace convention.
const SQUARE: Vec2[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe("parcelArea", () => {
  it("measures a unit square", () => {
    expect(parcelArea(SQUARE)).toBeCloseTo(1, 9);
  });

  it("is winding-independent", () => {
    expect(parcelArea([...SQUARE].reverse())).toBeCloseTo(1, 9);
  });

  it("measures a non-convex L correctly (12 - 4 = 8)", () => {
    const L: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [2, 1],
      [2, 3],
      [0, 3],
    ];
    expect(parcelArea(L)).toBeCloseTo(8, 9);
  });

  it("is zero for a degenerate outline", () => {
    expect(parcelArea([[0, 0], [1, 0], [2, 0]])).toBeCloseTo(0, 9);
  });
});

describe("signedArea", () => {
  it("is positive for CCW and negative for CW", () => {
    expect(signedArea(SQUARE)).toBeGreaterThan(0);
    expect(signedArea([...SQUARE].reverse())).toBeLessThan(0);
  });
});

describe("edgeChains", () => {
  it("gives one chain per side of a rectangle", () => {
    expect(edgeChains(SQUARE)).toHaveLength(4);
  });

  it("merges a collinear midpoint back into its side", () => {
    // Same square, but the bottom edge is split by an extra vertex.
    const split: Vec2[] = [[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1]];
    const chains = edgeChains(split);
    expect(chains).toHaveLength(4);
    const bottom = chains.find((c) => c.idx.length === 2);
    expect(bottom).toBeDefined();
    expect(bottom!.a).toEqual([0, 0]);
    expect(bottom!.b).toEqual([1, 0]);
  });

  it("gives six chains for an L-shape", () => {
    const L: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [2, 1],
      [2, 3],
      [0, 3],
    ];
    expect(edgeChains(L)).toHaveLength(6);
  });

  it("merges just inside the tolerance and splits just outside it", () => {
    const at = (deg: number): Vec2[] => {
      const r = (deg * Math.PI) / 180;
      // Two edges meeting at `deg` of turn, closed by a return leg.
      return [
        [0, 0],
        [10, 0],
        [10 + 10 * Math.cos(r), 10 * Math.sin(r)],
        [5, -8],
      ];
    };
    const inside = edgeChains(at(CHAIN_TOLERANCE_DEG - 1));
    const outside = edgeChains(at(CHAIN_TOLERANCE_DEG + 1));
    expect(outside.length).toBeGreaterThan(inside.length);
  });

  it("gives the same chain count for both windings", () => {
    const L: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [2, 1],
      [2, 3],
      [0, 3],
    ];
    expect(edgeChains([...L].reverse())).toHaveLength(edgeChains(L).length);
  });

  it("returns one chain per edge for a smooth ring with no corner", () => {
    // A 36-gon turns 10 degrees at every vertex — inside the 20 degree
    // tolerance everywhere, so there is no natural break to start from.
    const ring: Vec2[] = Array.from({ length: 36 }, (_, i) => {
      const t = (i / 36) * Math.PI * 2;
      return [Math.cos(t) * 10, Math.sin(t) * 10] as Vec2;
    });
    const chains = edgeChains(ring);
    expect(chains).toHaveLength(36);
    // Critically, none of them is a zero-length wrap-around.
    for (const c of chains) {
      expect(Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1])).toBeGreaterThan(0.1);
    }
  });

  it("returns nothing for fewer than three vertices", () => {
    expect(edgeChains([[0, 0], [1, 0]])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/geo/parcel.test.ts`
Expected: FAIL — `Failed to resolve import "./parcel"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/geo/parcel.ts`:

```ts
/** Real parcel geometry (M4): reduce an arbitrary imported footprint polygon
 * to the four numbers the block engine needs — frontage line, facing, width
 * and depth.
 *
 * Pure: no three, no React, no network, and NOTHING from `@/lib/facade`, so
 * the dependency runs `facade -> geo` and never both ways. In particular the
 * massing-depth clamps live in `facade/layout.ts` and are applied by
 * `facade/promote.ts`, not here.
 *
 * Spec: docs/superpowers/specs/2026-07-26-promote-footprint-design.md */

export type Vec2 = [number, number];

/** A maximal run of consecutive, near-collinear polygon edges. Real
 * footprints have a median of 7 vertices and their longest single edge is
 * only ~31% of the perimeter, so a frontage is a CHAIN of short edges — never
 * one edge. */
export interface Chain {
  /** First vertex of the run. */
  a: Vec2;
  /** The vertex AFTER the run's last edge. */
  b: Vec2;
  /** Source edge indices, in ring order. */
  idx: number[];
}

/** Consecutive edges whose directions differ by less than this merge into one
 * chain. 20 degrees keeps a gently-curved canal frontage together while still
 * breaking at a real corner. */
export const CHAIN_TOLERANCE_DEG = 20;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (v: Vec2): number => Math.hypot(v[0], v[1]);
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];

function unit(v: Vec2): Vec2 {
  const l = len(v);
  return l > 1e-9 ? [v[0] / l, v[1] / l] : [0, 0];
}

/** Shoelace area. Positive when the ring winds counter-clockwise in the
 * (x, z) plane; the sign is the ONLY reliable way to know which side of an
 * edge is outside, because real OSM ways wind both ways. */
export function signedArea(outline: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x0, z0] = outline[i];
    const [x1, z1] = outline[(i + 1) % outline.length];
    s += x0 * z1 - x1 * z0;
  }
  return s / 2;
}

/** Plot area in square metres, winding-independent. */
export function parcelArea(outline: Vec2[]): number {
  return Math.abs(signedArea(outline));
}

/** Group the ring's edges into maximal near-collinear runs. */
export function edgeChains(
  outline: Vec2[],
  toleranceDeg: number = CHAIN_TOLERANCE_DEG,
): Chain[] {
  const n = outline.length;
  if (n < 3) return [];
  const cosT = Math.cos((toleranceDeg * Math.PI) / 180);
  const dirs: Vec2[] = [];
  for (let i = 0; i < n; i++) dirs.push(unit(sub(outline[(i + 1) % n], outline[i])));

  // Start scanning at a REAL corner, so a run that happens to straddle index
  // 0 is not split there arbitrarily.
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (dot(dirs[i], dirs[(i - 1 + n) % n]) < cosT) {
      start = i;
      break;
    }
  }
  // A ring with no corner at all (a polygon approximating a circle — real
  // footprints run to 162 vertices) has no break to start from. Emitting one
  // wrap-around chain there would produce a ZERO-LENGTH frontage, so fall
  // back to one chain per edge.
  if (start < 0) {
    return outline.map((p, i) => ({ a: p, b: outline[(i + 1) % n], idx: [i] }));
  }

  const groups: number[][] = [];
  let cur: number[] = [start];
  for (let k = 1; k < n; k++) {
    const i = (start + k) % n;
    const prev = (i - 1 + n) % n;
    if (dot(dirs[i], dirs[prev]) >= cosT) cur.push(i);
    else {
      groups.push(cur);
      cur = [i];
    }
  }
  groups.push(cur);

  return groups.map((idx) => ({
    a: outline[idx[0]],
    b: outline[(idx[idx.length - 1] + 1) % n],
    idx,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/geo/parcel.test.ts`
Expected: PASS (all 13).

- [ ] **Step 5: Run the full gates**

```bash
npx tsc --noEmit && npx eslint src/lib/geo/parcel.ts src/lib/geo/parcel.test.ts && npm test
```
Expected: no type errors, no lint errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/geo/parcel.ts src/lib/geo/parcel.test.ts
git commit -m "feat(geo): near-collinear edge chains for real parcel outlines"
```

---

### Task 2: `fitFrontage` — polygon to frontage line, facing and depth

**Files:**
- Modify: `src/lib/geo/parcel.ts`
- Test: `src/lib/geo/parcel.test.ts`

**Interfaces:**
- Consumes: `edgeChains`, `signedArea` from Task 1; `nearestPointOnStreets(p: Vec2, network: StreetNetwork): StreetProjection | null` from `@/lib/street/geometry`; `StreetNetwork` from `@/lib/street/types`.
- Produces: `interface FrontageFit { line: { a: Vec2; b: Vec2 }; flipped: boolean; depth: number }`; `fitFrontage(outline: Vec2[], network: StreetNetwork | null): FrontageFit | null`; `MIN_FRONTAGE: 2`.

**Why `flipped` and not swapped endpoints:** `blockFrame` (`src/lib/facade/blocks.ts:76`) reads `a = flipped ? line.b : line.a`, so setting `flipped` negates the derived normal. One boolean is the whole facing decision, and it is the same field the existing `f` / Flip side control writes.

**Why depth is returned unclamped:** `MASSING_DEPTH_MIN/MAX` live in `facade/layout.ts`; importing them here would invert the module dependency. `promoteParcel` (Task 4) owns the clamp so there is exactly one place that applies it.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/geo/parcel.test.ts`:

```ts
import type { StreetNetwork } from "@/lib/street/types";
import { EMPTY_NETWORK } from "@/lib/street/types";
import { fitFrontage, MIN_FRONTAGE } from "./parcel";

/** A single straight street running east-west at the given z. */
const streetAtZ = (z: number): StreetNetwork => ({
  ...EMPTY_NETWORK,
  streets: [{ id: "s1", type: "street", points: [[-50, z], [50, z]] }],
});

/** Resolve the outward normal a FrontageFit implies, mirroring blockFrame:
 * the endpoints are read in reverse when `flipped`, which negates it. */
function normalOf(fit: { line: { a: Vec2; b: Vec2 }; flipped: boolean }): Vec2 {
  const a = fit.flipped ? fit.line.b : fit.line.a;
  const b = fit.flipped ? fit.line.a : fit.line.b;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [-(dz / l), dx / l];
}

// A 10 x 6 plot, wound CCW, sitting with its long sides east-west.
const PLOT: Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 6],
  [0, 6],
];

describe("fitFrontage", () => {
  it("faces a street to the south", () => {
    const fit = fitFrontage(PLOT, streetAtZ(-8))!;
    expect(fit).not.toBeNull();
    const n = normalOf(fit);
    expect(n[0]).toBeCloseTo(0, 6);
    expect(n[1]).toBeCloseTo(-1, 6);
  });

  it("faces a street to the north", () => {
    const fit = fitFrontage(PLOT, streetAtZ(14))!;
    const n = normalOf(fit);
    expect(n[0]).toBeCloseTo(0, 6);
    expect(n[1]).toBeCloseTo(1, 6);
  });

  it("leaves the line endpoints unswapped and uses `flipped` for facing", () => {
    const fit = fitFrontage(PLOT, streetAtZ(-8))!;
    // The winning chain is the south edge, in ring order (0,0) -> (10,0).
    expect(fit.line.a).toEqual([0, 0]);
    expect(fit.line.b).toEqual([10, 0]);
    expect(fit.flipped).toBe(true);
  });

  it("gives the same facing for a CW-wound copy of the same plot", () => {
    const cw = fitFrontage([...PLOT].reverse(), streetAtZ(-8))!;
    const n = normalOf(cw);
    expect(n[1]).toBeCloseTo(-1, 6);
  });

  it("falls back to the longest chain with no network", () => {
    const fit = fitFrontage(PLOT, null)!;
    // Long sides are 10 m, short sides 6 m.
    const width = Math.hypot(
      fit.line.b[0] - fit.line.a[0],
      fit.line.b[1] - fit.line.a[1],
    );
    expect(width).toBeCloseTo(10, 6);
  });

  it("treats an empty network the same as no network", () => {
    const a = fitFrontage(PLOT, null)!;
    const b = fitFrontage(PLOT, EMPTY_NETWORK)!;
    expect(b.line).toEqual(a.line);
    expect(b.flipped).toBe(a.flipped);
  });

  it("measures depth as the perpendicular extent of the plot", () => {
    const fit = fitFrontage(PLOT, streetAtZ(-8))!;
    expect(fit.depth).toBeCloseTo(6, 6);
  });

  it("measures depth over ALL vertices, not just the frontage chain's", () => {
    // An L whose deep leg is nowhere near the frontage chain.
    const L: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [3, 4],
      [3, 20],
      [0, 20],
    ];
    const fit = fitFrontage(L, streetAtZ(-8))!;
    expect(fit.depth).toBeCloseTo(20, 6);
  });

  it("returns depth UNCLAMPED so promoteParcel owns the clamp", () => {
    const deep: Vec2[] = [[0, 0], [10, 0], [10, 40], [0, 40]];
    expect(fitFrontage(deep, streetAtZ(-8))!.depth).toBeCloseTo(40, 6);
    const shallow: Vec2[] = [[0, 0], [10, 0], [10, 1], [0, 1]];
    expect(fitFrontage(shallow, streetAtZ(-8))!.depth).toBeCloseTo(1, 6);
  });

  it("rejects a polygon that cannot carry a facade", () => {
    expect(fitFrontage([[0, 0], [1, 0]], null)).toBeNull();
    expect(fitFrontage([[0, 0], [1, 0], [2, 0]], null)).toBeNull();
    const tiny: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(MIN_FRONTAGE).toBe(2);
    expect(fitFrontage(tiny, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/geo/parcel.test.ts`
Expected: FAIL — `fitFrontage is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/geo/parcel.ts` (and add the two imports at the top of the file):

```ts
import type { StreetNetwork } from "@/lib/street/types";
import { nearestPointOnStreets } from "@/lib/street/geometry";
```

```ts
/** Where a promoted building's facade sits on its parcel. */
export interface FrontageFit {
  /** The block line, with the winning chain's endpoints VERBATIM. */
  line: { a: Vec2; b: Vec2 };
  /** Facing, in `blockFrame`'s own terms. */
  flipped: boolean;
  /** RAW extent behind the frontage in metres, deliberately UNCLAMPED —
   * `facade/promote.ts` applies MASSING_DEPTH_MIN/MAX so the clamp lives in
   * exactly one place and this module keeps no facade dependency. */
  depth: number;
}

/** A frontage shorter than this cannot carry a facade. Only 0.2% of real
 * fixture buildings fall below it. */
export const MIN_FRONTAGE = 2;

/** How hard street proximity outweighs raw chain length. */
const STREET_PULL = 0.35;
/** How far outside the chain midpoint we measure the street distance.
 * Probing OUTWARD rather than at the midpoint is what stops the chain on the
 * far side of a narrow plot from scoring as well as the near one. */
const PROBE_OUT = 0.5;
/** Score multiplier for a chain whose outward normal does not point at the
 * street at all. Nonzero so a winner always exists (a plot ringed by streets,
 * or one whose nearest street runs straight through it, still resolves), but
 * low enough that facing dominates length.
 *
 * Without this term, length alone decides: on a 6 m x 25 m canal house the
 * 25 m PARTY WALL outscores the 6 m canal frontage, and the facade lands on
 * the side of the building. Distance cannot fix that on its own, because a
 * long edge running away from the street is still close to it at one end. */
const OFF_STREET_FLOOR = 0.25;

/** Pick the street-facing frontage chain and fit the block line, facing and
 * depth. `network` null or empty makes every chain score `length / 1`, so the
 * longest wins through the SAME expression — the no-streets case is not a
 * separate branch. Returns null for a polygon that cannot carry a facade. */
export function fitFrontage(
  outline: Vec2[],
  network: StreetNetwork | null,
): FrontageFit | null {
  if (outline.length < 3) return null;
  const sa = signedArea(outline);
  if (Math.abs(sa) < 1e-6) return null;
  const ccw = sa > 0;

  let best:
    | { score: number; a: Vec2; b: Vec2; nOut: Vec2; length: number }
    | null = null;

  for (const c of edgeChains(outline)) {
    const d = sub(c.b, c.a);
    const length = len(d);
    // Too short to carry a facade => not a CANDIDATE, rather than a reason to
    // reject the whole plot. A stepped frontage often has its best-facing run
    // in a 1.5 m step; rejecting there would refuse a perfectly promotable
    // building that has a longer usable chain right beside it.
    if (length < MIN_FRONTAGE) continue;
    const u: Vec2 = [d[0] / length, d[1] / length];
    // For a positive (CCW) signed area the interior lies to the LEFT of each
    // directed edge, so the outward normal is the right-hand one.
    const nOut: Vec2 = ccw ? [u[1], -u[0]] : [-u[1], u[0]];
    const mid: Vec2 = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2];
    const probe: Vec2 = [
      mid[0] + nOut[0] * PROBE_OUT,
      mid[1] + nOut[1] * PROBE_OUT,
    ];
    // No network, no street in range, or a street running straight through
    // the probe: there is no facing information, so every chain is treated as
    // facing and the longest simply wins.
    const proj = network ? nearestPointOnStreets(probe, network) : null;
    const toStreet: Vec2 | null = proj ? sub(proj.point, probe) : null;
    const toStreetLen = toStreet ? len(toStreet) : 0;
    const facing =
      toStreet && toStreetLen > 1e-9
        ? OFF_STREET_FLOOR +
          (1 - OFF_STREET_FLOOR) *
            Math.max(0, dot(nOut, [toStreet[0] / toStreetLen, toStreet[1] / toStreetLen]))
        : 1;
    const dist = proj?.dist ?? 0;
    const score = (length * facing) / (1 + STREET_PULL * dist);
    if (!best || score > best.score) {
      best = { score, a: c.a, b: c.b, nOut, length };
    }
  }
  // Null only when EVERY chain was below MIN_FRONTAGE — a genuinely tiny
  // footprint (a shed, a canopy), not a stepped one.
  if (!best) return null;

  const u: Vec2 = [
    (best.b[0] - best.a[0]) / best.length,
    (best.b[1] - best.a[1]) / best.length,
  ];
  // The normal blockFrame derives when `flipped` is false.
  const nUnflipped: Vec2 = [-u[1], u[0]];
  const flipped = dot(nUnflipped, best.nOut) < 0;

  let depth = 0;
  for (const v of outline) {
    depth = Math.max(depth, -dot(sub(v, best.a), best.nOut));
  }

  return {
    line: { a: [best.a[0], best.a[1]], b: [best.b[0], best.b[1]] },
    flipped,
    depth,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/geo/parcel.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the fixture guard**

This is the test that catches a real regression, because it runs the algorithm against real adversarial geometry rather than hand-written shapes. Append to `src/lib/geo/parcel.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ContextBuilding } from "./buildings";
import type { Street } from "@/lib/street/types";

const FIXTURE_DIR = path.resolve(__dirname, "../../../public/fixtures/amsterdam");
const readFixture = (name: string) =>
  JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as unknown;

describe("fitFrontage against the real Amsterdam fixture", () => {
  const buildings = (readFixture("buildings.json") as { buildings: ContextBuilding[] })
    .buildings;
  const network: StreetNetwork = {
    ...EMPTY_NETWORK,
    streets: (readFixture("streets.json") as { streets: Street[] }).streets,
  };

  it("resolves a frontage for at least 99% of real footprints", () => {
    const fits = buildings.map((b) => fitFrontage(b.footprint as Vec2[], network));
    const ok = fits.filter(Boolean).length;
    expect(ok / buildings.length).toBeGreaterThanOrEqual(0.99);
  });

  it("never returns a NaN, infinite or negative-depth fit", () => {
    for (const b of buildings) {
      const fit = fitFrontage(b.footprint as Vec2[], network);
      if (!fit) continue;
      for (const v of [fit.line.a[0], fit.line.a[1], fit.line.b[0], fit.line.b[1], fit.depth]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(fit.depth).toBeGreaterThanOrEqual(0);
      expect(typeof fit.flipped).toBe("boolean");
    }
  });

  it("never returns a frontage below MIN_FRONTAGE", () => {
    for (const b of buildings) {
      const fit = fitFrontage(b.footprint as Vec2[], network);
      if (!fit) continue;
      const w = Math.hypot(
        fit.line.b[0] - fit.line.a[0],
        fit.line.b[1] - fit.line.a[1],
      );
      expect(w).toBeGreaterThanOrEqual(MIN_FRONTAGE);
    }
  });
});
```

- [ ] **Step 6: Run the fixture guard**

Run: `npx vitest run src/lib/geo/parcel.test.ts`
Expected: PASS. The success rate should land near 99.3%.

- [ ] **Step 7: Run the full gates and commit**

```bash
npx tsc --noEmit && npx eslint src/lib/geo/parcel.ts src/lib/geo/parcel.test.ts && npm test
git add src/lib/geo/parcel.ts src/lib/geo/parcel.test.ts
git commit -m "feat(geo): fit a frontage line, facing and depth from a real parcel"
```

---

### Task 3: `FacadeBlock.parcel` and `applyParcelDepth`

**Files:**
- Modify: `src/lib/facade/blocks.ts`
- Modify: `src/lib/facade/generate.ts:156-174` (`rerollBlock`), `src/lib/facade/generate.ts:187-248` (`refit`)
- Test: `src/lib/facade/blocks.test.ts` (append; create if absent)

**Interfaces:**
- Consumes: `FacadeBlock`, `LotState` from `./blocks`.
- Produces: `FacadeBlock.parcel?: { source: string; outline: [number, number][]; depth: number }`; `applyParcelDepth(block: FacadeBlock): FacadeBlock`.

**Why depth is STORED on the parcel rather than derived:** the parcel is fixed but the block line is not. Once the user drags a node, re-deriving depth from the current line would change it — and the plot has not moved. Storing it at promotion time is what makes it a property of the promotion instead of a function of the live line.

**Why this task exists at all:** `generateLot` draws `massingDepth` from 6–12 m. `rerollBlock` and `refit` both call it, so without this a reroll or a node drag would silently push a promoted building out through the back of its own parcel outline.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/facade/blocks.test.ts` (create the file with the imports below if it does not exist):

```ts
import { describe, it, expect } from "vitest";
import { applyParcelDepth, initialWorld } from "./blocks";
import type { FacadeBlock } from "./blocks";
import { DEFAULT_FACADE } from "./types";
import { rerollBlock } from "./generate";

const promoted = (): FacadeBlock => ({
  ...initialWorld({ ...DEFAULT_FACADE, width: 12 }),
  parcel: {
    source: "way/1",
    outline: [[0, 0], [12, 0], [12, 5], [0, 5]],
    depth: 5,
  },
});

describe("applyParcelDepth", () => {
  it("forces every lot onto the parcel depth with no jitter", () => {
    const b = promoted();
    b.lots[0].params = { ...b.lots[0].params, massingDepth: 11 };
    b.lots[0].depthOffset = 0.09;
    const out = applyParcelDepth(b);
    expect(out.lots[0].params.massingDepth).toBe(5);
    expect(out.lots[0].depthOffset).toBe(0);
  });

  it("returns a block with no parcel untouched, by identity", () => {
    const b = initialWorld({ ...DEFAULT_FACADE });
    expect(applyParcelDepth(b)).toBe(b);
  });

  it("does not mutate its input", () => {
    const b = promoted();
    b.lots[0].params = { ...b.lots[0].params, massingDepth: 11 };
    applyParcelDepth(b);
    expect(b.lots[0].params.massingDepth).toBe(11);
  });
});

describe("rerollBlock on a promoted block", () => {
  it("keeps the parcel depth instead of redrawing 6-12 m", () => {
    const out = rerollBlock(promoted(), 4242);
    expect(out.lots[0].params.massingDepth).toBe(5);
    expect(out.lots[0].depthOffset).toBe(0);
  });

  it("still rerolls the building's character", () => {
    const before = promoted();
    const after = rerollBlock(before, 4242);
    // Depth is pinned, but the generated character must still change.
    expect(after.lots[0].params.storeys).toBeDefined();
    expect(after.seed).toBe(4242);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/facade/blocks.test.ts`
Expected: FAIL — `applyParcelDepth is not exported`.

- [ ] **Step 3: Add the field and the helper**

In `src/lib/facade/blocks.ts`, add to the `FacadeBlock` interface, directly after the existing `source?` field:

```ts
  /** Set on blocks promoted from an imported real footprint (M4). The real
   * parcel polygon in local metres, the source OSM id, and the CLAMPED plot
   * depth. Depth is stored rather than re-derived because the parcel is fixed
   * while the block line is not: after a node drag, re-deriving would change
   * a depth whose plot has not moved. Absent on drawn and street-derived
   * blocks — absent means every M4 path is skipped. */
  parcel?: { source: string; outline: [number, number][]; depth: number };
```

Append to `src/lib/facade/blocks.ts`:

```ts
/** Force every lot of a PROMOTED block back onto its parcel depth, with no
 * depth jitter. `generateLot` redraws `massingDepth` from 6-12 m, and both
 * `rerollBlock` and `refit` call it — without this, a reroll or a node drag
 * would push the building out through the back of its own parcel outline.
 * Depth is plot geometry, not generated character. A block with no `parcel`
 * is returned by identity, so this is free on every drawn block. Pure. */
export function applyParcelDepth(block: FacadeBlock): FacadeBlock {
  const parcel = block.parcel;
  if (!parcel) return block;
  const needsFix = block.lots.some(
    (l) => l.params.massingDepth !== parcel.depth || l.depthOffset !== 0,
  );
  if (!needsFix) return block;
  return {
    ...block,
    lots: block.lots.map((l) => ({
      ...l,
      params: { ...l.params, massingDepth: parcel.depth },
      depthOffset: 0,
    })),
  };
}
```

- [ ] **Step 4: Wire it into the two generators**

In `src/lib/facade/generate.ts`, add `applyParcelDepth` to the existing import from `./blocks`:

```ts
import { applyParcelDepth, blockFrame } from "./blocks";
```

Wrap `rerollBlock`'s return value:

```ts
export function rerollBlock(block: FacadeBlock, seed: number): FacadeBlock {
  return applyParcelDepth({
    ...block,
    seed,
    lots: block.lots.map((lot, i) =>
      lot.customized
        ? lot
        : {
            params: generateLot(
              lot.params.width,
              block.gen,
              mulberry32(lotSeed(seed, i)),
            ),
            customized: false,
            depthOffset: offsetFor(seed, i, block.gen.depthJitter),
          },
    ),
  });
}
```

In `refit`, wrap BOTH successful returns (the early exact-fit return and the post-split return). Change:

```ts
    if (Math.abs(delta) < REFIT_EPS) {
      const lots = movedAtTail ? arr : arr.reverse();
      return { ...block, lots };
    }
```
to:
```ts
    if (Math.abs(delta) < REFIT_EPS) {
      const lots = movedAtTail ? arr : arr.reverse();
      return applyParcelDepth({ ...block, lots });
    }
```

and change:
```ts
    const lots = movedAtTail ? arr : arr.reverse();
    return { ...block, lots };
  }
  return null;
```
to:
```ts
    const lots = movedAtTail ? arr : arr.reverse();
    return applyParcelDepth({ ...block, lots });
  }
  return null;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/`
Expected: PASS, including every pre-existing `generate.test.ts` case — `applyParcelDepth` returns non-promoted blocks by identity, so nothing else changes.

- [ ] **Step 6: Run the full gates and commit**

```bash
npx tsc --noEmit && npx eslint src/lib/facade/blocks.ts src/lib/facade/generate.ts src/lib/facade/blocks.test.ts && npm test
git add src/lib/facade/blocks.ts src/lib/facade/generate.ts src/lib/facade/blocks.test.ts
git commit -m "feat(facade): pin a promoted block's massing depth to its parcel"
```

---

### Task 4: `promoteParcel`

**Files:**
- Create: `src/lib/facade/promote.ts`
- Test: `src/lib/facade/promote.test.ts`

**Interfaces:**
- Consumes: `fitFrontage`, `Vec2` from `@/lib/geo/parcel`; `ContextBuilding` from `@/lib/geo/buildings`; `StreetNetwork` from `@/lib/street/types`; `FacadeBlock`, `BlockGenSettings`, `blockFrame`, `nextBlockId` from `./blocks`; `generateLot`, `mulberry32` from `./generate`; `MASSING_DEPTH_MIN`, `MASSING_DEPTH_MAX` from `./layout`.
- Produces: `promoteParcel(building: ContextBuilding, network: StreetNetwork | null, gen: BlockGenSettings, seed: number): FacadeBlock | null`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/facade/promote.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ContextBuilding } from "@/lib/geo/buildings";
import type { StreetNetwork } from "@/lib/street/types";
import { EMPTY_NETWORK } from "@/lib/street/types";
import { DEFAULT_GEN, blockFrame } from "./blocks";
import { MASSING_DEPTH_MAX, MASSING_DEPTH_MIN } from "./layout";
import { promoteParcel } from "./promote";

const streetAtZ = (z: number): StreetNetwork => ({
  ...EMPTY_NETWORK,
  streets: [{ id: "s1", type: "street", points: [[-50, z], [50, z]] }],
});

const plot = (outline: [number, number][]): ContextBuilding => ({
  id: "way/24601",
  footprint: outline,
  height: 20.1,
});

// 10 m frontage, 6 m deep, street to the south.
const PLOT = plot([[0, 0], [10, 0], [10, 6], [0, 6]]);

describe("promoteParcel", () => {
  it("produces exactly one lot spanning the whole frontage", () => {
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots).toHaveLength(1);
    expect(b.lots[0].params.width).toBeCloseTo(10, 6);
    expect(blockFrame(b).length).toBeCloseTo(10, 6);
  });

  it("takes massing depth from the parcel, not the generator", () => {
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots[0].params.massingDepth).toBeCloseTo(6, 6);
    expect(b.parcel!.depth).toBeCloseTo(6, 6);
  });

  it("clamps a very deep plot to MASSING_DEPTH_MAX", () => {
    const deep = plot([[0, 0], [10, 0], [10, 40], [0, 40]]);
    const b = promoteParcel(deep, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots[0].params.massingDepth).toBe(MASSING_DEPTH_MAX);
    expect(b.parcel!.depth).toBe(MASSING_DEPTH_MAX);
  });

  it("clamps a very shallow plot to MASSING_DEPTH_MIN", () => {
    const shallow = plot([[0, 0], [10, 0], [10, 2], [0, 2]]);
    const b = promoteParcel(shallow, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots[0].params.massingDepth).toBe(MASSING_DEPTH_MIN);
  });

  it("carries no depth jitter, so the building stays on its plot", () => {
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots[0].depthOffset).toBe(0);
  });

  it("stores the source id and the real outline verbatim", () => {
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.parcel!.source).toBe("way/24601");
    expect(b.parcel!.outline).toEqual(PLOT.footprint);
  });

  it("copies the outline rather than aliasing the fetched footprint", () => {
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.parcel!.outline).not.toBe(PLOT.footprint);
    expect(b.parcel!.outline[0]).not.toBe(PLOT.footprint[0]);
  });

  it("leaves the lot unpinned so Reroll still works", () => {
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots[0].customized).toBe(false);
  });

  it("faces the street", () => {
    const south = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(blockFrame(south).normal[1]).toBeCloseTo(-1, 6);
    const north = promoteParcel(PLOT, streetAtZ(14), DEFAULT_GEN, 7)!;
    expect(blockFrame(north).normal[1]).toBeCloseTo(1, 6);
  });

  it("is deterministic in the seed", () => {
    const a = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots[0].params).toEqual(a.lots[0].params);
    const c = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 8)!;
    expect(c.lots[0].params).not.toEqual(a.lots[0].params);
  });

  it("gives each promotion a distinct block id", () => {
    const a = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.id).not.toBe(a.id);
  });

  it("does not alias the caller's gen settings", () => {
    const gen = { ...DEFAULT_GEN };
    const b = promoteParcel(PLOT, streetAtZ(-8), gen, 7)!;
    expect(b.gen).not.toBe(gen);
    expect(b.gen).toEqual(gen);
  });

  it("returns null when the parcel cannot carry a facade", () => {
    const sliver = plot([[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(promoteParcel(sliver, streetAtZ(-8), DEFAULT_GEN, 7)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/facade/promote.test.ts`
Expected: FAIL — `Failed to resolve import "./promote"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/facade/promote.ts`:

```ts
/** Promotion (M4): turn an imported real footprint into an ordinary editable
 * FacadeBlock. Reality contributes the PLOT — frontage line, facing, width and
 * depth; the generator contributes storeys, style, roof and colour.
 *
 * The rectangular-box facade engine is untouched: the real polygon rides along
 * on `block.parcel` and is drawn on the ground as the lot boundary, with the
 * box fitted inside it. Pure — no three, no React.
 *
 * Spec: docs/superpowers/specs/2026-07-26-promote-footprint-design.md */

import type { ContextBuilding } from "@/lib/geo/buildings";
import type { Vec2 } from "@/lib/geo/parcel";
import { fitFrontage } from "@/lib/geo/parcel";
import type { StreetNetwork } from "@/lib/street/types";
import type { BlockGenSettings, FacadeBlock } from "./blocks";
import { blockFrame, nextBlockId } from "./blocks";
import { generateLot, mulberry32 } from "./generate";
import { MASSING_DEPTH_MAX, MASSING_DEPTH_MIN } from "./layout";

/** The single place the parcel depth clamp is applied. `fitFrontage` returns
 * the raw extent so `lib/geo` keeps no facade dependency. */
const clampDepth = (d: number): number =>
  Math.max(MASSING_DEPTH_MIN, Math.min(MASSING_DEPTH_MAX, d));

/** Real footprint -> a ready-to-render block with ONE generated lot.
 * `network` may be null: with no streets the longest edge chain wins, and the
 * existing `f` / Flip side control corrects a bad guess. Returns null when the
 * parcel cannot carry a facade (see `fitFrontage`). */
export function promoteParcel(
  building: ContextBuilding,
  network: StreetNetwork | null,
  gen: BlockGenSettings,
  seed: number,
): FacadeBlock | null {
  const fit = fitFrontage(building.footprint as Vec2[], network);
  if (!fit) return null;

  const line = {
    a: [fit.line.a[0], fit.line.a[1]] as [number, number],
    b: [fit.line.b[0], fit.line.b[1]] as [number, number],
  };
  const width = blockFrame({ line, flipped: fit.flipped }).length;
  const depth = clampDepth(fit.depth);

  return {
    id: nextBlockId(),
    line,
    flipped: fit.flipped,
    gen: structuredClone(gen),
    seed,
    lots: [
      {
        params: {
          ...generateLot(width, gen, mulberry32(seed >>> 0)),
          width,
          // Plot geometry, NOT generated character: generateLot draws 6-12 m,
          // and median real depth is 6.0 m with p05 at 2.7 m, so a generated
          // depth would push the box out through the back of its own outline.
          massingDepth: depth,
        },
        customized: false,
        // The generator's +/- depthJitter would shove the building off its
        // own plot.
        depthOffset: 0,
      },
    ],
    parcel: {
      source: building.id,
      // Copied, not aliased: the fetched footprint array is shared with the
      // context-buildings backdrop and must not become block state.
      outline: building.footprint.map((p) => [p[0], p[1]] as [number, number]),
      depth,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/promote.test.ts`
Expected: PASS (all 13).

- [ ] **Step 5: Run the full gates and commit**

```bash
npx tsc --noEmit && npx eslint src/lib/facade/promote.ts src/lib/facade/promote.test.ts && npm test
git add src/lib/facade/promote.ts src/lib/facade/promote.test.ts
git commit -m "feat(facade): promote a real footprint into an editable block"
```

---

### Task 5: `subdivideBlock` and `mergeBlock`

**Files:**
- Modify: `src/lib/facade/promote.ts`
- Test: `src/lib/facade/promote.test.ts`

**Interfaces:**
- Consumes: `promoteParcel` from Task 4; `applyParcelDepth` from Task 3; `generateBlock`, `generateLot`, `mulberry32` from `./generate`; `blockFrame` from `./blocks`.
- Produces: `subdivideBlock(block: FacadeBlock, seed: number): FacadeBlock | null`; `mergeBlock(block: FacadeBlock, seed: number): FacadeBlock | null`.

**Why merge refuses on a customized lot:** merging collapses N lots into 1, so any hand edit on lots 2..N would be silently discarded. Refusing is honest; the UI hides the button instead of destroying work.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/facade/promote.test.ts`:

```ts
import { mergeBlock, subdivideBlock } from "./promote";

// 30 m frontage, 6 m deep — long enough to split at lotWidth 5-9.
const WIDE = plot([[0, 0], [30, 0], [30, 6], [0, 6]]);

describe("subdivideBlock", () => {
  it("splits a wide promoted block into a terrace", () => {
    const one = promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const many = subdivideBlock(one, 11)!;
    expect(many.lots.length).toBeGreaterThan(1);
  });

  it("keeps the block's total frontage exactly", () => {
    const one = promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const many = subdivideBlock(one, 11)!;
    const sum = many.lots.reduce((s, l) => s + l.params.width, 0);
    expect(sum).toBeCloseTo(blockFrame(one).length, 6);
  });

  it("propagates the parcel depth to every new lot, with no jitter", () => {
    const one = promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const many = subdivideBlock(one, 11)!;
    for (const l of many.lots) {
      expect(l.params.massingDepth).toBeCloseTo(6, 6);
      expect(l.depthOffset).toBe(0);
    }
  });

  it("leaves the parcel itself untouched", () => {
    const one = promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const many = subdivideBlock(one, 11)!;
    expect(many.parcel).toEqual(one.parcel);
  });

  it("refuses a frontage too short to split", () => {
    const one = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    // 10 m with lotWidth.min 5 is exactly at the threshold; 8 m is below it.
    const narrow = promoteParcel(
      plot([[0, 0], [8, 0], [8, 6], [0, 6]]),
      streetAtZ(-8),
      DEFAULT_GEN,
      7,
    )!;
    expect(subdivideBlock(narrow, 11)).toBeNull();
    expect(subdivideBlock(one, 11)).not.toBeNull();
  });

  it("refuses a block that is already a terrace", () => {
    const many = subdivideBlock(promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!, 11)!;
    expect(subdivideBlock(many, 12)).toBeNull();
  });
});

describe("mergeBlock", () => {
  it("collapses a terrace back to one lot spanning the frontage", () => {
    const one = promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const many = subdivideBlock(one, 11)!;
    const back = mergeBlock(many, 13)!;
    expect(back.lots).toHaveLength(1);
    expect(back.lots[0].params.width).toBeCloseTo(blockFrame(one).length, 6);
  });

  it("keeps the parcel depth on the merged lot", () => {
    const many = subdivideBlock(promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!, 11)!;
    const back = mergeBlock(many, 13)!;
    expect(back.lots[0].params.massingDepth).toBeCloseTo(6, 6);
    expect(back.lots[0].depthOffset).toBe(0);
  });

  it("refuses when any lot is hand-edited, rather than discarding the work", () => {
    const many = subdivideBlock(promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!, 11)!;
    many.lots[1] = { ...many.lots[1], customized: true };
    expect(mergeBlock(many, 13)).toBeNull();
  });

  it("refuses a block that is already a single lot", () => {
    const one = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(mergeBlock(one, 13)).toBeNull();
  });

  it("round-trips: promote -> subdivide -> merge restores one full-width lot", () => {
    const one = promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const back = mergeBlock(subdivideBlock(one, 11)!, 13)!;
    expect(back.lots).toHaveLength(1);
    expect(back.lots[0].params.width).toBeCloseTo(one.lots[0].params.width, 6);
    expect(back.line).toEqual(one.line);
    expect(back.flipped).toBe(one.flipped);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/facade/promote.test.ts`
Expected: FAIL — `subdivideBlock is not a function`.

- [ ] **Step 3: Write the implementation**

Add to the imports at the top of `src/lib/facade/promote.ts`:

```ts
import { applyParcelDepth, blockFrame, nextBlockId } from "./blocks";
import { generateBlock, generateLot, mulberry32 } from "./generate";
```

Append to `src/lib/facade/promote.ts`:

```ts
/** One lot -> a terrace, via the existing generateBlock. Returns null when the
 * block is already subdivided or its frontage cannot yield two legal lots.
 * The parcel (and its depth) rides through unchanged. Pure. */
export function subdivideBlock(
  block: FacadeBlock,
  seed: number,
): FacadeBlock | null {
  if (block.lots.length !== 1) return null;
  if (blockFrame(block).length < 2 * block.gen.lotWidth.min) return null;
  const lots = generateBlock(block.line, block.flipped, block.gen, seed);
  if (lots.length < 2) return null;
  return applyParcelDepth({ ...block, seed, lots });
}

/** A terrace -> one lot spanning the whole frontage. Returns null when the
 * block is already a single lot, or when ANY lot is hand-edited: merging
 * collapses N lots into 1, so it would silently discard that work. Pure. */
export function mergeBlock(
  block: FacadeBlock,
  seed: number,
): FacadeBlock | null {
  if (block.lots.length <= 1) return null;
  if (block.lots.some((l) => l.customized)) return null;
  const width = blockFrame(block).length;
  return applyParcelDepth({
    ...block,
    seed,
    lots: [
      {
        params: {
          ...generateLot(width, block.gen, mulberry32(seed >>> 0)),
          width,
        },
        customized: false,
        depthOffset: 0,
      },
    ],
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/promote.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gates and commit**

```bash
npx tsc --noEmit && npx eslint src/lib/facade/promote.ts src/lib/facade/promote.test.ts && npm test
git add src/lib/facade/promote.ts src/lib/facade/promote.test.ts
git commit -m "feat(facade): reversible subdivide/merge for a promoted block"
```

---

### Task 6: Persist the parcel

**Files:**
- Modify: `src/lib/facade/document.ts:115-125` (`validBlock`), `src/lib/facade/document.ts:210-218` (`normalizeBlocks`)
- Test: `src/lib/facade/document.test.ts`

**Interfaces:**
- Consumes: `FacadeBlock.parcel` from Task 3.
- Produces: `validParcel(v: unknown): boolean` (module-private).

**Contract to preserve:** `deserializeScene` never throws and rejects the whole document only for structural breakage. A malformed `parcel` is **dropped**, matching how malformed streets, roundabouts, heightfields and bboxes are already handled — one corrupted field must not white-screen an otherwise-good save.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/facade/document.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deserializeScene, serializeScene, SCENE_VERSION } from "./document";
import type { SceneState } from "./document";
import { initialWorld } from "./blocks";
import { DEFAULT_FACADE } from "./types";
import { DEFAULT_GROUND } from "./terrain";
import { EMPTY_NETWORK } from "@/lib/street/types";
import { DEFAULT_MAX_CORNER_ANGLE } from "./corners";
import { STREET_WIDTH_DEFAULT } from "./street";

const sceneWith = (parcel: unknown): SceneState => ({
  blocks: [{ ...initialWorld({ ...DEFAULT_FACADE }), parcel } as never],
  cornerChoices: new Map(),
  ground: DEFAULT_GROUND,
  streetWidth: STREET_WIDTH_DEFAULT,
  maxCornerAngle: DEFAULT_MAX_CORNER_ANGLE,
  streetNetwork: EMPTY_NETWORK,
  anchor: null,
  bbox: null,
  hiddenIds: new Set(),
});

const GOOD = {
  source: "way/24601",
  outline: [[0, 0], [10, 0], [10, 6], [0, 6]],
  depth: 6,
};

describe("document round-trip of block.parcel", () => {
  it("round-trips a valid parcel", () => {
    const doc = serializeScene(sceneWith(GOOD));
    const out = deserializeScene(JSON.parse(JSON.stringify(doc)));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.scene.blocks[0].parcel).toEqual(GOOD);
  });

  it("keeps SCENE_VERSION at 1 — a bump would reject every beta save", () => {
    expect(SCENE_VERSION).toBe(1);
  });

  it("loads a block with no parcel at all (every older save)", () => {
    const doc = serializeScene(sceneWith(undefined));
    const out = deserializeScene(JSON.parse(JSON.stringify(doc)));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.scene.blocks[0].parcel).toBeUndefined();
  });

  it.each([
    ["not an object", 42],
    ["missing source", { outline: GOOD.outline, depth: 6 }],
    ["non-string source", { source: 1, outline: GOOD.outline, depth: 6 }],
    ["missing outline", { source: "way/1", depth: 6 }],
    ["outline too short", { source: "way/1", outline: [[0, 0], [1, 1]], depth: 6 }],
    ["non-finite vertex", { source: "way/1", outline: [[0, 0], [NaN, 0], [1, 1]], depth: 6 }],
    ["bad vertex arity", { source: "way/1", outline: [[0], [1, 1], [2, 2]], depth: 6 }],
    ["non-finite depth", { source: "way/1", outline: GOOD.outline, depth: Infinity }],
  ])("drops a malformed parcel (%s) without failing the document", (_label, parcel) => {
    const doc = serializeScene(sceneWith(parcel));
    const out = deserializeScene(JSON.parse(JSON.stringify(doc)));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // The block itself survives — only the parcel is dropped.
    expect(out.scene.blocks).toHaveLength(1);
    expect(out.scene.blocks[0].parcel).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/facade/document.test.ts`
Expected: FAIL — malformed parcels survive unvalidated.

- [ ] **Step 3: Write the implementation**

In `src/lib/facade/document.ts`, add after `validLine`:

```ts
/** A promoted block's real parcel: a source id, a closed polygon of at least
 * three finite [x, z] vertices, and a finite depth. Malformed values are
 * DROPPED rather than failing the document — same idiom as validStreet /
 * validHeightfield / validBBox, so one corrupted parcel cannot white-screen an
 * otherwise-good save. */
function validParcel(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (typeof v.source !== "string") return false;
  if (!isFiniteNumber(v.depth)) return false;
  const o = v.outline;
  return (
    Array.isArray(o) &&
    o.length >= 3 &&
    o.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        isFiniteNumber(p[0]) &&
        isFiniteNumber(p[1]),
    )
  );
}
```

Then in `normalizeBlocks`, strip an invalid parcel:

```ts
/** Normalize every lot's params so the loaded blocks are render-safe, and
 * drop a malformed `parcel` (M4) so a corrupt outline can't reach the
 * renderer. */
function normalizeBlocks(blocks: Record<string, unknown>[]): FacadeBlock[] {
  return blocks.map((b) => {
    const { parcel: _drop, ...rest } = b as Record<string, unknown>;
    return {
      ...(rest as unknown as FacadeBlock),
      ...(validParcel(b.parcel)
        ? { parcel: b.parcel as FacadeBlock["parcel"] }
        : {}),
      lots: (b.lots as Record<string, unknown>[]).map((l) => ({
        ...(l as { customized?: boolean; depthOffset?: number }),
        params: normalizeParams(l.params as Record<string, unknown>),
      })),
    };
  }) as FacadeBlock[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/document.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gates and commit**

```bash
npx tsc --noEmit && npx eslint src/lib/facade/document.ts src/lib/facade/document.test.ts && npm test
git add src/lib/facade/document.ts src/lib/facade/document.test.ts
git commit -m "feat(facade): persist a promoted block's parcel, dropping malformed ones"
```

---

### Task 7: Draw the parcel outline

**Files:**
- Modify: `src/components/facade/SceneContents.tsx` (add `ParcelOutline`; render it inside `BlockGroup` beside the existing block line at ~line 400)

**Interfaces:**
- Consumes: `FacadeBlock.parcel` from Task 3; `groundHeightAt` from `@/lib/facade/terrain`; `Line` (the default export of `./NodeLine`, already imported at `SceneContents.tsx:7`).
- Produces: nothing consumed by later tasks.

**Constraint:** never mount an empty `NodeLine` — guard on `outline.length >= 3` before rendering.

**Behaviour:** the outline is FIXED. It does not follow the block when the building is edited, because it is a real plot boundary; seeing the building leave its plot is the point.

- [ ] **Step 1: Add the component**

In `src/components/facade/SceneContents.tsx`, add just above `function BlockGroup(` (~line 283):

```tsx
/** A promoted block's real parcel boundary, draped on the ground (M4).
 *
 * Deliberately FIXED: it does not follow the block when lots are resized or a
 * node is dragged, because it is a real plot boundary — seeing the building
 * leave its plot is information the designer wants, not a bug. Dashed so it
 * reads as a survey line rather than built geometry. */
function ParcelOutline({
  outline,
  ground,
}: {
  outline: [number, number][];
  ground: Ground;
}) {
  const points = useMemo(
    () =>
      // Closed loop: repeat the first vertex so the ring joins up.
      [...outline, outline[0]].map(
        ([x, z]) =>
          [x, groundHeightAt(x, z, ground) + 0.07, z] as [number, number, number],
      ),
    [outline, ground],
  );
  // Never mount an empty fat line — a Line2 compiled with empty geometry
  // produces invalid WGSL that stays cached.
  if (outline.length < 3) return null;
  return (
    <Line
      points={points}
      color={PARCEL_COLOR}
      lineWidth={1.4}
      dashed
      dashSize={0.7}
      gapSize={0.45}
    />
  );
}
```

Add the colour constant beside the other scene colours near the top of the file:

```tsx
/** Desaturated gold for a real imported plot boundary — distinct from the
 * accent used for block/lot selection, so a parcel never reads as selected. */
const PARCEL_COLOR = "#a89060";
```

- [ ] **Step 2: Render it inside `BlockGroup`**

In `BlockGroup`'s returned JSX, immediately before the existing block-line `<Line ...>` (~line 403), add:

```tsx
      {/* Real parcel boundary for a promoted block (M4). Absent on drawn and
        * street-derived blocks, so this is byte-identical without a place. */}
      {block.parcel && (
        <ParcelOutline outline={block.parcel.outline} ground={ground} />
      )}
```

- [ ] **Step 3: Verify the gates**

```bash
npx tsc --noEmit && npx eslint src/components/facade/SceneContents.tsx && npm test
```
Expected: no type errors, no lint errors (watch for `react-hooks/preserve-manual-memoization` on the new `useMemo` — it must read only `outline` and `ground`), all tests pass.

- [ ] **Step 4: Verify visually**

Run `npm run dev`, open `/facade`, click **Demo place**. Nothing should change yet (no block carries a parcel), and the scene must look exactly as before. This step is confirming the *absence* of a regression.

- [ ] **Step 5: Commit**

```bash
git add src/components/facade/SceneContents.tsx
git commit -m "feat(facade): draw a promoted block's real parcel boundary"
```

---

### Task 8: Select a context building instead of demolishing it

**Files:**
- Modify: `src/components/facade/ContextBuildings.tsx`
- Modify: `src/components/facade/FacadeViewer.tsx` (props at ~136, ~1402, ~1454, ~1601, ~1928, ~1987, ~2059, ~2191, ~2265; the `selectMode` gate at ~2312)
- Modify: `src/app/facade/page.tsx` (state near line 295; wiring at ~1745)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ContextBuildings` prop `onSelect?: (id: string) => void` and `selectedId?: string | null`; page state `selectedContextBuilding: string | null` with setter `setSelectedContextBuilding`.

**Intentional behaviour change (approved in the spec):** clicking a context building no longer demolishes it instantly. It selects it, and Demolish moves to the inspector in Task 9. `handleHideContextBuilding` is **kept**, not deleted — Task 9 calls it from the panel's Demolish button.

- [ ] **Step 1: Swap the interaction in `ContextBuildings`**

In `src/components/facade/ContextBuildings.tsx`, replace the `onHide` prop with `onSelect` + `selectedId`, and highlight the selected building as well as the hovered one:

```tsx
/** Real building footprints as inert grey backdrop massing (M2), selectable
 * for promotion or demolition (M4). Renders nothing when hidden or empty, so a
 * scene with no place is unchanged. `onSelect` undefined => not interactive
 * (Select tool off): no hover, no click. */
export default function ContextBuildings({
  buildings,
  ground,
  hiddenIds,
  visible,
  selectedId,
  onSelect,
}: {
  buildings: ContextBuilding[];
  ground: Ground;
  hiddenIds: ReadonlySet<string>;
  visible: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
```

Replace every remaining `onHide` reference in the body with `onSelect`, and change the highlight to prefer the selection:

```tsx
  // Selection outranks hover, so the panel's subject stays lit while the
  // cursor wanders. Both are validated against the visible set, so a stale id
  // (the building was demolished) simply stops highlighting.
  const litId = useMemo(() => {
    const wanted = selectedId ?? validHovered;
    return wanted && shown.some((b) => b.id === wanted) ? wanted : null;
  }, [selectedId, validHovered, shown]);

  const hoverGeo = useMemo(() => {
    if (!litId) return null;
    const b = shown.find((x) => x.id === litId);
    return b ? buildMerged([b], ground).geo : null;
  }, [litId, shown, ground]);
```

and in the highlight mesh use a distinct colour for a selection:

```tsx
      {hoverGeo && (
        <mesh geometry={hoverGeo}>
          <meshStandardMaterial
            color={selectedId === litId ? SELECTED_COLOR : HIGHLIGHT_COLOR}
            roughness={0.9}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}
```

with, beside the existing colours:

```tsx
const SELECTED_COLOR = "#d8c48a";
```

Note the `hoverGeo` memo no longer needs the `onSelect` guard, because `litId` is only non-null when something is hovered (which requires interactivity) or explicitly selected.

- [ ] **Step 2: Rename the thread through `FacadeViewer`**

In `src/components/facade/FacadeViewer.tsx`, rename `onHideContextBuilding` to `onSelectContextBuilding` at every one of its call sites and prop declarations, add a `selectedContextBuilding?: string | null` prop threaded to `ContextBuildings`, and keep the drag guard — it is load-bearing:

```tsx
  // R3F synthesizes a click after a drag release, so a marquee sweep that
  // happens to end over a footprint would otherwise select a building nobody
  // meant to touch. `onSelectContextBuilding` stays undefined when the Select
  // tool is off, which is what makes the mesh non-interactive.
  const guardedSelectContextBuilding = useCallback(
    (id: string) => {
      if (performance.now() - dragEndAt.current < 300) return;
      onSelectContextBuilding?.(id);
    },
    [onSelectContextBuilding],
  );
```

At the props-destructuring point (~2265), gate it on `selectMode` alongside the other `onSelect*` callbacks, so it is Select-tool-only for free:

```tsx
  const onSelectContextBuilding = useMemo(
    () =>
      selectMode
        ? (id: string) => {
            rawSelectContextBuilding(id);
          }
        : undefined,
    [selectMode, rawSelectContextBuilding],
  );
```

Match whatever idiom the neighbouring gated callbacks already use in that block rather than inventing a second one.

- [ ] **Step 3: Hold the selection in the page**

In `src/app/facade/page.tsx`, beside the other selection state (~line 325):

```tsx
  const [selectedContextBuilding, setSelectedContextBuilding] = useState<
    string | null
  >(null);
```

Clear it wherever the other selections are cleared (the `onClearSelection` handler and the single-lot-click path), and pass both props at the `FacadeViewer` call site (~1745):

```tsx
            selectedContextBuilding={selectedContextBuilding}
            onSelectContextBuilding={setSelectedContextBuilding}
```

Selection is UI-only and never restored from the autosaved document, so no document change is needed.

- [ ] **Step 4: Verify the gates**

```bash
npx tsc --noEmit && npx eslint src/components/facade/ContextBuildings.tsx src/components/facade/FacadeViewer.tsx src/app/facade/page.tsx && npm test
```

- [ ] **Step 5: Verify visually**

`npm run dev` → `/facade` → **Demo place**. With the Select tool OFF, hovering a footprint must not tint it and clicking must do nothing. Turn Select ON: hovering tints, clicking lights the building in the selected colour and does **not** demolish it. Drag a marquee that ends over a footprint — nothing must get selected by the synthesized click.

- [ ] **Step 6: Commit**

```bash
git add src/components/facade/ContextBuildings.tsx src/components/facade/FacadeViewer.tsx src/app/facade/page.tsx
git commit -m "feat(facade): select a context building instead of demolishing on click"
```

---

### Task 9: The Context Building inspector and the promote handler

**Files:**
- Modify: `src/components/facade/FacadeControls.tsx` (add `ContextBuildingPanel` beside `ContextPanel` at ~1479)
- Modify: `src/app/facade/page.tsx`

**Interfaces:**
- Consumes: `promoteParcel` (Task 4); `parcelArea` (Task 1); page state from Task 8; the existing `handleHideContextBuilding`.
- Produces: `ContextBuildingPanel` React component; page handler `handlePromoteContextBuilding(id: string)`; derived `promotedSources: Set<string>`.

**The preview must call `promoteParcel` itself** and read `lots[0].params`, not re-derive the numbers — otherwise the panel can disagree with the result and the depth clamp gets duplicated. `promoteParcel` is pure and cheap.

- [ ] **Step 1: Add the panel**

In `src/components/facade/FacadeControls.tsx`, beside `ContextPanel`:

```tsx
/**
 * M4 — the selected context building. Shows what promotion WOULD produce
 * (frontage and depth read straight off a trial `promoteParcel`, never
 * re-derived, so the panel can't disagree with the result), then offers
 * Promote or Demolish. Demolish lives here rather than on the mesh click
 * because an instant, unconfirmed demolition on a single click was a real
 * hazard.
 */
export function ContextBuildingPanel({
  id,
  area,
  vertices,
  preview,
  onPromote,
  onDemolish,
  onClose,
}: {
  id: string;
  area: number;
  vertices: number;
  /** null when the parcel cannot carry a facade. */
  preview: { width: number; depth: number } | null;
  onPromote: () => void;
  onDemolish: () => void;
  onClose: () => void;
}) {
  return (
    <Section title="Context building">
      <p className="text-[11px] text-[var(--muted)]">{id}</p>
      <p className="text-[11px] text-[var(--muted)]">
        {Math.round(area).toLocaleString()} m² · {vertices} vertices
      </p>
      {preview ? (
        <p className="text-[11px] text-[var(--muted)]">
          Promotes to a {preview.width.toFixed(1)} m frontage,{" "}
          {preview.depth.toFixed(1)} m deep.
        </p>
      ) : (
        <p className="text-[11px] text-[var(--muted)]">
          This footprint is too small to carry a facade.
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPromote}
          disabled={!preview}
          className="text-[11px] px-2 py-0.5 rounded border border-[var(--accent)] text-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Promote to lot
        </button>
        <button
          type="button"
          onClick={onDemolish}
          className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
        >
          Demolish
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
        >
          Close
        </button>
      </div>
    </Section>
  );
}
```

- [ ] **Step 2: Derive the promoted set and wire the handler**

In `src/app/facade/page.tsx`, add the imports:

```tsx
import { promoteParcel } from "@/lib/facade/promote";
import { parcelArea } from "@/lib/geo/parcel";
```

Derive the suppression set — no new stored state:

```tsx
  /** Context buildings suppressed because they were promoted. DERIVED from
   * the blocks, not stored, which is what makes "Restore hidden" unable to
   * resurrect a grey copy on top of a promoted block, and makes deleting a
   * promoted block bring the real building back. */
  const promotedSources = useMemo(
    () =>
      new Set(
        blocks
          .map((b) => b.parcel?.source)
          .filter((s): s is string => s !== undefined),
      ),
    [blocks],
  );

  /** What ContextBuildings actually hides: demolished plus promoted. */
  const suppressedIds = useMemo(() => {
    if (promotedSources.size === 0) return hiddenIds;
    const out = new Set(hiddenIds);
    for (const s of promotedSources) out.add(s);
    return out;
  }, [hiddenIds, promotedSources]);
```

Pass `hiddenIds={suppressedIds}` to `FacadeViewer` in place of `hiddenIds`. Keep `hiddenCount={hiddenIds.size}` on `ContextPanel` pointing at the **demolished** set only, so "Restore hidden (N)" still counts what it restores.

Add the selected building and its preview:

```tsx
  const selectedContextObj = useMemo(
    () =>
      selectedContextBuilding
        ? (contextBuildings.find((b) => b.id === selectedContextBuilding) ?? null)
        : null,
    [selectedContextBuilding, contextBuildings],
  );

  /** The block promotion WOULD produce. Built with the real function so the
   * panel and the result can never disagree; `promoteParcel` is pure, so this
   * costs nothing but is thrown away unless the user commits. The seed is
   * fixed here only to keep the preview stable while the panel is open — the
   * commit below draws a fresh one. */
  const promotePreview = useMemo(() => {
    if (!selectedContextObj) return null;
    const b = promoteParcel(selectedContextObj, streetNetwork, DEFAULT_GEN, 1);
    if (!b) return null;
    return {
      width: b.lots[0].params.width,
      depth: b.lots[0].params.massingDepth ?? 0,
    };
  }, [selectedContextObj, streetNetwork]);

  const handlePromoteContextBuilding = useCallback(() => {
    if (!selectedContextObj) return;
    const block = promoteParcel(
      selectedContextObj,
      streetNetwork,
      DEFAULT_GEN,
      Math.floor(Math.random() * 1e9),
    );
    if (!block) return;
    // Every block mutation funnels through syncCorners, so a promoted block
    // participates in corner detection like any other from the moment it
    // lands.
    setBlocks((bs) => syncCorners([...bs, block], cornerChoices, maxCornerAngle));
    setSelectedContextBuilding(null);
  }, [selectedContextObj, streetNetwork, cornerChoices, maxCornerAngle]);
```

Match the exact `syncCorners` argument order and the `setBlocks` idiom already used by the neighbouring block-mutation handlers in this file rather than assuming the signature above.

- [ ] **Step 3: Render the panel**

Render `ContextBuildingPanel` beside `ContextPanel` — **outside** the block/street/marquee selection ternary, for the same reason `ContextPanel` is: the M4 flow is "load a place, click a building" with no block selected, so gating it behind a block selection would make it unreachable.

```tsx
            {selectedContextObj && (
              <ContextBuildingPanel
                id={selectedContextObj.id}
                area={parcelArea(selectedContextObj.footprint)}
                vertices={selectedContextObj.footprint.length}
                preview={promotePreview}
                onPromote={handlePromoteContextBuilding}
                onDemolish={() => {
                  handleHideContextBuilding(selectedContextObj.id);
                  setSelectedContextBuilding(null);
                }}
                onClose={() => setSelectedContextBuilding(null)}
              />
            )}
```

- [ ] **Step 4: Verify the gates**

```bash
npx tsc --noEmit && npx eslint src/components/facade/FacadeControls.tsx src/app/facade/page.tsx && npm test
```

- [ ] **Step 5: Verify visually — this is the milestone's real test**

`npm run dev` → `/facade` → **Demo place** → Select tool ON.

1. Click a canal-side building. The panel shows its id, area, vertex count and a frontage/depth preview.
2. **Promote.** The grey building disappears and a parametric building stands on its plot, with a dashed gold outline tracing the **real footprint** — verify the outline is the actual polygon, not a rectangle.
3. Confirm the facade **faces the canal/street**, not into the block.
4. Confirm the box sits *inside* the outline (it may under-fill; it must not spill out of the back).
5. **Restore hidden** must not bring back a grey copy of the promoted building.
6. **Delete the promoted block.** The grey building must come back.
7. Promote again, then **Save**, reload the page, and confirm the promoted block and its outline survive the autosave restore.
8. **Clear terrain.** The promoted block and its outline must remain.
9. Promote a building with **no street nearby** and confirm it still promotes (longest-chain fallback) and can be corrected with Flip side.
10. Select the promoted block, hit **Reroll**, and confirm the building restyles but its depth does **not** jump to a random 6–12 m.

- [ ] **Step 6: Commit**

```bash
git add src/components/facade/FacadeControls.tsx src/app/facade/page.tsx
git commit -m "feat(facade): context-building inspector with promote and demolish"
```

---

### Task 10: Subdivide / Merge in the block panel

**Files:**
- Modify: `src/components/facade/FacadeControls.tsx` (the block-level panel that already renders the `Reroll` toggle at ~1048 and ~1137)
- Modify: `src/app/facade/page.tsx` (beside `handleReroll` at ~940)

**Interfaces:**
- Consumes: `subdivideBlock`, `mergeBlock` (Task 5); the existing `updateSelectedBlock` helper.
- Produces: block-panel props `onSubdivide?: () => void`, `onMerge?: () => void`, `canSubdivide: boolean`, `canMerge: boolean`.

- [ ] **Step 1: Add the handlers**

In `src/app/facade/page.tsx`, beside `handleReroll`:

```tsx
  const handleSubdivide = useCallback(() => {
    const seed = Math.floor(Math.random() * 1e9);
    updateSelectedBlock((b) => subdivideBlock(b, seed) ?? b);
  }, [updateSelectedBlock]);

  const handleMerge = useCallback(() => {
    const seed = Math.floor(Math.random() * 1e9);
    updateSelectedBlock((b) => mergeBlock(b, seed) ?? b);
  }, [updateSelectedBlock]);
```

Import them:

```tsx
import { mergeBlock, promoteParcel, subdivideBlock } from "@/lib/facade/promote";
```

Compute availability from the selected block, mirroring the pure guards exactly so a button is never offered for an operation that would return null:

```tsx
  const canSubdivide = useMemo(
    () =>
      !!selectedBlockObj &&
      selectedBlockObj.lots.length === 1 &&
      blockFrame(selectedBlockObj).length >= 2 * selectedBlockObj.gen.lotWidth.min,
    [selectedBlockObj],
  );

  const canMerge = useMemo(
    () =>
      !!selectedBlockObj &&
      selectedBlockObj.lots.length > 1 &&
      !selectedBlockObj.lots.some((l) => l.customized),
    [selectedBlockObj],
  );
```

Use whatever the file already calls the currently-selected block instead of `selectedBlockObj` if it differs, and import `blockFrame` from `@/lib/facade/blocks` if it is not already imported.

- [ ] **Step 2: Add the buttons**

In `FacadeControls.tsx`, beside the existing `<Toggle label="Reroll" on={false} onClick={onReroll} />` in the block panel, add:

```tsx
        {canSubdivide && (
          <Toggle label="Subdivide" on={false} onClick={onSubdivide} />
        )}
        {canMerge && <Toggle label="Merge to one lot" on={false} onClick={onMerge} />}
```

Thread `onSubdivide`, `onMerge`, `canSubdivide` and `canMerge` through the same prop chain `onReroll` already uses (declared at ~74 and ~894, forwarded at ~290). Hiding rather than disabling **Merge to one lot** is deliberate: the operation is refused when a lot is hand-edited, and a visible-but-dead button would invite the user to try to destroy their own work.

- [ ] **Step 3: Verify the gates**

```bash
npx tsc --noEmit && npx eslint src/components/facade/FacadeControls.tsx src/app/facade/page.tsx && npm test
```

- [ ] **Step 4: Verify visually**

`npm run dev` → **Demo place** → promote a **wide** building (30 m or so). Select the block. **Subdivide** must split it into a terrace of houses whose total frontage is unchanged and which all keep the parcel depth. **Merge to one lot** must return it to a single building. Hand-edit one lot in the terrace and confirm **Merge to one lot** disappears.

- [ ] **Step 5: Commit**

```bash
git add src/components/facade/FacadeControls.tsx src/app/facade/page.tsx
git commit -m "feat(facade): reversible subdivide/merge action on a block"
```

---

### Task 11: Document M4

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update the file layout**

In the `src/` tree block, add under `lib/facade/`:

```
      promote.ts       — real footprint → editable block (M4); subdivide/merge
```

and under `lib/geo/`:

```
      parcel.ts        — real parcel polygon → frontage line, facing, depth
```

- [ ] **Step 2: Extend the real-city section**

Rename the heading `## Real-city import (M1–M3)` to `## Real-city import (M1–M4)` and add a bullet:

```markdown
- **M4 promote to an editable lot** — click an imported footprint (Select tool)
  and the **Context building** inspector offers **Promote to lot** or
  **Demolish**. Promotion takes the PLOT from reality — frontage line, facing,
  width, depth — and the building from the generator (storeys, style, roof,
  colour). The real polygon rides on `FacadeBlock.parcel` and draws as a dashed
  plot boundary; the existing rectangular-box engine is untouched, so roofs,
  section strips, corners and basements all work on a promoted building. A
  reversible **Subdivide / Merge to one lot** action turns one plot into a
  terrace and back. Only 18% of real footprints are quads and even a min-area
  ORIENTED bbox misses ≥10% of plot area on 47% of them, which is why the true
  polygon is stored rather than a rectangle.
```

- [ ] **Step 3: Add the hard-won rules**

Append to the "Hard-won rules" list:

```markdown
- **A frontage is a CHAIN of edges, never one edge.** The longest single edge
  of a real footprint is only ~31% of its perimeter (median), so "pick the
  longest edge as the facade" does not work. `edgeChains` groups near-collinear
  runs first, and a smooth ring with no corner at all falls back to one chain
  per edge — otherwise it emits a single zero-length wrap-around frontage.
- **Never assume a footprint's winding.** Real OSM ways wind both ways, so the
  outward normal must come from the signed area per polygon.
- **`generateLot` redraws `massingDepth` from 6–12 m.** `rerollBlock` and
  `refit` both call it, so a promoted block's depth must be re-pinned through
  `applyParcelDepth` or a reroll silently pushes the building out through the
  back of its own parcel.
- **Promoted buildings are suppressed by a DERIVED set**, not by `hiddenIds` —
  which is what stops "Restore hidden" resurrecting a grey copy on top of a
  promoted block, and makes deleting the block bring the real building back.
```

- [ ] **Step 4: Update the tests line**

Add `parcel` and `promote` to the list of covered pure modules, and mention the
`fitFrontage` fixture guard beside the existing demo-fixture guard.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): document M4 promote-to-lot"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Invariant (`parcel` absent → byte-identical) | 3, 6, 7 (identity returns, dropped field, gated render) |
| `geo/parcel.ts` — `edgeChains`, `parcelArea` | 1 |
| `geo/parcel.ts` — `fitFrontage` | 2 |
| `facade/promote.ts` — `promoteParcel` | 4 |
| `facade/promote.ts` — subdivide/merge | 5 |
| `FacadeBlock.parcel` data model | 3 |
| Derived suppression set | 9 |
| Document persistence + malformed drop | 6 |
| Parcel outline render | 7 |
| `ContextBuildings` selection | 8 |
| `ContextBuildingPanel` | 9 |
| `selectMode` gate | 8 |
| Subdivide/Merge UI | 10 |
| Fixture guard | 2 |
| Clear-terrain survival | 9 (visual step 5.8) |
| AGENTS.md | 11 |

**Deviation from the spec, resolved here:** the spec's data model listed
`parcel: { source, outline }`. Task 3 adds a third field, `depth`. The reason is
in Task 3's rationale — `rerollBlock` and `refit` both call `generateLot`, which
redraws `massingDepth` from 6–12 m, so the parcel depth has to be recoverable
after those mutations, and re-deriving it from the live block line would give a
different answer once a node has been dragged. `applyParcelDepth` needs a stored
value.

**Placeholder scan:** no TBD/TODO; every code step carries real code; no "similar
to Task N" references.

**Type consistency:** `Vec2` is `[number, number]` in both `geo/parcel.ts` and
the `parcel.outline` field. `fitFrontage` returns `depth` unclamped in Task 2 and
`promoteParcel` clamps it in Task 4 — the tests in both tasks assert that split
explicitly. `applyParcelDepth` is defined in `blocks.ts` (Task 3) and consumed by
`generate.ts` (Task 3) and `promote.ts` (Task 5); it lives in `blocks.ts` rather
than `promote.ts` specifically to avoid a `generate.ts ↔ promote.ts` import
cycle.
