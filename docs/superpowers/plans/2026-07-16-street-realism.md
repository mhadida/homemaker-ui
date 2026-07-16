# Street Geometry Realism (SP-2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drawn streets curve to a realistic per-type minimum radius (auto-fillet) and drape on the tilted ground.

**Architecture:** Two additive changes to the existing `src/lib/street` module and its render components. (1) A pure `filletCentreline` produces a real road alignment (straight tangents + circular arcs ≥ minRadius, endpoints pinned) that replaces `smoothCentreline` for streets. (2) The render lifts every street vertex to `groundHeightAt`; the roundabout disc tilts to the ground plane, monuments stay plumb. Both are byte-identical when the network is empty or the ground is flat.

**Tech Stack:** TypeScript, React 19, three 0.184, @react-three/fiber/drei, vitest. Spec: `docs/superpowers/specs/2026-07-16-street-realism-design.md`.

## Global Constraints

- **Byte-identical invariant:** with `slope === 0`, `groundHeightAt` returns `0`, so draping must reduce to the current constant y. Empty network renders nothing (unchanged). No change to any pure geometry output for existing inputs except the intended fillet on streets.
- **Endpoints pinned:** `filletCentreline` MUST emit the first and last vertex exactly. `deriveIntersections` consumes raw `street.points`, so junctions/roundabout keys must stay unaffected.
- **Plan coords:** `Vec2 = [x, z]`; plan pane top-down. Ribbon/geometry math stays 2-D; y is a render-time lift only.
- **No deletion without approval:** `smoothCentreline` becomes dead after Task 4 — flag it in the ledger for the user, do NOT delete it.
- **Design rules:** no colored edge stripes; dark-only; use existing patterns. Radius values live in `STREET_SPECS` (tunable), not scattered literals.

---

### Task 1: `minRadius` on street specs

**Files:**
- Modify: `src/lib/street/types.ts`
- Test: `src/lib/street/types.test.ts`

**Interfaces:**
- Produces: `StreetSpec.minRadius: number`; `minRadiusOf(s: Street): number`.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/street/types.test.ts`:

```ts
import { STREET_SPECS, minRadiusOf, type Street } from "./types";

describe("minRadius", () => {
  it("every type has a positive minRadius, ordered alley < street < road < boulevard", () => {
    const { alley, street, road, boulevard } = STREET_SPECS;
    for (const s of [alley, street, road, boulevard]) expect(s.minRadius).toBeGreaterThan(0);
    expect(alley.minRadius).toBeLessThan(street.minRadius);
    expect(street.minRadius).toBeLessThan(road.minRadius);
    expect(road.minRadius).toBeLessThan(boulevard.minRadius);
  });
  it("minRadiusOf returns the type default", () => {
    const s: Street = { id: "street-1", type: "road", points: [[0, 0], [10, 0]] };
    expect(minRadiusOf(s)).toBe(STREET_SPECS.road.minRadius);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/street/types.test.ts` → FAIL (`minRadius`/`minRadiusOf` undefined).

- [ ] **Step 3: Implement** — in `src/lib/street/types.ts`, add `minRadius` to the interface and each spec, and the helper:

```ts
export interface StreetSpec {
  width: number;
  allowsCars: boolean;
  label: string;
  minRadius: number; // metres; minimum centreline curve radius for this type
}

export const STREET_SPECS: Record<StreetType, StreetSpec> = {
  alley:     { width: 3.5, allowsCars: false, label: "Alley",     minRadius: 6 },
  street:    { width: 9,   allowsCars: true,  label: "Street",    minRadius: 20 },
  road:      { width: 14,  allowsCars: true,  label: "Road",      minRadius: 45 },
  boulevard: { width: 24,  allowsCars: true,  label: "Boulevard", minRadius: 120 },
};

export function minRadiusOf(s: Street): number {
  return STREET_SPECS[s.type].minRadius;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/street/types.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(street): per-type minRadius + minRadiusOf (SP-2a T1)"`

---

### Task 2: `cornerFit` + `filletCentreline`

**Files:**
- Modify: `src/lib/street/geometry.ts`
- Test: `src/lib/street/geometry.test.ts`

**Interfaces:**
- Consumes: `Vec2` from `./types`.
- Produces:
  - `cornerFit(A: Vec2, V: Vec2, B: Vec2): { deflection: number; maxRadius: number }` — deflection angle Δ (rad; 0 = collinear) and the largest fillet radius that seats within the adjacent segments.
  - `filletCentreline(points: Vec2[], minRadius: number, samplesPerArc?: number): Vec2[]` — real road alignment; endpoints exact.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/street/geometry.test.ts`:

```ts
import { cornerFit, filletCentreline } from "./geometry";
import type { Vec2 } from "./types";

const distTo = (p: Vec2, o: Vec2) => Math.hypot(p[0] - o[0], p[1] - o[1]);

describe("cornerFit", () => {
  it("collinear points → zero deflection and radius", () => {
    const f = cornerFit([0, 0], [5, 0], [10, 0]);
    expect(f.deflection).toBeCloseTo(0, 6);
    expect(f.maxRadius).toBe(0);
  });
  it("right-angle corner → deflection π/2, maxRadius = half-shorter-seg / tan(45°)", () => {
    const f = cornerFit([-10, 0], [0, 0], [0, 10]); // 90° turn, equal 10 m segments
    expect(f.deflection).toBeCloseTo(Math.PI / 2, 5);
    expect(f.maxRadius).toBeCloseTo(5, 5); // tCap = 5, tan(45°)=1
  });
});

describe("filletCentreline", () => {
  it("≤ 2 points → passthrough copy", () => {
    expect(filletCentreline([[0, 0], [10, 0]], 20)).toEqual([[0, 0], [10, 0]]);
  });
  it("keeps the first and last vertex exact (junctions pinned)", () => {
    const pts: Vec2[] = [[0, 0], [10, 0], [10, 10]];
    const out = filletCentreline(pts, 3);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([10, 10]);
  });
  it("collinear interior vertex passes through unchanged", () => {
    const out = filletCentreline([[0, 0], [5, 0], [10, 0]], 20);
    expect(out).toEqual([[0, 0], [5, 0], [10, 0]]);
  });
  it("right-angle corner: every arc sample lies on a circle of the applied radius", () => {
    // long segments so the fillet uses the full minRadius = 2 (maxRadius = 25)
    const pts: Vec2[] = [[-50, 0], [0, 0], [0, 50]];
    const out = filletCentreline(pts, 2, 8);
    // arc centre for a 90° corner turning left: equidistant (2) from both axes → (−2, 2)
    const O: Vec2 = [-2, 2];
    // the samples strictly between the tangent points are the arc
    const arc = out.slice(1, out.length - 1);
    for (const p of arc) expect(distTo(p, O)).toBeCloseTo(2, 4);
  });
  it("too-tight corner clamps below minRadius without throwing", () => {
    const pts: Vec2[] = [[-2, 0], [0, 0], [0, 2]]; // 2 m segments, boulevard-scale minRadius
    expect(() => filletCentreline(pts, 120, 8)).not.toThrow();
    const out = filletCentreline(pts, 120, 8);
    // applied radius ≤ maxRadius (=1) ⇒ arc stays within ~1 m of the corner
    for (const p of out) expect(distTo(p, [0, 0])).toBeLessThan(2.5);
  });
  it("bigger minRadius pushes the arc farther from the corner (wide sweep)", () => {
    const pts: Vec2[] = [[-100, 0], [0, 0], [0, 100]];
    const near = (r: number) => Math.min(...filletCentreline(pts, r, 8).map((p) => distTo(p, [0, 0])));
    expect(near(40)).toBeGreaterThan(near(5)); // boulevard bows out more than an alley
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/street/geometry.test.ts` → FAIL (`cornerFit`/`filletCentreline` undefined).

- [ ] **Step 3: Implement** — add to `src/lib/street/geometry.ts`:

```ts
/** Unit vector from `from` toward `to` (plan coords); zero-length → [1,0]. */
function unit(to: Vec2, from: Vec2): Vec2 {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
}

/** Geometry of one interior corner A–V–B: the deflection angle Δ (heading
 * change; 0 = collinear) and the largest fillet radius that seats within the
 * adjacent segments (tangent length capped at half the shorter neighbour, so a
 * fillet at the far end of each segment still fits). Pure. */
export function cornerFit(
  A: Vec2,
  V: Vec2,
  B: Vec2,
): { deflection: number; maxRadius: number } {
  const u = unit(A, V);
  const w = unit(B, V);
  let dot = u[0] * w[0] + u[1] * w[1];
  dot = Math.max(-1, Math.min(1, dot));
  const phi = Math.acos(dot); // interior angle between the two segments
  const delta = Math.PI - phi; // deflection
  if (delta < 1e-4) return { deflection: 0, maxRadius: 0 };
  const segA = Math.hypot(A[0] - V[0], A[1] - V[1]);
  const segB = Math.hypot(B[0] - V[0], B[1] - V[1]);
  const tCap = Math.min(segA, segB) * 0.5;
  const maxRadius = tCap / Math.tan(delta / 2);
  return { deflection: delta, maxRadius };
}

/** Real road alignment through the vertices: straight tangents joined by
 * circular arcs of radius min(minRadius, what fits). First and last vertices
 * are emitted exactly (shared junction points). Collinear corners pass
 * through. ≤ 2 points → straight passthrough copy. Pure. */
export function filletCentreline(
  points: Vec2[],
  minRadius: number,
  samplesPerArc = 8,
): Vec2[] {
  if (points.length <= 2) return points.map((p): Vec2 => [p[0], p[1]]);
  const out: Vec2[] = [[points[0][0], points[0][1]]];
  for (let i = 1; i < points.length - 1; i++) {
    const A = points[i - 1];
    const V = points[i];
    const B = points[i + 1];
    const { deflection, maxRadius } = cornerFit(A, V, B);
    if (deflection === 0 || maxRadius <= 0) {
      out.push([V[0], V[1]]);
      continue;
    }
    const r = Math.min(minRadius, maxRadius);
    const u = unit(A, V);
    const w = unit(B, V);
    const T = r * Math.tan(deflection / 2);
    const Ta: Vec2 = [V[0] + u[0] * T, V[1] + u[1] * T];
    const Tb: Vec2 = [V[0] + w[0] * T, V[1] + w[1] * T];
    let bx = u[0] + w[0];
    let bz = u[1] + w[1];
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl;
    bz /= bl;
    const dO = r / Math.cos(deflection / 2);
    const O: Vec2 = [V[0] + bx * dO, V[1] + bz * dO];
    const a0 = Math.atan2(Ta[1] - O[1], Ta[0] - O[0]);
    const a1 = Math.atan2(Tb[1] - O[1], Tb[0] - O[0]);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    out.push(Ta);
    for (let s = 1; s < samplesPerArc; s++) {
      const a = a0 + (d * s) / samplesPerArc;
      out.push([O[0] + Math.cos(a) * r, O[1] + Math.sin(a) * r]);
    }
    out.push(Tb);
  }
  const last = points[points.length - 1];
  out.push([last[0], last[1]]);
  return out;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/street/geometry.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(street): filletCentreline + cornerFit (SP-2a T2)"`

---

### Task 3: `streetAdvisory` sub-minimum-radius hint

**Files:**
- Modify: `src/lib/street/geometry.ts`
- Test: `src/lib/street/geometry.test.ts`

**Interfaces:**
- Consumes: `cornerFit` (Task 2), `STREET_SPECS` (Task 1).
- Produces: `streetAdvisory` now also returns a radius hint (highest precedence).

- [ ] **Step 1: Write the failing tests** — append to `src/lib/street/geometry.test.ts`:

```ts
import { streetAdvisory } from "./geometry";
import type { Street } from "./types";

describe("streetAdvisory radius hint", () => {
  it("flags a boulevard corner tighter than its minimum radius", () => {
    const s: Street = { id: "s1", type: "boulevard", points: [[-5, 0], [0, 0], [0, 5]] };
    expect(streetAdvisory(s)).toMatch(/minimum radius/i);
  });
  it("no radius hint for a gentle corner within the type minimum", () => {
    // alley minRadius 6; long shallow bend seats easily
    const s: Street = { id: "s2", type: "alley", points: [[-30, 0], [0, 0], [30, 2]] };
    const msg = streetAdvisory(s);
    expect(msg === null || !/minimum radius/i.test(msg)).toBe(true);
  });
  it("still fires the existing long-straight-run hint when no radius issue", () => {
    const s: Street = { id: "s3", type: "street", points: [[0, 0], [100, 0]] };
    expect(streetAdvisory(s)).toMatch(/straight run/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/street/geometry.test.ts` → FAIL (no radius hint yet).

- [ ] **Step 3: Implement** — in `src/lib/street/geometry.ts`, import specs and prepend the radius check inside `streetAdvisory`:

Add to the import at the top:
```ts
import { STREET_SPECS } from "./types";
```
Then, at the START of `streetAdvisory` (before the existing `type === "boulevard"` block):
```ts
  const minR = STREET_SPECS[type].minRadius;
  for (let i = 1; i < points.length - 1; i++) {
    const { deflection, maxRadius } = cornerFit(points[i - 1], points[i], points[i + 1]);
    if (deflection > 0 && maxRadius < minR) {
      return `This ${STREET_SPECS[type].label.toLowerCase()} corner is tighter than its ${minR} m minimum radius — it was rounded as much as the segments allow; lengthen them or add a vertex for a gentle sweep.`;
    }
  }
```
(Keep the existing boulevard-length and straight-run logic below, unchanged.)

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/street/geometry.test.ts` → PASS. Then full suite `npm test` → all green.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(street): advisory flags sub-minimum-radius corners (SP-2a T3)"`

---

### Task 4: Ribbon + draw preview use the filleted centreline

**Files:**
- Modify: `src/components/street/StreetRibbonMesh.tsx`
- Modify: `src/components/facade/FacadeViewer.tsx` (street draw preview, ~line 422)
- No new unit test (component/visual); `npx tsc --noEmit` + `npm test` must stay green.

**Interfaces:**
- Consumes: `filletCentreline` (Task 2), `minRadiusOf`/`STREET_SPECS` (Task 1).

- [ ] **Step 1: Switch the committed ribbon** — in `src/components/street/StreetRibbonMesh.tsx`, replace the import and the centreline call:

```ts
import { filletCentreline, streetRibbon } from "@/lib/street/geometry";
import { effectiveWidth, minRadiusOf } from "@/lib/street/types";
```
```ts
    const cl = filletCentreline(street.points, minRadiusOf(street));
```
(Everything else in the mesh is unchanged.)

- [ ] **Step 2: Switch the draw preview** — in `src/components/facade/FacadeViewer.tsx`, update the street-preview import and the smooth line so the preview curve matches what will be committed (the `StreetDrawSurface` already has `activeType`):

```ts
import { filletCentreline, snapStreetPoint } from "@/lib/street/geometry";
import { STREET_SPECS } from "@/lib/street/types";
```
```ts
  const smooth =
    preview.length >= 2
      ? filletCentreline(preview, STREET_SPECS[activeType].minRadius)
      : null;
```
(If `smoothCentreline` was the only other symbol imported from geometry there, drop it from the import.)

- [ ] **Step 3: Flag the now-dead `smoothCentreline`** — confirm no non-test caller remains:

Run: `grep -rn "smoothCentreline" src --include="*.ts" --include="*.tsx" | grep -v "\.test\."`
Expected: only its definition in `geometry.ts`. Record in the ledger: "smoothCentreline is now dead (superseded by filletCentreline) — flag to user for removal per Deletion Policy; NOT deleted." Do not delete it or its test.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` → clean; `npm test` → all green. Visual (browser checkpoint): draw a street with a sharp corner and confirm the preview and committed ribbon both show a rounded curve (wide for boulevard, tight for alley).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(street): ribbon + draw preview use radius-limited fillet (SP-2a T4)"`

---

### Task 5: Drape the street network on topography

**Files:**
- Modify: `src/components/facade/SceneContents.tsx` (pass `ground` to `StreetNetworkView`)
- Modify: `src/components/street/StreetNetworkView.tsx` (accept + thread `ground`)
- Modify: `src/components/street/StreetRibbonMesh.tsx` (per-vertex y-lift)
- Modify: `src/components/street/RoundaboutMesh.tsx` (tilt disc to ground plane)
- Modify: `src/components/street/MonumentMesh.tsx` (plumb, base at ground height)
- Modify: `src/components/street/IntersectionMarker.tsx` (lift marker)
- No new unit test (render/visual); rely on `groundHeightAt`/`groundNormal` (already tested) + the flat-ground byte-identical check.

**Interfaces:**
- Consumes: `groundHeightAt`, `groundNormal`, `Ground` from `@/lib/facade/terrain`.

- [ ] **Step 1: Thread `ground` from the scene** — in `src/components/facade/SceneContents.tsx`, pass the page's existing `ground` prop/state into `<StreetNetworkView … ground={ground} />`. (Find the existing `<StreetNetworkView …>` usage; `ground` is already in scope for the tilted ground plane/grid.)

- [ ] **Step 2: `StreetNetworkView` accepts and forwards `ground`** — add `ground: Ground` to its props and pass it to each `StreetRibbonMesh`, `RoundaboutMesh`, and `IntersectionMarker`:

```ts
import type { Ground } from "@/lib/facade/terrain";
```
Add `ground` to the destructured props and the prop type, then thread it:
```tsx
<StreetRibbonMesh key={s.id} street={s} ground={ground} … />
…
<RoundaboutMesh centre={it.pos} outerR={…} islandR={…} monument={m} ground={ground} />
…
<IntersectionMarker pos={it.pos} radius={…} selected={…} onSelect={…} ground={ground} />
```

- [ ] **Step 3: Drape the ribbon** — in `StreetRibbonMesh.tsx`, accept `ground: Ground`, add it to the `useMemo` deps, and lift each vertex:

```ts
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";
```
Replace the constant `Y` with a per-vertex height (keep the +0.02 paving offset):
```ts
    const yAt = (x: number, z: number) => groundHeightAt(x, z, ground) + 0.02;
    for (let i = 0; i < cl.length - 1; i++) {
      const l0 = left[i], l1 = left[i + 1], r0 = right[i], r1 = right[i + 1];
      pos.push(l0[0], yAt(l0[0], l0[1]), l0[1], r0[0], yAt(r0[0], r0[1]), r0[1], r1[0], yAt(r1[0], r1[1]), r1[1]);
      pos.push(l0[0], yAt(l0[0], l0[1]), l0[1], r1[0], yAt(r1[0], r1[1]), r1[1], l1[0], yAt(l1[0], l1[1]), l1[1]);
    }
```
Add `ground` to the `useMemo` dependency array (`[street, ground]`).

- [ ] **Step 4: Tilt the roundabout disc to the ground plane** — in `RoundaboutMesh.tsx`, accept `ground: Ground`. Build the ring at LOCAL origin (`roundaboutRing([0, 0], outerR, islandR)`), then position the disc group at the centre's ground height and rotate it to the ground normal (a flat disc on a flat plane is exact). Keep the monument OUTSIDE the tilted group so it stays plumb:

```ts
import { groundHeightAt, groundNormal, type Ground } from "@/lib/facade/terrain";
```
```tsx
  const geo = useMemo(() => {
    const { outer, island } = roundaboutRing([0, 0], outerR, islandR); // local
    const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], p[1])));
    shape.holes.push(new THREE.Path(island.map((p) => new THREE.Vector2(p[0], p[1]))));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.021, 0);
    return g;
  }, [outerR, islandR]);
  useEffect(() => () => geo.dispose(), [geo]);
  const [cx, cz] = centre;
  const baseY = groundHeightAt(cx, cz, ground);
  const q = useMemo(() => {
    const n = groundNormal(ground);
    return new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(n[0], n[1], n[2]),
    );
  }, [ground]);
  return (
    <group>
      <group position={[cx, baseY, cz]} quaternion={q}>
        <mesh geometry={geo} receiveShadow>
          <meshStandardMaterial color="#3f3f44" roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <MonumentMesh centre={centre} kind={monument.kind} baseY={baseY} />
    </group>
  );
```

- [ ] **Step 5: Plumb monuments at ground height** — in `MonumentMesh.tsx`, accept an optional `baseY = 0` and use it as the group's y (vertical/plumb, unchanged otherwise):

```ts
export default function MonumentMesh({
  centre,
  kind,
  baseY = 0,
}: {
  centre: [number, number];
  kind: Monument["kind"];
  baseY?: number;
}) {
  const [x, z] = centre;
  // …both branches: change `position={[x, 0, z]}` to `position={[x, baseY, z]}`
```

- [ ] **Step 6: Lift the intersection marker** — in `IntersectionMarker.tsx`, accept `ground: Ground` and lift its y:

```ts
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";
```
```tsx
// add `ground: Ground` to props; then:
      position={[pos[0], groundHeightAt(pos[0], pos[1], ground) + 0.025, pos[1]]}
```

- [ ] **Step 7: Verify** — `npx tsc --noEmit` → clean; `npm test` → all green. Visual (browser checkpoint):
  - **Flat (`slope 0`) → byte-identical:** ribbon/roundabout/monument sit exactly where they did before (every y equals its old constant; tilt quaternion is identity).
  - **Sloped (`slope > 0`) → drape:** ribbon follows the tilt, the roundabout disc lies in the ground plane (no floating edge), the monument stands plumb at ground height, the marker sits on the surface.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(street): drape network on topography — ribbon/roundabout/monument/marker (SP-2a T5)"`

---

## Self-Review (author checklist)

- **Spec coverage:** minRadius (T1) ✔; fillet geometry (T2) ✔; advisory backstop (T3) ✔; ribbon+preview consume fillet (T4) ✔; draping ribbon/roundabout/monument/marker + thread ground (T5) ✔; smoothCentreline flagged-not-deleted (T4 step 3) ✔.
- **Placeholders:** none — every code step is complete.
- **Type consistency:** `cornerFit`/`filletCentreline` signatures match between T2 (definition) and T3/T4 (consumers); `minRadiusOf`/`STREET_SPECS.minRadius` match between T1 and T3/T4; `Ground` prop threaded consistently T5.
- **Byte-identical:** `groundHeightAt` returns 0 at slope 0 (verified in terrain.ts) → T5 reduces to current constants; `roundaboutRing([0,0],…)` + group position `[cx, 0, cz]` + identity quaternion equals the old absolute-coord disc.
