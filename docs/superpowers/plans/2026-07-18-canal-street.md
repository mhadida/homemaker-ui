# Canal Street Type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth street type `canal` — recessed level water + stone quay walls + walkable sidewalks, canal-house frontages, and an arched footbridge at every canal↔land crossing.

**Architecture:** All geometry is pure in a new `src/lib/street/canal.ts` (offset ribbons via the existing mitered `streetRibbon`, a per-canal level water Y, a bridge-placement predicate, and a humpback arch soup), unit-tested in `canal.test.ts`. Two new R3F components (`CanalMesh`, `BridgeMesh`) render it; `StreetNetworkView` routes canal streets and places bridges. One `bankHalf` change in `frontage.ts` lines canal houses along the banks.

**Tech Stack:** Next.js 16, React 19, three 0.184, @react-three/fiber 9, TypeScript, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-canal-street-design.md`. Exact constants: `WATER_WIDTH = 14`, `CANAL_QUAY = 0.5`, `CANAL_SIDEWALK = 3`, `CANAL_WATER_DEPTH = 1.2`, `BRIDGE_DECK_WIDTH = 3`, `BRIDGE_RISE = 1.5`, `minRadius = 45`, `bank half-offset = 10.5`, `bridge span = WATER_WIDTH + 2·QUAY = 15`.
- **Byte-identical invariant:** a scene with no `canal` streets must produce unchanged output. `bankHalf`'s non-canal branch must equal the current formula (`effectiveWidth/2 + PAVEMENT_GAP`) exactly.
- Water is **always level** (one horizontal Y per canal). Flat ground (`slope: 0`) must stay byte-identical (`waterY == grade − WATER_DEPTH`).
- Never touch `python/vendor/homemaker-addon` or `public/default.glb`.
- Pure modules are unit-tested (vitest); R3F components are verified visually (project convention — AGENTS.md).
- Gates each task: `npx vitest run src/lib/street/`, `npx tsc --noEmit`, `npx eslint src` (baseline is exactly 3 pre-existing warnings — add none).
- Every commit ends with the trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017JZPbzBcWyfSV3Zxr8XXUH
  ```

---

## File Structure

- **Create** `src/lib/street/canal.ts` — pure canal geometry: constants, `canalOffsets`, `canalWaterY`, `BridgePlacement`, `bridgesFor`, `bridgeArch`.
- **Create** `src/lib/street/canal.test.ts` — unit tests for all of the above.
- **Create** `src/components/street/CanalMesh.tsx` — renders one canal (water + quay + sidewalk).
- **Create** `src/components/street/BridgeMesh.tsx` — renders one arch.
- **Modify** `src/lib/street/types.ts` — add `"canal"` to `StreetType` + `STREET_SPECS`.
- **Modify** `src/components/street/StreetRibbonMesh.tsx` — add a `canal` arm to `PAVING` (tsc-forced).
- **Modify** `src/components/facade/FacadeViewer.tsx` — add a `canal` arm to `STREET_PREVIEW_COLORS` (tsc-forced).
- **Modify** `src/components/facade/FacadeControls.tsx` — add `Canal` to `STREET_TYPES`.
- **Modify** `src/components/street/StreetNetworkView.tsx` — route canal streets → `CanalMesh`; render `BridgeMesh` per `bridgesFor`.
- **Modify** `src/lib/street/frontage.ts` — `bankHalf` set-back.
- **Modify** `src/lib/street/frontage.test.ts` — canal offset + non-canal-unchanged tests.

---

## Task 1: Canal type, constants, offset ribbons, selector

**Files:**
- Modify: `src/lib/street/types.ts:3` (union), `:13-18` (`STREET_SPECS`)
- Create: `src/lib/street/canal.ts`
- Create: `src/lib/street/canal.test.ts`
- Modify: `src/components/street/StreetRibbonMesh.tsx:9-14` (`PAVING`)
- Modify: `src/components/facade/FacadeViewer.tsx:360` (`STREET_PREVIEW_COLORS`)
- Modify: `src/components/facade/FacadeControls.tsx:1121-1126` (`STREET_TYPES`)

**Interfaces:**
- Consumes: `streetRibbon(centreline: Vec2[], width: number, closed?: boolean): {left: Vec2[]; right: Vec2[]}` and `Vec2` from `./geometry`/`./types`; `effectiveWidth(s: Street): number` from `./types`.
- Produces: `CANAL_QUAY`, `CANAL_SIDEWALK`, `CANAL_WATER_DEPTH`, `BRIDGE_DECK_WIDTH`, `BRIDGE_RISE`, `type Vec3`, and `canalOffsets(centreline: Vec2[], width: number): {water; quayFoot; bank}` (each `{left: Vec2[]; right: Vec2[]}`).

- [ ] **Step 1: Write the failing test** — append to a new `src/lib/street/canal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canalOffsets } from "./canal";
import { STREET_SPECS } from "./types";
import type { Vec2 } from "./types";

describe("canal type + offsets", () => {
  it("canal STREET_SPECS: water 14, no cars, gentle radius", () => {
    expect(STREET_SPECS.canal).toEqual({
      width: 14, allowsCars: false, label: "Canal", minRadius: 45,
    });
  });

  it("canalOffsets places water/quay/bank edges at the right half-widths", () => {
    const cl: Vec2[] = [[0, 0], [10, 0]]; // along +x, normal ±z
    const o = canalOffsets(cl, 14);
    expect(Math.abs(o.water.left[0][1])).toBeCloseTo(7, 6);      // 14/2
    expect(Math.abs(o.quayFoot.left[0][1])).toBeCloseTo(7.5, 6); // +0.5
    expect(Math.abs(o.bank.left[0][1])).toBeCloseTo(10.5, 6);    // +3
    expect(Math.sign(o.water.left[0][1])).toBe(-Math.sign(o.water.right[0][1]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/street/canal.test.ts`
Expected: FAIL — `STREET_SPECS.canal` undefined / cannot import `canalOffsets`.

- [ ] **Step 3: Add the type + spec.** In `src/lib/street/types.ts` change line 3 to:

```ts
export type StreetType = "alley" | "street" | "road" | "boulevard" | "canal";
```

and add to `STREET_SPECS` (after the `boulevard` row):

```ts
  canal: { width: 14, allowsCars: false, label: "Canal", minRadius: 45 },
```

- [ ] **Step 4: Create `src/lib/street/canal.ts`:**

```ts
import type { Street, StreetNetwork, Vec2 } from "./types";
import { effectiveWidth } from "./types";
import { streetRibbon, closestPointOnSegment } from "./geometry";
import type { Intersection } from "./intersections";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";

/** Canal cross-section constants (metres). */
export const CANAL_QUAY = 0.5;        // quay-wall thickness
export const CANAL_SIDEWALK = 3;      // walkable band each bank
export const CANAL_WATER_DEPTH = 1.2; // min water depth below the lowest bank
export const BRIDGE_DECK_WIDTH = 3;   // footbridge breadth (along the canal)
export const BRIDGE_RISE = 1.5;       // arch apex above bank grade

export type Vec3 = [number, number, number];

/** The three offset ribbons of a canal: water edge (½W), quay foot (½W+quay),
 * bank / building line (½W+quay+sidewalk). Each is a mitered streetRibbon. */
export function canalOffsets(centreline: Vec2[], width: number) {
  return {
    water: streetRibbon(centreline, width),
    quayFoot: streetRibbon(centreline, width + 2 * CANAL_QUAY),
    bank: streetRibbon(centreline, width + 2 * CANAL_QUAY + 2 * CANAL_SIDEWALK),
  };
}
```

- [ ] **Step 5: Add the tsc-forced `canal` arms.** `StreetRibbonMesh.tsx:9` `PAVING`, add:

```ts
  canal: "#2f6b8f",
```

`FacadeViewer.tsx:360` `STREET_PREVIEW_COLORS`, add the same `canal: "#2f6b8f",` line. And in `FacadeControls.tsx:1121` `STREET_TYPES`, add:

```ts
  { id: "canal", label: "Canal" },
```

- [ ] **Step 6: Run tests + gates**

Run: `npx vitest run src/lib/street/canal.test.ts` → PASS.
Run: `npx tsc --noEmit` → exit 0 (all `Record<StreetType>` arms present).
Run: `npx eslint src` → 3 baseline warnings, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/street/types.ts src/lib/street/canal.ts src/lib/street/canal.test.ts \
  src/components/street/StreetRibbonMesh.tsx src/components/facade/FacadeViewer.tsx \
  src/components/facade/FacadeControls.tsx
git commit -m "feat(canal): canal StreetType + specs + offset ribbons (T1)"
```

---

## Task 2: Level water + CanalMesh rendering

**Files:**
- Modify: `src/lib/street/canal.ts` (add `canalWaterY`)
- Modify: `src/lib/street/canal.test.ts` (add water-level tests)
- Create: `src/components/street/CanalMesh.tsx`
- Modify: `src/components/street/StreetNetworkView.tsx` (route canal → CanalMesh)

**Interfaces:**
- Consumes: `canalOffsets` (T1); `groundHeightAt(x, z, g: Ground): number` and `type Ground` from `@/lib/facade/terrain`; `filletCentreline(points, minRadius, samples?, closed?)`, `minRadiusOf`, `effectiveWidth`.
- Produces: `canalWaterY(centreline: Vec2[], width: number, ground: Ground): number`.

- [ ] **Step 1: Write the failing test** — append to `canal.test.ts`:

```ts
import { canalWaterY, canalOffsets as _o, CANAL_WATER_DEPTH } from "./canal";
import { groundHeightAt } from "@/lib/facade/terrain";

describe("canal level water", () => {
  it("sits WATER_DEPTH below grade on flat ground", () => {
    const cl: Vec2[] = [[0, 0], [20, 0]];
    expect(canalWaterY(cl, 14, { slope: 0, azimuth: 0 })).toBeCloseTo(-CANAL_WATER_DEPTH, 6);
  });

  it("is level and below every bank point on a slope (never floods)", () => {
    const cl: Vec2[] = [[0, 0], [40, 0]];
    const g = { slope: 0.1, azimuth: 0 };
    const wY = canalWaterY(cl, 14, g);
    const { bank } = canalOffsets(cl, 14);
    for (const p of [...bank.left, ...bank.right]) {
      expect(groundHeightAt(p[0], p[1], g)).toBeGreaterThanOrEqual(wY - 1e-9);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/street/canal.test.ts`
Expected: FAIL — `canalWaterY` is not exported.

- [ ] **Step 3: Implement `canalWaterY`** in `canal.ts`:

```ts
/** The single level water-surface Y: WATER_DEPTH below the lowest bank-edge
 * ground point, so the level pool never floods. Flat ground → grade − depth. */
export function canalWaterY(centreline: Vec2[], width: number, ground: Ground): number {
  const { bank } = canalOffsets(centreline, width);
  let minG = Infinity;
  for (const p of [...bank.left, ...bank.right]) {
    const g = groundHeightAt(p[0], p[1], ground);
    if (g < minG) minG = g;
  }
  return minG - CANAL_WATER_DEPTH;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/street/canal.test.ts` → PASS.

- [ ] **Step 5: Create `src/components/street/CanalMesh.tsx`:**

```tsx
"use client";
import { useMemo, useEffect, useState } from "react";
import * as THREE from "three";
import type { Street } from "@/lib/street/types";
import { effectiveWidth, minRadiusOf } from "@/lib/street/types";
import { filletCentreline } from "@/lib/street/geometry";
import { canalOffsets, canalWaterY } from "@/lib/street/canal";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";

const WATER = "#2f6b8f";
const QUAY = "#6b6660";   // stone retaining wall
const WALK = "#8a857c";   // light-stone sidewalk
const SELECTED = "#3b82f6";

export default function CanalMesh({
  street, selected = false, onSelect, ground,
}: {
  street: Street;
  selected?: boolean;
  onSelect?: () => void;
  ground: Ground;
}) {
  const [hover, setHover] = useState(false);
  const geos = useMemo(() => {
    const cl = filletCentreline(street.points, minRadiusOf(street), 8, street.closed);
    if (cl.length < 2) return null;
    const w = effectiveWidth(street);
    const { water, quayFoot, bank } = canalOffsets(cl, w);
    const waterY = canalWaterY(cl, w, ground);
    const gy = (p: [number, number]) => groundHeightAt(p[0], p[1], ground);

    const waterPos: number[] = [];
    const quayPos: number[] = [];
    const walkPos: number[] = [];
    const quad = (arr: number[], a: number[], b: number[], c: number[], d: number[]) =>
      arr.push(...a, ...b, ...c, ...a, ...c, ...d);

    for (let i = 0; i < cl.length - 1; i++) {
      // water: flat level quad strip between the two water edges
      const wl0 = water.left[i], wl1 = water.left[i + 1];
      const wr0 = water.right[i], wr1 = water.right[i + 1];
      quad(waterPos,
        [wl0[0], waterY, wl0[1]], [wr0[0], waterY, wr0[1]],
        [wr1[0], waterY, wr1[1]], [wl1[0], waterY, wl1[1]]);

      for (const side of ["left", "right"] as const) {
        const we0 = water[side][i], we1 = water[side][i + 1];
        const qf0 = quayFoot[side][i], qf1 = quayFoot[side][i + 1];
        const be0 = bank[side][i], be1 = bank[side][i + 1];
        // quay inner wall: water edge from waterY up to draped bank grade
        quad(quayPos,
          [we0[0], waterY, we0[1]], [we1[0], waterY, we1[1]],
          [we1[0], gy(we1), we1[1]], [we0[0], gy(we0), we0[1]]);
        // quay top cap: water edge → quay foot at grade
        quad(quayPos,
          [we0[0], gy(we0), we0[1]], [we1[0], gy(we1), we1[1]],
          [qf1[0], gy(qf1), qf1[1]], [qf0[0], gy(qf0), qf0[1]]);
        // sidewalk: quay foot → bank edge at grade
        quad(walkPos,
          [qf0[0], gy(qf0), qf0[1]], [qf1[0], gy(qf1), qf1[1]],
          [be1[0], gy(be1), be1[1]], [be0[0], gy(be0), be0[1]]);
      }
    }
    const mk = (pos: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    };
    return { water: mk(waterPos), quay: mk(quayPos), walk: mk(walkPos) };
  }, [street, ground]);

  useEffect(
    () => () => { geos?.water.dispose(); geos?.quay.dispose(); geos?.walk.dispose(); },
    [geos],
  );
  if (!geos) return null;
  const stone = selected ? SELECTED : hover ? "#9aa2ab" : QUAY;
  const walk = selected ? SELECTED : WALK;
  return (
    <group
      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
      onPointerOver={onSelect ? (e) => { e.stopPropagation(); setHover(true); } : undefined}
      onPointerOut={onSelect ? () => setHover(false) : undefined}
    >
      <mesh geometry={geos.walk} receiveShadow>
        <meshStandardMaterial color={walk} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geos.quay} castShadow receiveShadow>
        <meshStandardMaterial color={stone} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geos.water}>
        <meshStandardMaterial
          color={WATER} roughness={0.2} metalness={0.1}
          transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
```

- [ ] **Step 6: Route canal streets** in `StreetNetworkView.tsx`. Add the import:

```tsx
import CanalMesh from "./CanalMesh";
```

Replace the `network.streets.map(...)` ribbon block so a canal renders `CanalMesh`:

```tsx
{network.streets.map((s) =>
  s.type === "canal" ? (
    <CanalMesh
      key={s.id}
      street={s}
      selected={selectedStreet === s.id}
      onSelect={onSelectStreet ? () => onSelectStreet(s.id) : undefined}
      ground={ground}
    />
  ) : (
    <StreetRibbonMesh
      key={s.id}
      street={s}
      selected={selectedStreet === s.id}
      onSelect={onSelectStreet ? () => onSelectStreet(s.id) : undefined}
      ground={ground}
    />
  ),
)}
```

- [ ] **Step 7: Gates**

Run: `npx tsc --noEmit` → exit 0. `npx eslint src` → 3 baseline warnings. `npx vitest run src/lib/street/` → all pass.

- [ ] **Step 8: Visual check (CDP).** `npm run dev`; seed a canal via `localStorage["facademaker:autosave"]` with one canal street on flat ground, then a slope; confirm recessed level water, quay walls, sidewalks, and a level pool on the slope. Screenshot.

- [ ] **Step 9: Commit**

```bash
git add src/lib/street/canal.ts src/lib/street/canal.test.ts \
  src/components/street/CanalMesh.tsx src/components/street/StreetNetworkView.tsx
git commit -m "feat(canal): level water + quay walls + sidewalks (CanalMesh) (T2)"
```

---

## Task 3: Bridges — predicate + arch geometry + BridgeMesh

**Files:**
- Modify: `src/lib/street/canal.ts` (`BridgePlacement`, `bridgesFor`, `bridgeArch`)
- Modify: `src/lib/street/canal.test.ts`
- Create: `src/components/street/BridgeMesh.tsx`
- Modify: `src/components/street/StreetNetworkView.tsx` (render bridges)

**Interfaces:**
- Consumes: `deriveIntersections(net): Intersection[]` and `Intersection` from `./intersections`; `closestPointOnSegment` from `./geometry`.
- Produces: `interface BridgePlacement {key: string; pos: Vec2; tangent: Vec2; span: number}`; `bridgesFor(net, intersections): BridgePlacement[]`; `bridgeArch(span, rise, deckWidth, samples?): Vec3[]`.

- [ ] **Step 1: Write the failing test** — append to `canal.test.ts`:

```ts
import { bridgesFor, bridgeArch } from "./canal";
import { deriveIntersections } from "./intersections";
import type { StreetNetwork } from "./types";

describe("canal bridges", () => {
  it("bridges only a canal↔land junction", () => {
    const net: StreetNetwork = {
      streets: [
        { id: "c", type: "canal", points: [[0, -10], [0, 10]] },
        { id: "s", type: "street", points: [[-10, 0], [10, 0]] },
      ],
      roundabouts: [],
    };
    const b = bridgesFor(net, deriveIntersections(net));
    expect(b).toHaveLength(1);
    expect(b[0].span).toBeCloseTo(15, 6);            // 14 + 2*0.5
    expect(Math.abs(b[0].tangent[0])).toBeLessThan(1e-6); // canal runs along ±z
  });

  it("no bridge at land↔land or canal↔canal", () => {
    const land: StreetNetwork = {
      streets: [
        { id: "a", type: "street", points: [[0, -10], [0, 10]] },
        { id: "b", type: "street", points: [[-10, 0], [10, 0]] },
      ], roundabouts: [],
    };
    expect(bridgesFor(land, deriveIntersections(land))).toHaveLength(0);
    const canals: StreetNetwork = {
      streets: [
        { id: "a", type: "canal", points: [[0, -10], [0, 10]] },
        { id: "b", type: "canal", points: [[-10, 0], [10, 0]] },
      ], roundabouts: [],
    };
    expect(bridgesFor(canals, deriveIntersections(canals))).toHaveLength(0);
  });

  it("bridgeArch: parabolic humpback, apex + parapet, deck width", () => {
    const tris = bridgeArch(15, 1.5, 3, 12);
    expect(tris.length % 3).toBe(0);
    expect(tris.length).toBeGreaterThan(0);
    const ys = tris.map((t) => t[1]);
    expect(Math.max(...ys)).toBeCloseTo(1.5 + 0.5, 6); // apex + parapet height
    const zs = tris.map((t) => t[2]);
    expect(Math.max(...zs)).toBeCloseTo(1.5, 6);        // deckWidth/2
    expect(Math.min(...zs)).toBeCloseTo(-1.5, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/street/canal.test.ts`
Expected: FAIL — `bridgesFor`/`bridgeArch` not exported.

- [ ] **Step 3: Implement** in `canal.ts`:

```ts
export interface BridgePlacement {
  key: string;
  pos: Vec2;
  tangent: Vec2;   // unit canal direction at pos
  span: number;    // bank-to-bank crossing length
}

/** Unit canal direction at `pos` — direction of the nearest canal segment
 * (locate by pos, not the ambiguous incident.vertex index). */
function canalTangentAt(street: Street, pos: Vec2): Vec2 {
  const pts = street.closed ? [...street.points, street.points[0]] : street.points;
  let best = Infinity;
  let dir: Vec2 = [1, 0];
  for (let i = 0; i < pts.length - 1; i++) {
    const c = closestPointOnSegment(pos, pts[i], pts[i + 1]);
    if (c.dist < best) {
      best = c.dist;
      const dx = pts[i + 1][0] - pts[i][0];
      const dz = pts[i + 1][1] - pts[i][1];
      const L = Math.hypot(dx, dz) || 1;
      dir = [dx / L, dz / L];
    }
  }
  return dir;
}

/** A footbridge at every junction mixing a canal with a land street. */
export function bridgesFor(net: StreetNetwork, intersections: Intersection[]): BridgePlacement[] {
  const typeById = new Map(net.streets.map((s) => [s.id, s.type]));
  const streetById = new Map(net.streets.map((s) => [s.id, s]));
  const out: BridgePlacement[] = [];
  for (const it of intersections) {
    const types = it.incident.map((i) => typeById.get(i.streetId));
    const hasCanal = types.some((t) => t === "canal");
    const hasLand = types.some((t) => t !== undefined && t !== "canal");
    if (!hasCanal || !hasLand) continue;
    const canalInc = it.incident.find((i) => typeById.get(i.streetId) === "canal")!;
    const canal = streetById.get(canalInc.streetId)!;
    out.push({
      key: it.key,
      pos: it.pos,
      tangent: canalTangentAt(canal, it.pos),
      span: effectiveWidth(canal) + 2 * CANAL_QUAY,
    });
  }
  return out;
}

const BRIDGE_DECK_THICKNESS = 0.4;
const BRIDGE_PARAPET_H = 0.5;

/** Humpback footbridge as a triangle soup, LOCAL frame: x across the span
 * [-span/2, span/2], z the deck breadth [-deckWidth/2, deckWidth/2], y up with
 * the springing at y=0. Parabolic profile rising `rise` at centre. Winding is
 * not guaranteed — the mesh auto-orients by normal. */
export function bridgeArch(span: number, rise: number, deckWidth: number, samples = 12): Vec3[] {
  const hs = span / 2;
  const wd = deckWidth / 2;
  const prof = (x: number) => rise * (1 - (2 * x / span) ** 2);
  const out: Vec3[] = [];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => out.push(a, b, c, a, c, d);
  const xs: number[] = [];
  for (let i = 0; i <= samples; i++) xs.push(-hs + (span * i) / samples);
  for (let i = 0; i < samples; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    const y0 = prof(x0), y1 = prof(x1);
    const b0 = y0 - BRIDGE_DECK_THICKNESS, b1 = y1 - BRIDGE_DECK_THICKNESS;
    quad([x0, y0, -wd], [x1, y1, -wd], [x1, y1, wd], [x0, y0, wd]);   // deck top
    quad([x0, b0, wd], [x1, b1, wd], [x1, b1, -wd], [x0, b0, -wd]);   // underside
    quad([x0, b0, -wd], [x1, b1, -wd], [x1, y1, -wd], [x0, y0, -wd]); // side -z
    quad([x0, y0, wd], [x1, y1, wd], [x1, b1, wd], [x0, b0, wd]);     // side +z
    for (const zc of [-wd, wd]) {                                     // parapets
      quad([x0, y0, zc], [x1, y1, zc],
           [x1, y1 + BRIDGE_PARAPET_H, zc], [x0, y0 + BRIDGE_PARAPET_H, zc]);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/street/canal.test.ts` → PASS.

- [ ] **Step 5: Create `src/components/street/BridgeMesh.tsx`:**

```tsx
"use client";
import { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { BridgePlacement } from "@/lib/street/canal";
import { bridgeArch, BRIDGE_DECK_WIDTH, BRIDGE_RISE } from "@/lib/street/canal";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";

const STONE = "#7d766a";

export default function BridgeMesh({
  placement, ground,
}: {
  placement: BridgePlacement;
  ground: Ground;
}) {
  const geo = useMemo(() => {
    const tris = bridgeArch(placement.span, BRIDGE_RISE, BRIDGE_DECK_WIDTH);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
    g.computeVertexNormals();
    return g;
  }, [placement.span]);
  useEffect(() => () => geo.dispose(), [geo]);
  const [x, z] = placement.pos;
  const baseY = groundHeightAt(x, z, ground);
  // local +x spans the channel (canal normal); local +z is the deck breadth.
  const n: [number, number] = [-placement.tangent[1], placement.tangent[0]];
  const yaw = Math.atan2(-n[1], n[0]);
  return (
    <group position={[x, baseY, z]} rotation={[0, yaw, 0]}>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial color={STONE} roughness={0.9} />
      </mesh>
    </group>
  );
}
```

- [ ] **Step 6: Render bridges** in `StreetNetworkView.tsx`. Add imports:

```tsx
import { bridgesFor } from "@/lib/street/canal";
import BridgeMesh from "./BridgeMesh";
```

After the `intersections` memo, add:

```tsx
const bridges = useMemo(() => bridgesFor(network, intersections), [network, intersections]);
```

and inside the returned `<group>`, after the intersections block:

```tsx
{bridges.map((b) => (
  <BridgeMesh key={b.key} placement={b} ground={ground} />
))}
```

- [ ] **Step 7: Gates + visual check**

Run: `npx tsc --noEmit` → 0. `npx eslint src` → 3 baseline. `npx vitest run src/lib/street/` → pass.
Visual (CDP): seed a canal crossed by a street; confirm an arch spans the water at the crossing, oriented across the channel.

- [ ] **Step 8: Commit**

```bash
git add src/lib/street/canal.ts src/lib/street/canal.test.ts \
  src/components/street/BridgeMesh.tsx src/components/street/StreetNetworkView.tsx
git commit -m "feat(canal): arched footbridges at canal↔land crossings (T3)"
```

---

## Task 4: Buildings on the banks (frontage set-back)

**Files:**
- Modify: `src/lib/street/frontage.ts:60`, `:67-70`
- Modify: `src/lib/street/frontage.test.ts`

**Interfaces:**
- Consumes: `CANAL_QUAY`, `CANAL_SIDEWALK` from `./canal`; existing `effectiveWidth`, `PAVEMENT_GAP`, `streetRibbon`.
- Produces: no new exports; changes the derived frontage offset for canals to `10.5` m, leaving non-canal frontages byte-identical.

- [ ] **Step 1: Write the failing test** — append to `src/lib/street/frontage.test.ts`:

```ts
it("a canal sets its building line back by water/2 + quay + sidewalk (10.5 m)", () => {
  const net: StreetNetwork = {
    streets: [{ id: "c", type: "canal", points: [[0, 0], [40, 0]] }],
    roundabouts: [],
  };
  const fs = streetFrontages(net);
  expect(fs.length).toBeGreaterThan(0);
  for (const f of fs) expect(Math.abs(Math.abs(f.a[1]) - 10.5)).toBeLessThan(1e-6);
});

it("a non-canal street's frontage offset is unchanged (6 m)", () => {
  const net: StreetNetwork = {
    streets: [{ id: "s", type: "street", points: [[0, 0], [40, 0]] }],
    roundabouts: [],
  };
  const fs = streetFrontages(net);
  for (const f of fs) expect(Math.abs(Math.abs(f.a[1]) - 6)).toBeLessThan(1e-6); // 9/2 + 1.5
});
```

Ensure the file imports `StreetNetwork` (add to the existing type import if absent):

```ts
import type { StreetNetwork } from "./types";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/street/frontage.test.ts`
Expected: FAIL on the canal case — the offset is currently `14/2 + 1.5 = 8.5`, not `10.5`.

- [ ] **Step 3: Implement `bankHalf`** in `frontage.ts`. Add the import at the top:

```ts
import { CANAL_QUAY, CANAL_SIDEWALK } from "./canal";
```

Add, just below `PAVEMENT_GAP`:

```ts
/** Centreline → building line. A canal sets back by its quay + sidewalk; every
 * other type keeps the existing carriageway-gap formula (byte-identical). */
function bankHalf(s: Street): number {
  return s.type === "canal"
    ? effectiveWidth(s) / 2 + CANAL_QUAY + CANAL_SIDEWALK
    : effectiveWidth(s) / 2 + PAVEMENT_GAP;
}
```

Change line 60 from `const half = effectiveWidth(s) / 2 + PAVEMENT_GAP;` to:

```ts
      const half = bankHalf(s);
```

Change the ribbon width (lines 67-70) from `effectiveWidth(s) + 2 * PAVEMENT_GAP` to:

```ts
      const { left, right } = streetRibbon(
        pts,
        2 * bankHalf(s),
        s.closed,
      );
```

Add `Street` to the type import from `./types` if not already present.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/street/frontage.test.ts` → PASS (canal 10.5, street 6).

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit` → 0. `npx eslint src` → 3 baseline. `npm test` → all pass (confirms every other frontage/street test still green = byte-identical for non-canal).

- [ ] **Step 6: Visual check (CDP)** — seed a canal; confirm canal houses line both banks 10.5 m off the centreline (a walkable quay between water and buildings). Confirm a canal-free scene is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lib/street/frontage.ts src/lib/street/frontage.test.ts
git commit -m "feat(canal): canal-house frontages set back over the quay + sidewalk (T4)"
```

---

## Self-Review

**Spec coverage:**
- Type + `STREET_SPECS` + constants → T1. ✅
- Offset ribbons (water/quay/bank) → T1 `canalOffsets`. ✅
- Level water (`waterY = minBankGrade − depth`, flat-ground equivalence) → T2 `canalWaterY` + tests. ✅
- CanalMesh (water/quay/sidewalk, draped, level water) → T2. ✅
- Routing canal → CanalMesh → T2. ✅
- Bridge predicate (canal + land only) → T3 `bridgesFor` + tests. ✅
- Arch geometry → T3 `bridgeArch` + BridgeMesh. ✅
- Buildings on banks (`bankHalf`, non-canal byte-identical) → T4. ✅
- Selector "Canal" → T1. ✅
- Save/Load → no change needed (canal is a plain `type` string); no task, as the spec states. ✅

**Placeholder scan:** none — every code step has complete code and exact commands.

**Type consistency:** `canalOffsets` shape `{water, quayFoot, bank}` used identically in T2 CanalMesh. `BridgePlacement {key, pos, tangent, span}` produced in T3 and consumed by BridgeMesh. `bankHalf(s: Street)` in T4 matches `effectiveWidth(s: Street)`. `Vec3` defined in T1, used in T3. `Ground` imported consistently from `@/lib/facade/terrain`.

**Note for the executor:** the spec's `bridgeArchTriangles(placement)` is realized as the pure shape builder `bridgeArch(span, rise, deckWidth)` (trivially testable) plus placement in `BridgeMesh` — a deliberate, equivalent refinement.
