# Street Junction Trim + Pad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate coplanar z-fighting where street ribbons overlap at junctions by clipping each incident ribbon back a fixed distance and paving the gap with one star-polygon of the ribbon cap edges.

**Architecture:** One new pure module (`src/lib/street/junctionPad.ts`) derives, per network: the clip discs each street receives, the clipped ribbon spans, and one star-polygon pad per node/T/X junction (color-free — returns the dominant street's id). Two component changes render it: `StreetRibbonMesh` gains an optional `spans` prop (renders per-span open ribbons; `undefined` = today's byte-identical path), and a new `JunctionPadMesh` fans the star polygon from the junction centre. `StreetNetworkView` wires it together and resolves the pad color.

**Tech Stack:** TypeScript, React Three Fiber / three.js, vitest. Pure geometry in `src/lib/street/*`; R3F components render what it returns.

## Global Constraints

- NEVER edit `python/vendor/homemaker-addon` (vendored submodule).
- The pure lib stays **color-free**: `junctionPad.ts` returns `dominantStreetId`, never hex; the component resolves paving color via `pavingOf`.
- **Byte-identical when inert**: a single street, or any network whose streets share no junctions, produces one span per street identical to today and zero pads. A street with no clip discs is **absent** from the `streetSpans` map and renders via `StreetRibbonMesh`'s existing internal path (closed-loop rendering preserved).
- Pure modules use no `Math.random` / `Date` / `new Date()`.
- Pad and ribbons share one plane: `groundHeightAt + 0.02`, `polygonOffset`, `polygonOffsetFactor: -1`.
- `CLIP_K = 1.3`. `ROUNDABOUT_OUTER_R = 9` (relocated to `types.ts` in Task 2; value unchanged).
- Exclusions: any junction with a `canal`-type incident is skipped entirely (no discs, no pad); roundabout junctions get discs (clip to the ring) but **no** hull pad.
- Every commit message ends with the trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017JZPbzBcWyfSV3Zxr8XXUH
  ```
- Spec: `docs/superpowers/specs/2026-07-21-junction-pad-design.md`.

---

### Task 1: `clipCentreline` — split a polyline into the spans outside a set of discs

**Files:**
- Create: `src/lib/street/junctionPad.ts`
- Test: `src/lib/street/junctionPad.test.ts`

**Interfaces:**
- Consumes: `Vec2` from `@/lib/street/types`.
- Produces:
  - `interface ClipDisc { centre: Vec2; radius: number }`
  - `function clipCentreline(centreline: Vec2[], discs: ClipDisc[]): Vec2[][]` — the polyline's spans lying outside every disc, each span a `Vec2[]` of ≥ 2 points with the circle crossings inserted. No discs / short input handled.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/street/junctionPad.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clipCentreline, type ClipDisc } from "./junctionPad";
import type { Vec2 } from "./types";

const line = (...pts: Vec2[]) => pts;

describe("clipCentreline", () => {
  it("no discs → the input unchanged (one span, byte-identical)", () => {
    const cl = line([0, 0], [10, 0], [20, 0]);
    const spans = clipCentreline(cl, []);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual(cl);
  });

  it("a mid-line disc splits into two spans with the split points on the circle", () => {
    // straight line along +x; disc centred at (10,0) r=2 removes x∈(8,12)
    const cl = line([0, 0], [20, 0]);
    const discs: ClipDisc[] = [{ centre: [10, 0], radius: 2 }];
    const spans = clipCentreline(cl, discs);
    expect(spans).toHaveLength(2);
    // first span ends at x=8, second starts at x=12
    expect(spans[0][spans[0].length - 1][0]).toBeCloseTo(8);
    expect(spans[1][0][0]).toBeCloseTo(12);
  });

  it("a disc over an endpoint shortens that end (one span)", () => {
    // disc at the start endpoint removes x∈[0,3)
    const cl = line([0, 0], [20, 0]);
    const spans = clipCentreline(cl, [{ centre: [0, 0], radius: 3 }]);
    expect(spans).toHaveLength(1);
    expect(spans[0][0][0]).toBeCloseTo(3);
    expect(spans[0][spans[0].length - 1][0]).toBeCloseTo(20);
  });

  it("two discs (both ends) leave the middle span", () => {
    const cl = line([0, 0], [20, 0]);
    const spans = clipCentreline(cl, [
      { centre: [0, 0], radius: 3 },
      { centre: [20, 0], radius: 3 },
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0][0][0]).toBeCloseTo(3);
    expect(spans[0][spans[0].length - 1][0]).toBeCloseTo(17);
  });

  it("a disc that swallows the whole line → no spans", () => {
    const cl = line([0, 0], [4, 0]);
    expect(clipCentreline(cl, [{ centre: [2, 0], radius: 10 }])).toHaveLength(0);
  });

  it("keeps interior vertices of a bent polyline inside a surviving span", () => {
    const cl = line([0, 0], [10, 5], [20, 0]);
    const spans = clipCentreline(cl, [{ centre: [20, 0], radius: 2 }]);
    expect(spans).toHaveLength(1);
    // the (10,5) bend survives
    expect(spans[0].some((p) => p[0] === 10 && p[1] === 5)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/street/junctionPad.test.ts`
Expected: FAIL — `clipCentreline` / `ClipDisc` not exported (module doesn't exist yet).

- [ ] **Step 3: Implement `clipCentreline`**

Create `src/lib/street/junctionPad.ts`:

```ts
import type { Vec2 } from "./types";

/** A clip disc contributed by one junction to one incident street. */
export interface ClipDisc {
  centre: Vec2;
  radius: number;
}

const EPS = 1e-6;

/** Split a polyline into the spans lying OUTSIDE every disc.
 *
 * Parametrized by cumulative arc length: each disc contributes the arc-length
 * ranges where the polyline is inside it (via a circle–segment quadratic); the
 * inside ranges are merged and the complementary (outside) ranges are re-emitted
 * as spans with the circle crossings inserted and the original interior vertices
 * kept. No discs, or a < 2-point input, is a no-op passthrough. Pure. */
export function clipCentreline(centreline: Vec2[], discs: ClipDisc[]): Vec2[][] {
  if (centreline.length < 2) return [];
  const copy = (): Vec2[][] => [centreline.map((p): Vec2 => [p[0], p[1]])];
  if (discs.length === 0) return copy();

  // cumulative arc length at each vertex
  const cum: number[] = [0];
  for (let i = 1; i < centreline.length; i++) {
    cum.push(
      cum[i - 1] +
        Math.hypot(centreline[i][0] - centreline[i - 1][0], centreline[i][1] - centreline[i - 1][1]),
    );
  }
  const total = cum[cum.length - 1];
  if (total < EPS) return [];

  // inside-intervals in arc-length space
  const inside: [number, number][] = [];
  for (let i = 0; i < centreline.length - 1; i++) {
    const a = centreline[i];
    const b = centreline[i + 1];
    const segLen = cum[i + 1] - cum[i];
    if (segLen < 1e-12) continue;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    for (const disc of discs) {
      // |a + t·d − c|² < r², t∈[0,1] → A t² + B t + C < 0
      const fx = a[0] - disc.centre[0];
      const fz = a[1] - disc.centre[1];
      const A = dx * dx + dz * dz;
      const B = 2 * (fx * dx + fz * dz);
      const C = fx * fx + fz * fz - disc.radius * disc.radius;
      const det = B * B - 4 * A * C;
      if (det <= 0) continue; // never crosses zero → segment fully outside
      const sq = Math.sqrt(det);
      const t0 = Math.max(0, Math.min(1, (-B - sq) / (2 * A)));
      const t1 = Math.max(0, Math.min(1, (-B + sq) / (2 * A)));
      if (t1 - t0 <= 1e-12) continue;
      inside.push([cum[i] + t0 * segLen, cum[i] + t1 * segLen]);
    }
  }
  if (inside.length === 0) return copy();

  // merge overlapping inside-intervals
  inside.sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const iv of inside) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] + EPS) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }

  // complementary outside-intervals
  const outside: [number, number][] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s - cursor > 1e-4) outside.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (total - cursor > 1e-4) outside.push([cursor, total]);

  const pointAt = (s: number): Vec2 => {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const segLen = cum[i + 1] - cum[i] || 1;
    const t = (s - cum[i]) / segLen;
    const a = centreline[i];
    const b = centreline[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };

  const spans: Vec2[][] = [];
  for (const [s, e] of outside) {
    const span: Vec2[] = [pointAt(s)];
    for (let i = 0; i < cum.length; i++) {
      if (cum[i] > s + EPS && cum[i] < e - EPS) span.push([centreline[i][0], centreline[i][1]]);
    }
    span.push(pointAt(e));
    if (span.length >= 2) spans.push(span);
  }
  return spans;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/street/junctionPad.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/street/junctionPad.ts src/lib/street/junctionPad.test.ts
git commit -m "feat(junction-pad): clipCentreline — split a polyline outside clip discs

<trailer>"
```

---

### Task 2: relocate `ROUNDABOUT_OUTER_R`, add `junctionClips` + `streetSpans`

**Files:**
- Modify: `src/lib/street/types.ts` (add `export const ROUNDABOUT_OUTER_R = 9;`)
- Modify: `src/components/street/StreetNetworkView.tsx` (import it instead of the local const)
- Modify: `src/lib/street/junctionPad.ts`
- Test: `src/lib/street/junctionPad.test.ts`

**Interfaces:**
- Consumes: `clipCentreline`, `ClipDisc` (Task 1); `deriveIntersections` from `@/lib/street/intersections`; `Street`, `StreetNetwork`, `Vec2`, `effectiveWidth`, `minRadiusOf`, `ROUNDABOUT_OUTER_R` from `@/lib/street/types`; `filletCentreline` from `@/lib/street/geometry`.
- Produces:
  - `function junctionClips(net: StreetNetwork): Map<string, ClipDisc[]>` — per-street clip discs from every non-excluded junction it touches.
  - `function streetSpans(net: StreetNetwork): Map<string, Vec2[][]>` — per **clipped** street, its open spans; unclipped streets are ABSENT from the map.
  - (internal, exported for Task 3 reuse) `function clipRadius(streets: Street[], isRoundabout: boolean): number`.

- [ ] **Step 1: Relocate the constant**

In `src/lib/street/types.ts`, add near `STREET_SPECS`:

```ts
/** Roundabout ring outer radius (m). Single source of truth — used by the
 * roundabout mesh and by junctionPad's clip radius. */
export const ROUNDABOUT_OUTER_R = 9;
```

In `src/components/street/StreetNetworkView.tsx`, delete the local
`const ROUNDABOUT_OUTER_R = 9;` and add it to the existing `types` import:

```ts
import type { StreetNetwork, Monument } from "@/lib/street/types";
import { ROUNDABOUT_OUTER_R } from "@/lib/street/types";
```
(Keep `const ROUNDABOUT_ISLAND_R = 3;` and `const JUNCTION_MARKER_R = 3;` local.)

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/street/junctionPad.test.ts`:

```ts
import { junctionClips, streetSpans } from "./junctionPad";
import { deriveIntersections } from "./intersections";
import type { Street, StreetNetwork } from "./types";

const net = (streets: Street[], roundabouts: StreetNetwork["roundabouts"] = []): StreetNetwork => ({
  streets,
  roundabouts,
  squares: [],
});
const S = (id: string, type: Street["type"], points: Vec2[], extra: Partial<Street> = {}): Street => ({
  id,
  type,
  points,
  ...extra,
});

describe("junctionClips", () => {
  it("an X crossing gives each street one disc at the crossing", () => {
    // two roads crossing at (0,0)
    const a = S("a", "road", [[-20, 0], [20, 0]]);
    const b = S("b", "road", [[0, -20], [0, 20]]);
    const clips = junctionClips(net([a, b]));
    expect(clips.get("a")).toHaveLength(1);
    expect(clips.get("b")).toHaveLength(1);
    expect(clips.get("a")![0].centre[0]).toBeCloseTo(0);
    expect(clips.get("a")![0].centre[1]).toBeCloseTo(0);
  });

  it("a canal-incident junction contributes no discs", () => {
    const road = S("r", "road", [[-20, 0], [20, 0]]);
    const canal = S("c", "canal", [[0, -20], [0, 20]]);
    const clips = junctionClips(net([road, canal]));
    expect(clips.get("r")).toBeUndefined();
    expect(clips.get("c")).toBeUndefined();
  });

  it("a roundabout junction uses the ring radius", () => {
    const a = S("a", "road", [[-20, 0], [0, 0]]);
    const b = S("b", "road", [[0, 0], [0, 20]]);
    // shared vertex (0,0) → "node"; give it a roundabout
    const n = net([a, b], []);
    const key = deriveIntersections(n).find((i) => Math.abs(i.pos[0]) < 1e-9)!.key;
    const clips = junctionClips({ ...n, roundabouts: [[key, { kind: "fountain" }]] });
    expect(clips.get("a")![0].radius).toBeCloseTo(9); // ROUNDABOUT_OUTER_R
  });
});

describe("streetSpans", () => {
  it("a lone street with no junctions is absent from the map", () => {
    const s = S("s", "road", [[0, 0], [50, 0]]);
    expect(streetSpans(net([s])).has("s")).toBe(false);
  });

  it("a through street at an X is split into two spans", () => {
    const a = S("a", "road", [[-20, 0], [20, 0]]);
    const b = S("b", "road", [[0, -20], [0, 20]]);
    const spans = streetSpans(net([a, b]));
    expect(spans.get("a")).toHaveLength(2);
    expect(spans.get("b")).toHaveLength(2);
  });

  it("an ending street at a node yields one shortened span", () => {
    const a = S("a", "road", [[-20, 0], [0, 0]]);
    const b = S("b", "road", [[0, 0], [0, 20]]);
    const spans = streetSpans(net([a, b]));
    expect(spans.get("a")).toHaveLength(1);
    expect(spans.get("b")).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/street/junctionPad.test.ts`
Expected: FAIL — `junctionClips` / `streetSpans` not exported.

- [ ] **Step 4: Implement `clipRadius`, `junctionClips`, `streetSpans`**

Add to `src/lib/street/junctionPad.ts` (imports at top, functions below `clipCentreline`):

```ts
import { deriveIntersections } from "./intersections";
import { filletCentreline } from "./geometry";
import {
  effectiveWidth,
  minRadiusOf,
  ROUNDABOUT_OUTER_R,
  type Street,
  type StreetNetwork,
} from "./types";

/** clipR (the along-centreline clip distance) for a junction. Roundabouts clip
 * to the ring; plain junctions to CLIP_K × the widest incident half-width. */
export const CLIP_K = 1.3;
export function clipRadius(streets: Street[], isRoundabout: boolean): number {
  if (isRoundabout) return ROUNDABOUT_OUTER_R;
  return Math.max(...streets.map((s) => effectiveWidth(s) / 2)) * CLIP_K;
}

/** The distinct incident streets of a junction, resolved to Street objects. */
function incidentStreets(
  incident: { streetId: string }[],
  byId: Map<string, Street>,
): Street[] {
  const ids = [...new Set(incident.map((i) => i.streetId))];
  return ids.map((id) => byId.get(id)).filter((s): s is Street => !!s);
}

/** Per-street clip discs from every non-excluded junction it touches. A
 * junction with any canal incident, or fewer than 2 distinct incident streets,
 * is skipped. Pure. */
export function junctionClips(net: StreetNetwork): Map<string, ClipDisc[]> {
  const byId = new Map(net.streets.map((s) => [s.id, s]));
  const roundabout = new Set(net.roundabouts.map(([k]) => k));
  const out = new Map<string, ClipDisc[]>();
  for (const it of deriveIntersections(net)) {
    const streets = incidentStreets(it.incident, byId);
    if (streets.length < 2) continue;
    if (streets.some((s) => s.type === "canal")) continue;
    const radius = clipRadius(streets, roundabout.has(it.key));
    for (const s of streets) {
      const arr = out.get(s.id) ?? [];
      arr.push({ centre: [it.pos[0], it.pos[1]], radius });
      out.set(s.id, arr);
    }
  }
  return out;
}

/** Per-CLIPPED-street open spans (its filleted centreline minus every junction
 * disc). Unclipped streets are ABSENT (byte-identical rendering). Pure. */
export function streetSpans(net: StreetNetwork): Map<string, Vec2[][]> {
  const clips = junctionClips(net);
  const out = new Map<string, Vec2[][]>();
  for (const s of net.streets) {
    const discs = clips.get(s.id);
    if (!discs || discs.length === 0) continue;
    const cl = filletCentreline(s.points, minRadiusOf(s), 8, s.closed);
    if (cl.length < 2) continue;
    out.set(s.id, clipCentreline(cl, discs));
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/street/junctionPad.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 6: Typecheck the relocation**

Run: `npx tsc --noEmit`
Expected: clean (StreetNetworkView now imports `ROUNDABOUT_OUTER_R`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/street/types.ts src/components/street/StreetNetworkView.tsx src/lib/street/junctionPad.ts src/lib/street/junctionPad.test.ts
git commit -m "feat(junction-pad): junctionClips + streetSpans; relocate ROUNDABOUT_OUTER_R

<trailer>"
```

---

### Task 3: `mouthsAt` + `deriveJunctionPads` — the star-polygon pad

**Files:**
- Modify: `src/lib/street/junctionPad.ts`
- Test: `src/lib/street/junctionPad.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2; `STREET_SPECS`, `StreetType` from `@/lib/street/types`.
- Produces:
  - `interface Mouth { centre: Vec2; angle: number; left: Vec2; right: Vec2 }`
  - `function mouthsAt(street: Street, pos: Vec2, clipR: number): Mouth[]`
  - `interface JunctionPad { key: string; pos: Vec2; polygon: Vec2[]; dominantStreetId: string }`
  - `function deriveJunctionPads(net: StreetNetwork): JunctionPad[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/street/junctionPad.test.ts`:

```ts
import { mouthsAt, deriveJunctionPads } from "./junctionPad";

// even-odd point-in-polygon for assertions
function inPoly(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
}

describe("mouthsAt", () => {
  it("a straight through-street gives two mouths on the clip circle, cap = width", () => {
    const s = S("s", "road", [[-30, 0], [30, 0]]); // width 14 → h 7
    const clipR = 7 * 1.3;
    const mouths = mouthsAt(s, [0, 0], clipR);
    expect(mouths).toHaveLength(2);
    for (const m of mouths) {
      expect(Math.hypot(m.centre[0], m.centre[1])).toBeCloseTo(clipR);
      expect(Math.hypot(m.left[0] - m.right[0], m.left[1] - m.right[1])).toBeCloseTo(14);
    }
  });

  it("an ending street gives one mouth", () => {
    const s = S("s", "road", [[0, 0], [30, 0]]); // starts at pos
    expect(mouthsAt(s, [0, 0], 9)).toHaveLength(1);
  });
});

describe("deriveJunctionPads", () => {
  it("an X crossing → one pad, 8 vertices, contains the centre, right dominant id", () => {
    const a = S("a", "road", [[-30, 0], [30, 0]]);
    const b = S("b", "street", [[0, -30], [0, 30]]); // narrower
    const pads = deriveJunctionPads(net([a, b]));
    expect(pads).toHaveLength(1);
    expect(pads[0].polygon).toHaveLength(8); // 4 mouths × 2 corners
    expect(inPoly([0, 0], pads[0].polygon)).toBe(true);
    expect(pads[0].pos).toEqual([0, 0]);
    expect(pads[0].dominantStreetId).toBe("a"); // road wider than street
  });

  it("a T → one pad with 6 vertices (branch 1 mouth + through 2)", () => {
    const through = S("t", "road", [[-30, 0], [30, 0]]);
    const branch = S("br", "road", [[0, 0], [0, 30]]); // ends on t mid-span
    const pads = deriveJunctionPads(net([through, branch]));
    expect(pads).toHaveLength(1);
    expect(pads[0].polygon).toHaveLength(6);
    expect(inPoly([0, 0], pads[0].polygon)).toBe(true);
  });

  it("a canal-incident junction → no pad", () => {
    const road = S("r", "road", [[-30, 0], [30, 0]]);
    const canal = S("c", "canal", [[0, -30], [0, 30]]);
    expect(deriveJunctionPads(net([road, canal]))).toHaveLength(0);
  });

  it("a roundabout junction → no pad (the ring is the pad)", () => {
    const a = S("a", "road", [[-30, 0], [0, 0]]);
    const b = S("b", "road", [[0, 0], [0, 30]]);
    const n = net([a, b]);
    const key = deriveIntersections(n).find((i) => Math.abs(i.pos[0]) < 1e-9)!.key;
    expect(deriveJunctionPads({ ...n, roundabouts: [[key, { kind: "obelisk" }]] })).toHaveLength(0);
  });
});
```

(`deriveIntersections` is already imported statically at the top of the test file from Task 2.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/street/junctionPad.test.ts`
Expected: FAIL — `mouthsAt` / `deriveJunctionPads` not exported.

- [ ] **Step 3: Implement `mouthsAt` + `deriveJunctionPads`**

Add to `src/lib/street/junctionPad.ts` (extend the types import with `STREET_SPECS`, `type StreetType`):

```ts
import { STREET_SPECS, type StreetType } from "./types";

export interface Mouth {
  centre: Vec2;
  angle: number;
  left: Vec2;
  right: Vec2;
}

/** The mouths where `street` enters the junction at `pos`, clipped at `clipR`.
 * A through street yields two (one per side), an ending street one. */
export function mouthsAt(street: Street, pos: Vec2, clipR: number): Mouth[] {
  const cl = filletCentreline(street.points, minRadiusOf(street), 8, street.closed);
  if (cl.length < 2) return [];
  const spans = clipCentreline(cl, [{ centre: pos, radius: clipR }]);
  const h = effectiveWidth(street) / 2;
  const onCircle = (p: Vec2) => Math.abs(Math.hypot(p[0] - pos[0], p[1] - pos[1]) - clipR) < 1e-3;
  const mouths: Mouth[] = [];
  for (const span of spans) {
    if (span.length < 2) continue;
    // each span end sitting on the clip circle is a mouth; tangent points from
    // that end toward the span's interior (i.e. away from pos).
    const ends: [Vec2, Vec2][] = [];
    if (onCircle(span[0])) ends.push([span[0], span[1]]);
    if (onCircle(span[span.length - 1])) ends.push([span[span.length - 1], span[span.length - 2]]);
    for (const [M, nextPt] of ends) {
      const tx = nextPt[0] - M[0];
      const tz = nextPt[1] - M[1];
      const tl = Math.hypot(tx, tz) || 1;
      const ux = tx / tl;
      const uz = tz / tl;
      const nx = -uz; // left-perp of the tangent
      const nz = ux;
      mouths.push({
        centre: [M[0], M[1]],
        angle: Math.atan2(M[1] - pos[1], M[0] - pos[0]),
        left: [M[0] + nx * h, M[1] + nz * h],
        right: [M[0] - nx * h, M[1] - nz * h],
      });
    }
  }
  return mouths;
}

export interface JunctionPad {
  key: string;
  pos: Vec2;
  polygon: Vec2[];
  dominantStreetId: string;
}

const typeOrder = (t: StreetType) => Object.keys(STREET_SPECS).indexOf(t);

/** One star-polygon pad per non-roundabout, non-canal junction. Pure,
 * color-free (returns the dominant street id). */
export function deriveJunctionPads(net: StreetNetwork): JunctionPad[] {
  const byId = new Map(net.streets.map((s) => [s.id, s]));
  const roundabout = new Set(net.roundabouts.map(([k]) => k));
  const pads: JunctionPad[] = [];
  for (const it of deriveIntersections(net)) {
    if (roundabout.has(it.key)) continue; // ring is the pad
    const streets = incidentStreets(it.incident, byId);
    if (streets.length < 2) continue;
    if (streets.some((s) => s.type === "canal")) continue;
    const clipR = clipRadius(streets, false);
    const mouths: Mouth[] = [];
    for (const s of streets) mouths.push(...mouthsAt(s, it.pos, clipR));
    if (mouths.length < 2) continue;
    mouths.sort((a, b) => a.angle - b.angle);
    const polygon: Vec2[] = [];
    for (const m of mouths) {
      polygon.push([m.right[0], m.right[1]]);
      polygon.push([m.left[0], m.left[1]]);
    }
    const dominant = streets.reduce((best, s) => {
      const bw = effectiveWidth(best);
      const sw = effectiveWidth(s);
      if (sw > bw) return s;
      if (sw === bw && typeOrder(s.type) > typeOrder(best.type)) return s;
      return best;
    });
    pads.push({ key: it.key, pos: [it.pos[0], it.pos[1]], polygon, dominantStreetId: dominant.id });
  }
  return pads;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/street/junctionPad.test.ts`
Expected: PASS (all pure junctionPad tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all green; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/street/junctionPad.ts src/lib/street/junctionPad.test.ts
git commit -m "feat(junction-pad): mouthsAt + deriveJunctionPads star polygon

<trailer>"
```

---

### Task 4: `StreetRibbonMesh` — optional `spans` prop + export `pavingOf`

**Files:**
- Modify: `src/components/street/StreetRibbonMesh.tsx`

**Interfaces:**
- Consumes: `Vec2[][]` spans from `streetSpans` (wired in Task 6).
- Produces: `StreetRibbonMesh` accepts optional `spans?: Vec2[][]`; exports `pavingOf(street: Street): string`.

- [ ] **Step 1: Export `pavingOf`**

In `src/components/street/StreetRibbonMesh.tsx`, change:

```ts
function pavingOf(street: Street): string {
```
to:
```ts
export function pavingOf(street: Street): string {
```

- [ ] **Step 2: Add the optional `spans` prop and render per-span**

Change the component signature to add `spans`:

```ts
export default function StreetRibbonMesh({
  street,
  selected = false,
  onSelect,
  ground,
  spans,
}: {
  street: Street;
  selected?: boolean;
  onSelect?: () => void;
  ground: Ground;
  /** Clipped, junction-trimmed centreline spans. Undefined → render the whole
   * street from its own filleted centreline (byte-identical to before). */
  spans?: Vec2[][];
}) {
```

Replace the `geo` memo body so it loops over spans (or the single internal centreline when `spans` is undefined). The per-span ribbon is always OPEN; the internal path keeps `street.closed`:

```ts
  const geo = useMemo(() => {
    const centrelines = spans ?? [
      filletCentreline(street.points, minRadiusOf(street), 8, street.closed),
    ];
    const closed = spans ? false : street.closed;
    const yAt = (x: number, z: number) => groundHeightAt(x, z, ground) + 0.02;
    const pos: number[] = [];
    for (const cl of centrelines) {
      if (cl.length < 2) continue;
      const { left, right } = streetRibbon(cl, effectiveWidth(street), closed);
      for (let i = 0; i < cl.length - 1; i++) {
        const l0 = left[i], l1 = left[i + 1], r0 = right[i], r1 = right[i + 1];
        pos.push(l0[0], yAt(l0[0], l0[1]), l0[1], r0[0], yAt(r0[0], r0[1]), r0[1], r1[0], yAt(r1[0], r1[1]), r1[1]);
        pos.push(l0[0], yAt(l0[0], l0[1]), l0[1], r1[0], yAt(r1[0], r1[1]), r1[1], l1[0], yAt(l1[0], l1[1]), l1[1]);
      }
    }
    if (pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }, [street, ground, spans]);
```

Add `type Vec2` to the existing type import if not present:
```ts
import type { Street, Vec2 } from "@/lib/street/types";
```

- [ ] **Step 3: Verify byte-identical + typecheck**

Run: `npx tsc --noEmit` (clean) and `npx vitest run` (all still green — pure tests unaffected). The `spans === undefined` path builds the exact same geometry as before (same `filletCentreline` + `streetRibbon(cl, effectiveWidth(street), street.closed)` + same triangle winding).

- [ ] **Step 4: Commit**

```bash
git add src/components/street/StreetRibbonMesh.tsx
git commit -m "feat(junction-pad): StreetRibbonMesh optional spans; export pavingOf

<trailer>"
```

---

### Task 5: `JunctionPadMesh` — render one star-polygon pad

**Files:**
- Create: `src/components/street/JunctionPadMesh.tsx`

**Interfaces:**
- Consumes: `JunctionPad.polygon`, `.pos`, resolved `color`, `ground`.
- Produces: `<JunctionPadMesh polygon pos color ground />`.

- [ ] **Step 1: Create the component**

Create `src/components/street/JunctionPadMesh.tsx`:

```tsx
"use client";
import { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { Vec2 } from "@/lib/street/types";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";

/** One junction pad: a star polygon fan-triangulated from `pos`, terrain-draped
 * on the same plane as the ribbons so it never z-fights them. Decoration only —
 * not selectable. */
export default function JunctionPadMesh({
  polygon,
  pos,
  color,
  ground,
}: {
  polygon: Vec2[];
  pos: Vec2;
  color: string;
  ground: Ground;
}) {
  const geo = useMemo(() => {
    if (polygon.length < 3) return null;
    const yAt = (x: number, z: number) => groundHeightAt(x, z, ground) + 0.02;
    const ax = pos[0], ay = yAt(pos[0], pos[1]), az = pos[1];
    const p: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      p.push(ax, ay, az, a[0], yAt(a[0], a[1]), a[1], b[0], yAt(b[0], b[1]), b[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    return g;
  }, [polygon, pos, ground]);
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial
        color={color}
        roughness={0.95}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/street/JunctionPadMesh.tsx
git commit -m "feat(junction-pad): JunctionPadMesh — fan-triangulated star pad

<trailer>"
```

---

### Task 6: wire it into `StreetNetworkView` + docs + full verification

**Files:**
- Modify: `src/components/street/StreetNetworkView.tsx`
- Modify: `AGENTS.md` (add a Street Network junction-pad note)

**Interfaces:**
- Consumes: `streetSpans`, `deriveJunctionPads` (`@/lib/street/junctionPad`), `pavingOf` (`./StreetRibbonMesh`), `JunctionPadMesh`.

- [ ] **Step 1: Wire the pads and spans**

In `src/components/street/StreetNetworkView.tsx`:

Add imports:
```ts
import { deriveJunctionPads, streetSpans } from "@/lib/street/junctionPad";
import JunctionPadMesh from "./JunctionPadMesh";
import { pavingOf } from "./StreetRibbonMesh";
```

Add memos beside the existing `intersections`/`squares` memos:
```ts
  const spans = useMemo(() => streetSpans(network), [network]);
  const pads = useMemo(() => deriveJunctionPads(network), [network]);
  const streetsById = useMemo(
    () => new Map(network.streets.map((s) => [s.id, s])),
    [network.streets],
  );
```

Pass spans to each `StreetRibbonMesh` (the non-canal branch of the streets map):
```tsx
          <StreetRibbonMesh
            key={s.id}
            street={s}
            selected={selectedStreet === s.id}
            onSelect={onSelectStreet ? () => onSelectStreet(s.id) : undefined}
            ground={ground}
            spans={spans.get(s.id)}
          />
```

Render the pads (place the group before or after the ribbons — order doesn't matter, they're coplanar-adjacent, not overlapping). Add inside the returned `<group>`:
```tsx
      {pads.map((pad) => {
        const dominant = streetsById.get(pad.dominantStreetId);
        if (!dominant) return null;
        return (
          <JunctionPadMesh
            key={`pad-${pad.key}`}
            polygon={pad.polygon}
            pos={pad.pos}
            color={pavingOf(dominant)}
            ground={ground}
          />
        );
      })}
```

- [ ] **Step 2: Typecheck, tests, lint**

Run: `npx tsc --noEmit` (clean); `npx vitest run` (all green); `npx eslint src/lib/street/junctionPad.ts src/lib/street/junctionPad.test.ts src/components/street/JunctionPadMesh.tsx src/components/street/StreetRibbonMesh.tsx src/components/street/StreetNetworkView.tsx src/lib/street/types.ts` (clean).

- [ ] **Step 3: Browser verification (CDP)**

Start/confirm `npm run dev` on :3000. Seed a scene via `localStorage["facademaker:autosave"]` containing a `+` X-crossing of two roads, a T-junction, and (separately) a roundabout junction, on flat ground. For each: dolly the 3D pane to a grazing angle over the junction and confirm the striped z-fighting is gone — one clean paved intersection, ribbons meeting the squared pad with no flicker, and the roundabout ring sitting in a clean gap (no longer occluded). Capture before/after screenshots. Zero new console errors. Per the project's checkpoint technique, use real CDP-injected input (not synthetic events) and remember pointer-lock/headless caveats are irrelevant here (no walk).

- [ ] **Step 4: Update AGENTS.md**

In `AGENTS.md`, in the **Street Network** bullet (or immediately after it), add a sentence documenting the feature:

```
Junctions (node/T/X) are paved by a derived star-polygon **junction pad**
(`src/lib/street/junctionPad.ts` pure — `clipCentreline` trims each incident
ribbon back `CLIP_K×` the widest half-width, `deriveJunctionPads` fans the
ribbon cap edges into one polygon; `JunctionPadMesh` renders it terrain-draped
on the ribbon plane). Kills the coplanar-overlap z-fighting; roundabouts clip
to the ring (which now sits in a clean gap); canals/bridges are excluded; an
empty/junction-free network is byte-identical.
```

- [ ] **Step 5: Commit**

```bash
git add src/components/street/StreetNetworkView.tsx AGENTS.md
git commit -m "feat(junction-pad): render junction pads + trim ribbons; docs

<trailer>"
```

---

## Notes for the executor

- Replace `<trailer>` in each commit with the two-line trailer from Global Constraints.
- Tasks 1–3 are pure and TDD'd; Tasks 4–6 are R3F components verified by tsc + the unchanged pure suite + a browser check (the project has no component test harness — everything visual is checked in the browser).
- The single most important invariant to preserve: **`spans === undefined` in `StreetRibbonMesh` must produce byte-identical geometry to today** (same `filletCentreline` args, same `streetRibbon(cl, effectiveWidth(street), street.closed)`, same triangle push order). If any pure test outside `junctionPad.test.ts` changes output, something regressed.
- `clipRadius` is the single source of truth shared by `junctionClips` (→ ribbon trim) and `deriveJunctionPads` (→ pad mouths); they MUST use the same value per junction or the pad and ribbon won't meet. Do not inline two copies.
