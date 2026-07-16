# Derived T/X Intersections (SP-2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Draw streets that form T junctions (a vertex on another street's segment) and X junctions (two segments crossing mid-span), with every junction DERIVED — streets are never split or mutated.

**Architecture:** Two pure extensions to `src/lib/street/` + a draw-preview cue. (1) `snapStreetPoint` also snaps a candidate vertex to the nearest point on an existing street's segment (so it lands exactly on the line → a T derives). (2) `deriveIntersections` adds a T pass (vertex-on-segment) and an X pass (segment-crossing), tagging each junction with a `kind`. Rendering is unchanged — the existing markers/roundabouts already iterate `deriveIntersections`.

**Tech Stack:** TypeScript, vitest, R3F. Spec: `docs/superpowers/specs/2026-07-16-tx-intersections-design.md`.

## Global Constraints

- **Streets are never mutated** by junction formation. `network.streets` holds exactly what was drawn; junctions are recomputed from it.
- **Byte-identical:** a network with only shared-endpoint junctions derives the same intersections/keys/roundabouts as today. T/X passes add entries ONLY when a vertex actually lies on a foreign segment or two segments actually cross.
- **Keying / save-load:** shared-vertex AND T junctions key on the EXACT vertex coord (`${x}:${z}`) — so existing saved `roundabouts` still resolve. Only X (a computed crossing point) rounds its position to a weld grid before keying.
- **Plan coords** `Vec2 = [x, z]`. Epsilon `WELD_EPS = 1e-6` for coincidence, geometric tolerance `ON_SEG_EPS = 1e-4` m for on-segment / interior tests.
- **No double-counting:** a vertex that coincides with another street's vertex is the existing shared-vertex case, NOT a T. A junction already produced by an earlier pass is deduped by key.

---

### Task 1: `closestPointOnSegment` + segment-aware `snapStreetPoint`

**Files:**
- Modify: `src/lib/street/geometry.ts`
- Test: `src/lib/street/geometry.test.ts`

**Interfaces:**
- Produces: `closestPointOnSegment(p, a, b): { point: Vec2; t: number; dist: number }`; `snapStreetPoint` unchanged signature, now also snaps to segments.

- [ ] **Step 1: Write the failing tests** — append to `geometry.test.ts`:

```ts
import { closestPointOnSegment, snapStreetPoint } from "./geometry";
import type { StreetNetwork } from "./types";

describe("closestPointOnSegment", () => {
  it("projects onto the segment interior", () => {
    const r = closestPointOnSegment([5, 3], [0, 0], [10, 0]);
    expect(r.point).toEqual([5, 0]);
    expect(r.t).toBeCloseTo(0.5, 6);
    expect(r.dist).toBeCloseTo(3, 6);
  });
  it("clamps beyond an endpoint", () => {
    const r = closestPointOnSegment([-4, 0], [0, 0], [10, 0]);
    expect(r.point).toEqual([0, 0]);
    expect(r.t).toBe(0);
  });
  it("handles a zero-length segment", () => {
    const r = closestPointOnSegment([3, 4], [1, 1], [1, 1]);
    expect(r.point).toEqual([1, 1]);
    expect(Number.isFinite(r.dist)).toBe(true);
  });
});

describe("snapStreetPoint — segment snapping", () => {
  const net: StreetNetwork = {
    streets: [{ id: "street-1", type: "street", points: [[0, 0], [20, 0]] }],
    roundabouts: [],
  };
  it("snaps a near-segment point onto the segment (T formation)", () => {
    expect(snapStreetPoint([10, 0.5], net, 1)).toEqual([10, 0]);
  });
  it("prefers an existing vertex over a segment when both are in range", () => {
    expect(snapStreetPoint([0.3, 0.3], net, 1)).toEqual([0, 0]); // the vertex, not [0.3,0]
  });
  it("leaves a far point unchanged", () => {
    expect(snapStreetPoint([10, 5], net, 1)).toEqual([10, 5]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/street/geometry.test.ts` → FAIL (`closestPointOnSegment` undefined; segment snap not implemented).

- [ ] **Step 3: Implement** — add to `geometry.ts`, and REPLACE the body of `snapStreetPoint`:

```ts
/** Closest point on segment a→b to p, with the clamped parameter t∈[0,1] and
 * the distance. Zero-length segment → a (t=0). Pure. */
export function closestPointOnSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { point: Vec2; t: number; dist: number } {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const denom = abx * abx + abz * abz;
  let t = denom === 0 ? 0 : ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / denom;
  t = Math.max(0, Math.min(1, t));
  const point: Vec2 = [a[0] + abx * t, a[1] + abz * t];
  return { point, t, dist: Math.hypot(p[0] - point[0], p[1] - point[1]) };
}
```

Replace `snapStreetPoint` with a two-stage snap (vertex first, then segment):

```ts
export function snapStreetPoint(
  p: Vec2,
  network: StreetNetwork,
  radius: number,
): Vec2 {
  // 1) nearest EXISTING vertex within radius (exact reuse wins).
  let best = p;
  let bestD = radius;
  for (const s of network.streets) {
    for (const v of s.points) {
      const d = Math.hypot(p[0] - v[0], p[1] - v[1]);
      if (d < bestD) {
        bestD = d;
        best = [v[0], v[1]];
      }
    }
  }
  if (best !== p) return best; // snapped to a vertex
  // 2) else nearest point on any segment within radius (lands ON the line → T).
  let segD = radius;
  for (const s of network.streets) {
    for (let i = 0; i < s.points.length - 1; i++) {
      const c = closestPointOnSegment(p, s.points[i], s.points[i + 1]);
      if (c.dist < segD) {
        segD = c.dist;
        best = c.point;
      }
    }
  }
  return best;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/street/geometry.test.ts` → PASS. Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(street): closestPointOnSegment + snap-to-segment for T-junctions (SP-2b T1)"`

---

### Task 2: Derived T + X in `deriveIntersections`

**Files:**
- Modify: `src/lib/street/intersections.ts`
- Test: `src/lib/street/intersections.test.ts`

**Interfaces:**
- Consumes: `closestPointOnSegment` (Task 1).
- Produces: `Intersection` gains `kind: "node" | "t" | "x"`; `deriveIntersections` returns shared-vertex ("node") + T ("t") + X ("x") junctions.

- [ ] **Step 1: Write the failing tests** — append to `intersections.test.ts`:

```ts
import { deriveIntersections } from "./intersections";
import type { StreetNetwork } from "./types";

const net = (streets: StreetNetwork["streets"]): StreetNetwork => ({
  streets,
  roundabouts: [],
});

describe("deriveIntersections — T and X", () => {
  it("still derives a shared-endpoint junction as kind 'node'", () => {
    const out = deriveIntersections(
      net([
        { id: "a", type: "street", points: [[0, 0], [10, 0]] },
        { id: "b", type: "street", points: [[10, 0], [10, 10]] },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].pos).toEqual([10, 0]);
    expect(out[0].kind).toBe("node");
  });

  it("derives a T where one street's endpoint lands on another's segment", () => {
    const out = deriveIntersections(
      net([
        { id: "main", type: "street", points: [[0, 0], [20, 0]] },
        { id: "branch", type: "street", points: [[10, 0], [10, 10]] }, // ends ON main mid-span
      ]),
    );
    const t = out.find((i) => i.kind === "t");
    expect(t).toBeTruthy();
    expect(t!.pos).toEqual([10, 0]);
  });

  it("derives an X where two segments cross mid-span", () => {
    const out = deriveIntersections(
      net([
        { id: "h", type: "street", points: [[0, 0], [20, 0]] },
        { id: "v", type: "street", points: [[10, -10], [10, 10]] },
      ]),
    );
    const x = out.find((i) => i.kind === "x");
    expect(x).toBeTruthy();
    expect(x!.pos[0]).toBeCloseTo(10, 6);
    expect(x!.pos[1]).toBeCloseTo(0, 6);
  });

  it("does NOT derive an X for endpoint-touch (that's a node/T, not a cross)", () => {
    const out = deriveIntersections(
      net([
        { id: "a", type: "street", points: [[0, 0], [10, 0]] },
        { id: "b", type: "street", points: [[10, 0], [20, 0]] },
      ]),
    );
    expect(out.some((i) => i.kind === "x")).toBe(false);
  });

  it("ignores a vertex lying on its OWN street's segment", () => {
    const out = deriveIntersections(
      net([{ id: "a", type: "street", points: [[0, 0], [10, 0], [20, 0]] }]),
    );
    expect(out).toHaveLength(0);
  });

  it("does not double-count a shared vertex as a T", () => {
    const out = deriveIntersections(
      net([
        { id: "a", type: "street", points: [[0, 0], [10, 0]] },
        { id: "b", type: "street", points: [[10, 0], [10, 10]] },
      ]),
    );
    expect(out.filter((i) => i.pos[0] === 10 && i.pos[1] === 0)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/street/intersections.test.ts` → FAIL (no `kind`, no T/X).

- [ ] **Step 3: Implement** — rewrite `src/lib/street/intersections.ts`. Keep the existing shared-vertex pass; add T and X passes; dedupe by key; tag `kind`.

```ts
import type { StreetNetwork, Vec2 } from "./types";
import { closestPointOnSegment } from "./geometry";

export interface Intersection {
  key: string;
  pos: Vec2;
  kind: "node" | "t" | "x";
  incident: { streetId: string; vertex: number }[];
}

const WELD_EPS = 1e-6;
const ON_SEG_EPS = 1e-4;

const keyOf = (p: Vec2) => `${p[0]}:${p[1]}`;
// X points are computed — round to a stable grid so the key is reproducible.
const roundKey = (p: Vec2) =>
  `${Math.round(p[0] / ON_SEG_EPS) * ON_SEG_EPS}:${Math.round(p[1] / ON_SEG_EPS) * ON_SEG_EPS}`;

/** Proper interior crossing of segment p1p2 with p3p4, or null (parallel,
 * collinear, or meeting only at an endpoint). */
function segCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): Vec2 | null {
  const d1x = p2[0] - p1[0], d1z = p2[1] - p1[1];
  const d2x = p4[0] - p3[0], d2z = p4[1] - p3[1];
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < WELD_EPS) return null; // parallel/collinear
  const s = ((p3[0] - p1[0]) * d2z - (p3[1] - p1[1]) * d2x) / denom;
  const t = ((p3[0] - p1[0]) * d1z - (p3[1] - p1[1]) * d1x) / denom;
  const e = ON_SEG_EPS;
  if (s > e && s < 1 - e && t > e && t < 1 - e) {
    return [p1[0] + s * d1x, p1[1] + s * d1z];
  }
  return null; // endpoint-touch or no crossing
}

export function deriveIntersections(net: StreetNetwork): Intersection[] {
  const byKey = new Map<string, Intersection>();
  const add = (
    key: string,
    pos: Vec2,
    kind: Intersection["kind"],
    inc: { streetId: string; vertex: number },
  ) => {
    let e = byKey.get(key);
    if (!e) {
      e = { key, pos, kind, incident: [] };
      byKey.set(key, e);
    }
    if (!e.incident.some((i) => i.streetId === inc.streetId && i.vertex === inc.vertex)) {
      e.incident.push(inc);
    }
    return e;
  };

  // Pass 1 — shared vertices (exact). Same as SP-1.
  const vByKey = new Map<string, { pos: Vec2; inc: { streetId: string; vertex: number }[] }>();
  for (const s of net.streets) {
    s.points.forEach((p, vertex) => {
      const k = keyOf(p);
      let v = vByKey.get(k);
      if (!v) { v = { pos: [p[0], p[1]], inc: [] }; vByKey.set(k, v); }
      v.inc.push({ streetId: s.id, vertex });
    });
  }
  for (const [k, v] of vByKey) {
    if (new Set(v.inc.map((i) => i.streetId)).size >= 2) {
      for (const i of v.inc) add(k, v.pos, "node", i);
    }
  }

  // Pass 2 — T: a vertex of A lying strictly ON a segment of a DIFFERENT B,
  // and not already a shared-vertex junction.
  for (const a of net.streets) {
    a.points.forEach((v, vertex) => {
      if (byKey.has(keyOf(v))) return; // already a shared-vertex junction
      for (const b of net.streets) {
        if (b.id === a.id) continue;
        for (let j = 0; j < b.points.length - 1; j++) {
          const b0 = b.points[j], b1 = b.points[j + 1];
          if (
            (Math.abs(v[0] - b0[0]) < WELD_EPS && Math.abs(v[1] - b0[1]) < WELD_EPS) ||
            (Math.abs(v[0] - b1[0]) < WELD_EPS && Math.abs(v[1] - b1[1]) < WELD_EPS)
          ) continue; // coincides with B's vertex → shared-vertex case
          const c = closestPointOnSegment(v, b0, b1);
          if (c.dist < ON_SEG_EPS && c.t > ON_SEG_EPS && c.t < 1 - ON_SEG_EPS) {
            add(keyOf(v), [v[0], v[1]], "t", { streetId: a.id, vertex });
            add(keyOf(v), [v[0], v[1]], "t", { streetId: b.id, vertex: j });
          }
        }
      }
    });
  }

  // Pass 3 — X: proper interior crossing of a segment of A with a segment of a
  // later street B (each unordered pair once).
  const streets = net.streets;
  for (let ai = 0; ai < streets.length; ai++) {
    for (let bi = ai + 1; bi < streets.length; bi++) {
      const a = streets[ai], b = streets[bi];
      for (let i = 0; i < a.points.length - 1; i++) {
        for (let j = 0; j < b.points.length - 1; j++) {
          const p = segCross(a.points[i], a.points[i + 1], b.points[j], b.points[j + 1]);
          if (!p) continue;
          const k = roundKey(p);
          if (byKey.has(k)) continue;
          add(k, p, "x", { streetId: a.id, vertex: i });
          add(k, p, "x", { streetId: b.id, vertex: j });
        }
      }
    }
  }

  return [...byKey.values()];
}
```

Keep `pruneRoundabouts` exactly as-is below (it already filters by current keys).

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/street/intersections.test.ts` → PASS. Then `npm test` (full) + `npx tsc --noEmit` → all green (the added `kind` field is additive; existing consumers ignore it).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(street): derive T (vertex-on-segment) + X (segment-crossing) junctions (SP-2b T2)"`

---

### Task 3: Draw-preview snap cue + verify T/X markers render

**Files:**
- Modify: `src/components/facade/FacadeViewer.tsx` (street draw surface — snap cue)
- No new unit test (render/visual).

**Interfaces:** consumes the now segment-aware `snapStreetPoint` (T1) and the T/X junctions from `deriveIntersections` (T2), which the existing `StreetNetworkView` already renders.

- [ ] **Step 1: Confirm markers render at T/X (no code)** — `StreetNetworkView` maps `deriveIntersections(network)` to `IntersectionMarker`/`RoundaboutMesh`. Since T2 adds T/X to that output, markers already appear at T/X junctions and each can become a roundabout. Verify by reading `StreetNetworkView.tsx` — no change needed there.

- [ ] **Step 2: Add the snap cue** — in `StreetDrawSurface` (`FacadeViewer.tsx`), the cursor is already run through `snapStreetPoint` (now segment-aware). Add a small visual cue (a ring/dot at `cursor`) tinted when the cursor is snapped onto an existing street, so the user sees a T is about to form. Reuse the existing preview `<Line>`/marker style; compute "is snapped onto a street" by comparing the snapped cursor against a fresh `snapStreetPoint` on the raw pointer (or expose whether §1 stage-2 fired). Keep it a plan-pane-only cue.

```tsx
// near the preview render, cursor already = snapStreetPoint(raw, network, 1)
{cursor && (
  <mesh position={[cursor[0], 0.09, cursor[1]]} rotation={[-Math.PI / 2, 0, 0]}>
    <ringGeometry args={[0.5, 0.8, 20]} />
    <meshBasicMaterial color={color} transparent opacity={0.9} />
  </mesh>
)}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean; `npm test` green; eslint clean on the file. Visual (browser checkpoint): draw a street ending on an existing one → a T marker appears at the touch point and can be turned into a roundabout; draw one across another → an X marker appears at the crossing.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(street): snap cue for T-junction drawing (SP-2b T3)"`

---

## Self-Review (author checklist)

- **Spec coverage:** snap-to-segment (T1) ✔; derived T + X + kind + keying (T2) ✔; render/preview (T3) ✔.
- **Byte-identical:** shared-endpoint-only networks hit only Pass 1 (unchanged); T/X passes add entries solely on real vertex-on-segment / crossing. Shared+T keys exact; only X rounds.
- **Type consistency:** `closestPointOnSegment` signature matches between T1 (def) and T2 (consumer); `Intersection.kind` added in T2, ignored by existing renderers.
- **No mutation:** all three passes read `net.streets`; none writes it.
