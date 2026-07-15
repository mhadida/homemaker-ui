# Street Network (Sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A drawable, typed street network (alley/street/road/boulevard) rendered as smooth paved streets with derived intersections and roundabout+monument junctions, coexisting additively with today's blocks.

**Architecture:** A new pure `src/lib/street/` module holds the data model (`Street`, `StreetNetwork`) and all geometry (smooth Catmull-Rom centreline, offset ribbon, derived intersections, roundabout). React/R3F components in `src/components/street/` render it into the existing plan + 3D panes. Page state gains a `streetNetwork` alongside `blocks`; nothing existing changes.

**Tech Stack:** Next.js 16, React 19 (Strict Mode), three 0.184, @react-three/fiber 9, @react-three/drei 10, vitest, TypeScript. Path alias `@/*` → `./src/*`.

## Global Constraints

- Pure-engine pattern: ALL geometry/topology lives in `src/lib/street/` as pure, unit-tested functions; components render what they return. No geometry in components.
- Derived-topology philosophy: store only decisions (`streets`, per-intersection roundabout choices); intersections are DERIVED, never stored (mirrors `deriveNodes`/`detectCorners`).
- Byte-identical invariant: an empty `streetNetwork` (default) renders nothing new and changes no existing path (blocks, pen, facades, save/load of old documents).
- Street-type defaults (metres): `alley` width 3.5 (no cars), `street` 9 (cars), `road` 14 (cars), `boulevard` 24 (cars). Each `Street` may override `width`.
- Plan-coord convention: all geometry is plan `[x, z]` (`Vec2 = [number, number]`), matching `src/lib/facade/blocks.ts`. The plan pane is top-down (up = −z).
- Mesh components are verified VISUALLY (browser checkpoint), not by unit test — matches the project (`AGENTS.md`). Pure geometry is unit-tested with vitest.
- Gates every task: `npx tsc --noEmit` clean; `npm test` all pass; `npm run lint` no new warnings beyond the 3-warning baseline (`prompt-parser` RoofType/DEFAULT_PARAMS, `python-server` unused-disable).
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Do NOT touch `public/default.glb` or `python/vendor/homemaker-addon`.

---

## File Structure

- Create `src/lib/street/types.ts` — `StreetType`, `StreetSpec`, `STREET_SPECS`, `Street`, `Monument`, `StreetNetwork`, `EMPTY_NETWORK`, `nextStreetId`, `effectiveWidth`.
- Create `src/lib/street/geometry.ts` — `smoothCentreline`, `streetRibbon`, `roundaboutRing`.
- Create `src/lib/street/intersections.ts` — `Intersection`, `deriveIntersections`.
- Create `src/lib/street/types.test.ts`, `geometry.test.ts`, `intersections.test.ts`.
- Create `src/components/street/StreetNetworkView.tsx` — network → meshes (used in both plan + 3D via `SceneContents`).
- Create `src/components/street/StreetRibbonMesh.tsx`, `RoundaboutMesh.tsx`, `MonumentMesh.tsx`.
- Modify `src/app/facade/page.tsx` — `streetNetwork` state + street-draw handlers + inspector wiring.
- Modify `src/components/facade/FacadeViewer.tsx` — a "Draw street" network mode + type selector + `StreetDrawSurface`; render `StreetNetworkView` in the panes.
- Modify `src/components/facade/SceneContents.tsx` — accept `streetNetwork` prop, render `StreetNetworkView`.
- Modify `src/lib/facade/document.ts` — extend `FacadeDocument`/`SceneState` with `streetNetwork` (versioned, additive).
- Modify `src/components/facade/FacadeControls.tsx` — a Street inspector (type/width; roundabout+monument on an intersection).
- Modify `AGENTS.md` — a Street Network feature bullet + the test-coverage line.

---

### Task 1: Street types + specs (`src/lib/street/types.ts`)

**Files:**
- Create: `src/lib/street/types.ts`
- Test: `src/lib/street/types.test.ts`

**Interfaces:**
- Produces: `StreetType = "alley"|"street"|"road"|"boulevard"`; `STREET_SPECS: Record<StreetType, {width:number; allowsCars:boolean; label:string}>`; `Vec2 = [number,number]`; `Street {id:string; type:StreetType; points:Vec2[]; width?:number}`; `Monument {kind:"obelisk"|"fountain"}`; `StreetNetwork {streets:Street[]; roundabouts:[string,Monument][]}`; `EMPTY_NETWORK: StreetNetwork`; `nextStreetId():string`; `effectiveWidth(s:Street):number`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/street/types.test.ts
import { describe, it, expect } from "vitest";
import { STREET_SPECS, effectiveWidth, nextStreetId, EMPTY_NETWORK } from "./types";

describe("STREET_SPECS", () => {
  it("has the four types with the agreed widths + car flags", () => {
    expect(STREET_SPECS.alley).toEqual({ width: 3.5, allowsCars: false, label: "Alley" });
    expect(STREET_SPECS.street.width).toBe(9);
    expect(STREET_SPECS.road.width).toBe(14);
    expect(STREET_SPECS.boulevard.width).toBe(24);
    expect(STREET_SPECS.street.allowsCars).toBe(true);
  });
});
describe("effectiveWidth", () => {
  it("uses the type default, overridden by the per-street width", () => {
    expect(effectiveWidth({ id: "s1", type: "street", points: [] })).toBe(9);
    expect(effectiveWidth({ id: "s1", type: "street", points: [], width: 12 })).toBe(12);
  });
});
describe("ids + empty network", () => {
  it("nextStreetId is unique and EMPTY_NETWORK is empty", () => {
    expect(nextStreetId()).not.toBe(nextStreetId());
    expect(EMPTY_NETWORK.streets).toEqual([]);
    expect(EMPTY_NETWORK.roundabouts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/street/types.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/street/types.ts
export type Vec2 = [number, number];

export type StreetType = "alley" | "street" | "road" | "boulevard";

export interface StreetSpec {
  width: number;
  allowsCars: boolean;
  label: string;
}

/** Type defaults (metres). A Street may override `width`. */
export const STREET_SPECS: Record<StreetType, StreetSpec> = {
  alley: { width: 3.5, allowsCars: false, label: "Alley" },
  street: { width: 9, allowsCars: true, label: "Street" },
  road: { width: 14, allowsCars: true, label: "Road" },
  boulevard: { width: 24, allowsCars: true, label: "Boulevard" },
};

export interface Street {
  id: string;
  type: StreetType;
  /** polyline vertices, plan coords [x, z]; rendered as a smooth curve */
  points: Vec2[];
  /** optional per-street override of the type default width */
  width?: number;
}

export interface Monument {
  kind: "obelisk" | "fountain";
}

export interface StreetNetwork {
  streets: Street[];
  /** roundabout choices: [derived intersection key, monument]. Sparse. */
  roundabouts: [string, Monument][];
}

export const EMPTY_NETWORK: StreetNetwork = { streets: [], roundabouts: [] };

export function effectiveWidth(s: Street): number {
  return s.width ?? STREET_SPECS[s.type].width;
}

let streetIdCounter = 0;
/** Session-unique ids. */
export function nextStreetId(): string {
  streetIdCounter += 1;
  return `street-${streetIdCounter}`;
}

/** After loading a saved network, bump the counter past every `street-N` id so
 * newly-drawn streets can't collide (mirrors reserveBlockIds). */
export function reserveStreetIds(streets: Street[]): void {
  for (const s of streets) {
    const m = /^street-(\d+)$/.exec(s.id);
    if (m) streetIdCounter = Math.max(streetIdCounter, Number(m[1]));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/street/types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/street/types.ts src/lib/street/types.test.ts
git commit -m "feat(street): street types + specs (sub-project 1 T1)"
```

---

### Task 2: Smooth centreline (`geometry.ts` — `smoothCentreline`)

**Files:**
- Create: `src/lib/street/geometry.ts`
- Test: `src/lib/street/geometry.test.ts`

**Interfaces:**
- Consumes: `Vec2` from `./types`.
- Produces: `smoothCentreline(points: Vec2[], samplesPerSegment?: number): Vec2[]` — Catmull-Rom sampled points through the vertices (endpoints preserved). ≤2 points → returned as-is (straight).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/street/geometry.test.ts
import { describe, it, expect } from "vitest";
import { smoothCentreline } from "./geometry";

describe("smoothCentreline", () => {
  it("passes a 2-point street through unchanged (straight)", () => {
    const pts = smoothCentreline([[0, 0], [10, 0]]);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([10, 0]);
    // collinear input stays collinear
    for (const [, z] of pts) expect(z).toBeCloseTo(0, 9);
  });

  it("samples a bent 3-point polyline into a smooth curve through its vertices", () => {
    const v: [number, number][] = [[0, 0], [10, 6], [20, 0]];
    const pts = smoothCentreline(v, 8);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([20, 0]);
    // the middle vertex is on the curve
    expect(pts.some((p) => Math.abs(p[0] - 10) < 1e-6 && Math.abs(p[1] - 6) < 1e-6)).toBe(true);
    // many samples → smooth
    expect(pts.length).toBeGreaterThan(10);
    // stays within the vertical envelope (no wild overshoot beyond the bend)
    for (const [, z] of pts) expect(z).toBeLessThanOrEqual(6 + 1e-6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/street/geometry.test.ts`
Expected: FAIL (`smoothCentreline` not exported).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/street/geometry.ts
import type { Vec2 } from "./types";

/** Centripetal-ish Catmull-Rom through the vertices (uniform), sampling each
 * segment. Endpoints are duplicated so the curve passes through the first and
 * last vertex. ≤ 2 points → straight (returned unchanged). */
export function smoothCentreline(points: Vec2[], samplesPerSegment = 10): Vec2[] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]] as Vec2);
  const out: Vec2[] = [];
  const p = points;
  const at = (i: number): Vec2 => p[Math.max(0, Math.min(p.length - 1, i))];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const steps = i === p.length - 2 ? samplesPerSegment : samplesPerSegment; // include last endpoint below
    for (let s = 0; s < steps; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const z =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, z]);
    }
  }
  out.push([p[p.length - 1][0], p[p.length - 1][1]]); // exact last vertex
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/street/geometry.test.ts`
Expected: PASS. (The Catmull-Rom passes through every control vertex, so the middle-vertex assertion holds at the segment boundary `t=0`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/street/geometry.ts src/lib/street/geometry.test.ts
git commit -m "feat(street): smooth Catmull-Rom centreline (sub-project 1 T2)"
```

---

### Task 3: Street ribbon (offset frontages) (`geometry.ts` — `streetRibbon`)

**Files:**
- Modify: `src/lib/street/geometry.ts`
- Test: `src/lib/street/geometry.test.ts` (add)

**Interfaces:**
- Consumes: `Vec2`, `smoothCentreline`.
- Produces: `streetRibbon(centreline: Vec2[], width: number): { left: Vec2[]; right: Vec2[] }` — the sampled centreline offset by ±width/2 (perpendicular per-vertex, using the averaged direction of adjacent segments). `left`/`right` are the two frontage lines Sub-project 2 will consume.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/lib/street/geometry.test.ts
import { streetRibbon } from "./geometry";

describe("streetRibbon", () => {
  it("offsets a straight street to two parallel frontages at ±width/2", () => {
    const cl = smoothCentreline([[0, 0], [10, 0]]); // along +x
    const { left, right } = streetRibbon(cl, 8); // half = 4
    // street runs along +x; normal is ±z → one side z=+4, the other z=-4
    for (const [, z] of left) expect(Math.abs(Math.abs(z) - 4)).toBeLessThan(1e-6);
    for (const [, z] of right) expect(Math.abs(Math.abs(z) - 4)).toBeLessThan(1e-6);
    // left and right are on opposite sides
    expect(Math.sign(left[0][1])).toBe(-Math.sign(right[0][1]));
    expect(left).toHaveLength(cl.length);
    expect(right).toHaveLength(cl.length);
  });

  it("a gently bent street produces non-self-intersecting frontages", () => {
    const cl = smoothCentreline([[0, 0], [10, 4], [20, 0]], 10);
    const { left, right } = streetRibbon(cl, 6);
    // every frontage point is ~3 (half width) from its centreline point
    for (let i = 0; i < cl.length; i++) {
      const dl = Math.hypot(left[i][0] - cl[i][0], left[i][1] - cl[i][1]);
      expect(dl).toBeCloseTo(3, 4);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/street/geometry.test.ts`
Expected: FAIL (`streetRibbon` not exported).

- [ ] **Step 3: Write the implementation**

```ts
// add to src/lib/street/geometry.ts
/** Per-vertex offset of a sampled centreline by ±half the width. The normal at
 * each vertex is the left-perpendicular of the averaged direction of the
 * adjacent segments, so joints stay smooth. Left = +normal, right = −normal. */
export function streetRibbon(
  centreline: Vec2[],
  width: number,
): { left: Vec2[]; right: Vec2[] } {
  const h = width / 2;
  const n = centreline.length;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const dir = (a: Vec2, b: Vec2): Vec2 => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
  };
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? dir(centreline[i - 1], centreline[i]) : dir(centreline[i], centreline[i + 1]);
    const next = i < n - 1 ? dir(centreline[i], centreline[i + 1]) : prev;
    let tx = prev[0] + next[0];
    let tz = prev[1] + next[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // left-perpendicular of the tangent (plan coords)
    const nx = -tz;
    const nz = tx;
    const c = centreline[i];
    left.push([c[0] + nx * h, c[1] + nz * h]);
    right.push([c[0] - nx * h, c[1] - nz * h]);
  }
  return { left, right };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/street/geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/street/geometry.ts src/lib/street/geometry.test.ts
git commit -m "feat(street): offset ribbon → frontage lines (sub-project 1 T3)"
```

---

### Task 4: Derived intersections (`src/lib/street/intersections.ts`)

**Files:**
- Create: `src/lib/street/intersections.ts`
- Test: `src/lib/street/intersections.test.ts`

**Interfaces:**
- Consumes: `Street`, `StreetNetwork`, `Vec2` from `./types`.
- Produces: `Intersection {key:string; pos:Vec2; incident:{streetId:string; vertex:number}[]}`; `deriveIntersections(net: StreetNetwork): Intersection[]`.

Model (v1): an intersection is a plan point shared (exact float equality, the
same "coincidence weld" as `deriveNodes`) by vertices of ≥2 DIFFERENT streets.
Mid-span crossings are deferred (Sub-project 4).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/street/intersections.test.ts
import { describe, it, expect } from "vitest";
import { deriveIntersections } from "./intersections";
import type { StreetNetwork } from "./types";

const net = (streets: StreetNetwork["streets"]): StreetNetwork => ({ streets, roundabouts: [] });

describe("deriveIntersections", () => {
  it("two streets sharing an endpoint → one intersection, both incident", () => {
    const is = deriveIntersections(net([
      { id: "a", type: "street", points: [[0, 0], [10, 0]] },
      { id: "b", type: "street", points: [[10, 0], [10, 10]] },
    ]));
    expect(is).toHaveLength(1);
    expect(is[0].pos).toEqual([10, 0]);
    expect(is[0].incident.map((i) => i.streetId).sort()).toEqual(["a", "b"]);
  });

  it("disjoint streets → no intersection", () => {
    const is = deriveIntersections(net([
      { id: "a", type: "street", points: [[0, 0], [10, 0]] },
      { id: "b", type: "street", points: [[0, 20], [10, 20]] },
    ]));
    expect(is).toHaveLength(0);
  });

  it("a three-street junction at one point → one intersection, three incident", () => {
    const is = deriveIntersections(net([
      { id: "a", type: "street", points: [[0, 0], [5, 5]] },
      { id: "b", type: "street", points: [[10, 0], [5, 5]] },
      { id: "c", type: "street", points: [[5, 5], [5, 15]] },
    ]));
    expect(is).toHaveLength(1);
    expect(is[0].incident).toHaveLength(3);
  });

  it("a single street touching itself is not an intersection (needs 2+ streets)", () => {
    const is = deriveIntersections(net([
      { id: "a", type: "street", points: [[0, 0], [10, 0], [0, 0]] },
    ]));
    expect(is).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/street/intersections.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/street/intersections.ts
import type { StreetNetwork, Vec2 } from "./types";

export interface Intersection {
  /** stable key: the shared point, rounded to a weld grid */
  key: string;
  pos: Vec2;
  incident: { streetId: string; vertex: number }[];
}

const keyOf = (p: Vec2) => `${p[0]}:${p[1]}`;

/** Intersections are DERIVED: a plan point shared (exact equality) by vertices
 * of ≥ 2 DIFFERENT streets. Mid-span crossings are deferred. */
export function deriveIntersections(net: StreetNetwork): Intersection[] {
  const byPoint = new Map<string, { pos: Vec2; incident: { streetId: string; vertex: number }[] }>();
  for (const s of net.streets) {
    s.points.forEach((p, vertex) => {
      const k = keyOf(p);
      let e = byPoint.get(k);
      if (!e) {
        e = { pos: [p[0], p[1]], incident: [] };
        byPoint.set(k, e);
      }
      // a street may pass its own point twice — record once per (street,vertex)
      e.incident.push({ streetId: s.id, vertex });
    });
  }
  const out: Intersection[] = [];
  for (const [key, e] of byPoint) {
    const distinctStreets = new Set(e.incident.map((i) => i.streetId));
    if (distinctStreets.size >= 2) out.push({ key, pos: e.pos, incident: e.incident });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/street/intersections.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/street/intersections.ts src/lib/street/intersections.test.ts
git commit -m "feat(street): derived intersections (sub-project 1 T4)"
```

---

### Task 5: Roundabout ring geometry (`geometry.ts` — `roundaboutRing`)

**Files:**
- Modify: `src/lib/street/geometry.ts`
- Test: `src/lib/street/geometry.test.ts` (add)

**Interfaces:**
- Produces: `roundaboutRing(centre: Vec2, outerR: number, islandR: number): { outer: Vec2[]; island: Vec2[] }` — two closed polygon loops (32-gon) for the paved ring outer edge and the central island.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/lib/street/geometry.test.ts
import { roundaboutRing } from "./geometry";

describe("roundaboutRing", () => {
  it("returns two centred closed loops of the given radii", () => {
    const { outer, island } = roundaboutRing([5, 5], 10, 3);
    expect(outer).toHaveLength(32);
    expect(island).toHaveLength(32);
    for (const p of outer) expect(Math.hypot(p[0] - 5, p[1] - 5)).toBeCloseTo(10, 6);
    for (const p of island) expect(Math.hypot(p[0] - 5, p[1] - 5)).toBeCloseTo(3, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/street/geometry.test.ts`
Expected: FAIL (`roundaboutRing` not exported).

- [ ] **Step 3: Write the implementation**

```ts
// add to src/lib/street/geometry.ts
const RING_SEGMENTS = 32;

/** Two centred 32-gon loops: the paved ring's outer edge and the central
 * island. The monument sits at `centre`. Note: uses no Math.random/Date. */
export function roundaboutRing(
  centre: Vec2,
  outerR: number,
  islandR: number,
): { outer: Vec2[]; island: Vec2[] } {
  const loop = (r: number): Vec2[] =>
    Array.from({ length: RING_SEGMENTS }, (_, i): Vec2 => {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      return [centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r];
    });
  return { outer: loop(outerR), island: loop(islandR) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/street/geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/street/geometry.ts src/lib/street/geometry.test.ts
git commit -m "feat(street): roundabout ring geometry (sub-project 1 T5)"
```

---

### Task 6: Rendering components (`src/components/street/`)

**Files:**
- Create: `src/components/street/MonumentMesh.tsx`
- Create: `src/components/street/RoundaboutMesh.tsx`
- Create: `src/components/street/StreetRibbonMesh.tsx`
- Create: `src/components/street/StreetNetworkView.tsx`

**Interfaces:**
- Consumes: `Street`, `StreetNetwork`, `Monument`, `STREET_SPECS`, `effectiveWidth` from `@/lib/street/types`; `smoothCentreline`, `streetRibbon`, `roundaboutRing` from `@/lib/street/geometry`; `deriveIntersections` from `@/lib/street/intersections`.
- Produces: `<StreetNetworkView network={StreetNetwork} />` — a self-contained R3F group; `<MonumentMesh centre kind />`.

**Verification:** these are VISUAL (no unit test). Each step's test = `npx tsc --noEmit` clean, then a browser checkpoint at the end of Task 8.

- [ ] **Step 1: MonumentMesh** — obelisk (tapered shaft + pyramidion) / fountain (round basin + jet), stone-coloured, centred at `centre` on the ground.

```tsx
// src/components/street/MonumentMesh.tsx
"use client";
import type { Monument } from "@/lib/street/types";

const STONE = "#8d867a";
const WATER = "#5f7d86";

export default function MonumentMesh({
  centre,
  kind,
}: {
  centre: [number, number];
  kind: Monument["kind"];
}) {
  const [x, z] = centre;
  if (kind === "obelisk") {
    return (
      <group position={[x, 0, z]}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[1.4, 0.6, 1.4]} />
          <meshStandardMaterial color={STONE} roughness={0.9} />
        </mesh>
        <mesh position={[0, 3.4, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.6, 5.6, 4]} />
          <meshStandardMaterial color={STONE} roughness={0.85} />
        </mesh>
        <mesh position={[0, 6.5, 0]} castShadow>
          <coneGeometry args={[0.28, 0.8, 4]} />
          <meshStandardMaterial color={STONE} roughness={0.85} />
        </mesh>
      </group>
    );
  }
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.2, 2.4, 0.5, 24]} />
        <meshStandardMaterial color={STONE} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[1.9, 1.9, 0.16, 24]} />
        <meshStandardMaterial color={WATER} roughness={0.25} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.24, 1.4, 12]} />
        <meshStandardMaterial color={STONE} roughness={0.85} />
      </mesh>
    </group>
  );
}
```

- [ ] **Step 2: StreetRibbonMesh** — the paved surface between the two frontage lines, as a triangle strip, typed colour; a boulevard also gets a thin central median.

```tsx
// src/components/street/StreetRibbonMesh.tsx
"use client";
import { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { Street } from "@/lib/street/types";
import { STREET_SPECS, effectiveWidth } from "@/lib/street/types";
import { smoothCentreline, streetRibbon } from "@/lib/street/geometry";

const PAVING: Record<Street["type"], string> = {
  alley: "#6f6a63",
  street: "#4a4a4c",
  road: "#3f3f44",
  boulevard: "#3a3a40",
};

export default function StreetRibbonMesh({ street }: { street: Street }) {
  const geo = useMemo(() => {
    const cl = smoothCentreline(street.points);
    if (cl.length < 2) return null;
    const { left, right } = streetRibbon(cl, effectiveWidth(street));
    const pos: number[] = [];
    const Y = 0.02; // just above the ground plane
    for (let i = 0; i < cl.length - 1; i++) {
      const l0 = left[i], l1 = left[i + 1], r0 = right[i], r1 = right[i + 1];
      pos.push(l0[0], Y, l0[1], r0[0], Y, r0[1], r1[0], Y, r1[1]);
      pos.push(l0[0], Y, l0[1], r1[0], Y, r1[1], l1[0], Y, l1[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }, [street]);
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial
        color={PAVING[street.type]}
        roughness={0.95}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}

// note: STREET_SPECS import kept for the median follow-up; remove if unused to
// keep lint clean, or add the boulevard median strip here.
```

> Implementer: if `STREET_SPECS` ends up unused, drop the import (lint). The
> boulevard median is optional polish — a thin lighter strip along the
> centreline; add only if it doesn't risk the task.

- [ ] **Step 3: RoundaboutMesh** — paved ring + island + monument, from `roundaboutRing`.

```tsx
// src/components/street/RoundaboutMesh.tsx
"use client";
import { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { Monument } from "@/lib/street/types";
import { roundaboutRing } from "@/lib/street/geometry";
import MonumentMesh from "./MonumentMesh";

export default function RoundaboutMesh({
  centre,
  outerR,
  islandR,
  monument,
}: {
  centre: [number, number];
  outerR: number;
  islandR: number;
  monument: Monument;
}) {
  const geo = useMemo(() => {
    const { outer, island } = roundaboutRing(centre, outerR, islandR);
    const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], p[1])));
    shape.holes.push(new THREE.Path(island.map((p) => new THREE.Vector2(p[0], p[1]))));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2); // shape is XY → lay flat on XZ
    g.translate(0, 0.021, 0);
    return g;
  }, [centre, outerR, islandR]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <group>
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial color="#3f3f44" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <MonumentMesh centre={centre} kind={monument.kind} />
    </group>
  );
}
```

> Implementer note: `ShapeGeometry` builds in the XY plane; `rotateX(π/2)` maps
> +Y→+Z (verify the winding/normal renders up — if it faces down, use
> `-Math.PI/2`). This is a visual check in Task 8.

- [ ] **Step 4: StreetNetworkView** — assemble ribbons + roundabouts.

```tsx
// src/components/street/StreetNetworkView.tsx
"use client";
import { useMemo } from "react";
import type { StreetNetwork, Monument } from "@/lib/street/types";
import { deriveIntersections } from "@/lib/street/intersections";
import StreetRibbonMesh from "./StreetRibbonMesh";
import RoundaboutMesh from "./RoundaboutMesh";

export default function StreetNetworkView({ network }: { network: StreetNetwork }) {
  const roundabouts = useMemo(() => new Map(network.roundabouts), [network.roundabouts]);
  const intersections = useMemo(() => deriveIntersections(network), [network]);
  return (
    <group>
      {network.streets.map((s) => (
        <StreetRibbonMesh key={s.id} street={s} />
      ))}
      {intersections.map((it) => {
        const m: Monument | undefined = roundabouts.get(it.key);
        if (!m) return null;
        return (
          <RoundaboutMesh
            key={it.key}
            centre={it.pos}
            outerR={9}
            islandR={3}
            monument={m}
          />
        );
      })}
    </group>
  );
}
```

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit` (expect clean), `npm run lint` (expect no new warnings).

```bash
git add src/components/street/
git commit -m "feat(street): network render components (sub-project 1 T6)"
```

---

### Task 7: Page state + draw mode + save/load

**Files:**
- Modify: `src/app/facade/page.tsx`
- Modify: `src/components/facade/FacadeViewer.tsx`
- Modify: `src/components/facade/SceneContents.tsx`
- Modify: `src/lib/facade/document.ts`
- Test: `src/lib/facade/document.test.ts` (add a streetNetwork round-trip)

**Interfaces:**
- Consumes: `StreetNetwork`, `EMPTY_NETWORK`, `nextStreetId`, `reserveStreetIds`, `Street`, `StreetType` from `@/lib/street/types`; `StreetNetworkView`.
- Produces: page-level `streetNetwork` state + `handleCommitStreet(type, points)`; `SceneContents` renders `<StreetNetworkView>`.

- [ ] **Step 1: Extend the scene document (TDD)** — add `streetNetwork` to `SceneState`/`FacadeDocument`; serialize/deserialize; default `EMPTY_NETWORK` when absent (old saves).

Add to `src/lib/facade/document.test.ts`:

```ts
it("round-trips a streetNetwork; absent → empty", () => {
  const withNet = {
    ...scene(),
    streetNetwork: { streets: [{ id: "street-1", type: "street", points: [[0,0],[10,0]] }], roundabouts: [] },
  };
  const res = fromJSON(toJSON(withNet as never));
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.scene.streetNetwork.streets).toHaveLength(1);
  // old doc with no streetNetwork → empty network, still ok
  const old = deserializeScene({ version: 1, blocks: (serializeScene(scene()) as never).blocks });
  expect(old.ok).toBe(true);
  if (old.ok) expect(old.scene.streetNetwork.streets).toEqual([]);
});
```

Then extend `document.ts`: `SceneState`/`FacadeDocument` gain `streetNetwork: StreetNetwork`; `serializeScene` includes it; `deserializeScene` reads `doc.streetNetwork` or falls back to `EMPTY_NETWORK` (validate `streets` is an array, else empty). Keep `SCENE_VERSION = 1` (additive/optional; absent tolerated).

Run: `npx vitest run src/lib/facade/document.test.ts` → PASS.

- [ ] **Step 2: Page state** — in `src/app/facade/page.tsx`:
  - `const [streetNetwork, setStreetNetwork] = useState<StreetNetwork>(EMPTY_NETWORK);`
  - `const handleCommitStreet = useCallback((type: StreetType, points: Vec2[]) => setStreetNetwork((n) => ({ ...n, streets: [...n.streets, { id: nextStreetId(), type, points }] })), []);`
  - Thread `streetNetwork` into `applyScene` (loaded doc) with `reserveStreetIds(s.streetNetwork.streets)`; include it in `handleSave`'s `toJSON({...})` and the autosave effect.
  - Pass `streetNetwork` + `onCommitStreet={handleCommitStreet}` to `<FacadeViewer>`.

- [ ] **Step 3: SceneContents** — accept `streetNetwork?: StreetNetwork` prop; render `{streetNetwork && <StreetNetworkView network={streetNetwork} />}` inside the scene (world space, before the ground `<group>`).

- [ ] **Step 4: FacadeViewer** — thread `streetNetwork` to each `SceneContents`. Add a **street draw mode** in the plan pane: a `StreetDrawSurface` (mirror `PenSurface`: click chains vertices, Escape/close ends, commits `onCommitStreet(activeType, points)`), plus a **type selector** (alley/street/road/boulevard) shown when the mode is on, and a mode toggle button beside Draw/Select. The in-progress polyline renders via `smoothCentreline` as a type-colored dashed `<Line>`. Street mode is mutually exclusive with block-draw + select modes.

- [ ] **Step 5: Verify + commit** — `npx tsc --noEmit`, `npm test`, `npm run lint`; browser: draw one street of each type, confirm paved ribbons render.

```bash
git add src/app/facade/page.tsx src/components/facade/FacadeViewer.tsx src/components/facade/SceneContents.tsx src/lib/facade/document.ts src/lib/facade/document.test.ts
git commit -m "feat(street): page state, draw mode, save/load (sub-project 1 T7)"
```

---

### Task 8: Street inspector + roundabout/monument + advisory + docs + review/merge

**Files:**
- Modify: `src/components/facade/FacadeControls.tsx`
- Modify: `src/app/facade/page.tsx`
- Modify: `AGENTS.md`

- [ ] **Step 1: Selection + inspector** — clicking a street ribbon selects it (a `selectedStreet: string | null` page state, set from a ribbon `onClick`). `FacadeControls` shows a **Street** inspector when a street is selected: change **type** (4 toggles), **width override** slider (± around the type default), **Delete street**. Clicking a derived intersection selects it → toggle **Roundabout** on/off + choose **Monument** (obelisk/fountain), writing `network.roundabouts` (a `[key, monument]` pair).

- [ ] **Step 2: Krier/Alexander advisory** — a pure helper `streetAdvisory(street): string | null` in `src/lib/street/geometry.ts` (+ test): returns a hint when an `alley`/`street` has a single straight run longer than a threshold (e.g. 40 m with no intermediate vertex), or a `boulevard` longer than a threshold (e.g. 120 m) with no roundabout on it. Show it as subtle muted text in the inspector. Advisory only — never blocks.

Test:
```ts
it("flags a long straight street and a long uninterrupted boulevard", () => {
  expect(streetAdvisory({ id: "a", type: "street", points: [[0,0],[100,0]] })).toMatch(/curve|long/i);
  expect(streetAdvisory({ id: "b", type: "alley", points: [[0,0],[5,1],[10,0]] })).toBeNull();
});
```

- [ ] **Step 3: Docs** — add a **Street Network** bullet to `AGENTS.md` (the `/facade` feature list) describing the module, types, coexistence, and the deferred sub-projects; add `src/lib/street/*.test.ts` to the test-coverage line.

- [ ] **Step 4: Browser checkpoint** — draw a small network: two streets meeting at a junction, make it a roundabout with an obelisk, a boulevard, an alley with a gentle bend. Confirm: smooth curves, typed widths, paved ribbons, roundabout + monument, no console errors. Confirm an empty network is byte-identical (blocks/buildings unaffected).

- [ ] **Step 5: Gates + final review + merge** — `npx tsc --noEmit`, `npm test`, `npm run lint` all green. Dispatch the final whole-branch review (superpowers:requesting-code-review). Address findings. Then finish per superpowers:finishing-a-development-branch (merge to main + push → Vercel prod).

```bash
git add src/components/facade/FacadeControls.tsx src/app/facade/page.tsx src/lib/street/geometry.ts src/lib/street/geometry.test.ts AGENTS.md
git commit -m "feat(street): inspector, roundabout/monument, advisory, docs (sub-project 1 T8)"
```

---

## Self-Review

**Spec coverage:** street types+specs (T1) ✓; polyline+smooth render (T2) ✓; ribbon/frontages (T3) ✓; derived intersections (T4) ✓; roundabout+monument (T5,T6,T8) ✓; typed paved rendering (T6) ✓; draw mode + type selector (T7) ✓; save/load additive (T7) ✓; inspector + roundabout/monument choice (T8) ✓; Krier/Alexander advisory (T8) ✓; coexistence/byte-identical (T7 + Global Constraints) ✓. Deferred items (blocks/plots/buildings, mid-span crossings, plazas, hard curve enforcement) are correctly out of scope.

**Placeholder scan:** the Task 3 test calls are now literal `toBeLessThan(1e-6)`; the optional boulevard median in T6 is marked optional; no other placeholders.

**Type consistency:** `Vec2`, `Street{id,type,points,width?}`, `StreetNetwork{streets,roundabouts:[string,Monument][]}`, `effectiveWidth`, `nextStreetId`, `reserveStreetIds`, `smoothCentreline`, `streetRibbon(→{left,right})`, `roundaboutRing(→{outer,island})`, `deriveIntersections(→Intersection{key,pos,incident})`, `StreetNetworkView({network})`, `MonumentMesh({centre,kind})` are consistent across tasks.
