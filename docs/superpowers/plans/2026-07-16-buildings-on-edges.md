# Buildings on Street Edges (SP-2c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Draw a street → editable buildings appear along both edges, facing the street, trimmed at T/X junctions; moving a street re-fits its buildings (hand-edits pin); deleting a street removes them.

**Architecture:** A pure `streetFrontages` (reuses `streetRibbon`'s mitered offset + SP-2b junctions) yields per-segment frontage edges; a `syncStreetBlocks` turns them into normal `FacadeBlock`s tagged with a `source` link, diffing against existing blocks so it adds/refits/removes while preserving hand edits; the page calls it after every street mutation behind a default-on toggle.

**Tech Stack:** TypeScript, vitest, R3F. Spec: `docs/superpowers/specs/2026-07-16-buildings-on-edges-design.md`.

## Global Constraints

- **Reuse, don't reinvent:** frontage blocks are ordinary `FacadeBlock`s — all facade/roof/gable/section/massing/corner/marquee/save-load code works on them unchanged. Never fork the block model; only ADD an optional `source` field.
- **Byte-identical:** `buildingsFromStreets` OFF, empty street network, or `source` absent on a block → every current path unchanged.
- **Hand edits pin:** street-driven refit uses the existing `refit` (preserves `customized` lots) and never touches `source`-less (hand-drawn) blocks.
- **Facing:** a `FacadeBlock` faces its line's LEFT (`blockFrame` normal). Each frontage's `flipped` must make the facade normal point at the CENTRELINE — pin this with a test (normal · (centre − blockCentre) > 0).
- Plan coords `Vec2 = [x, z]`. Reuse `streetRibbon(points, width)` (mitered offset), `effectiveWidth`, `deriveIntersections` (SP-2b), `generateBlock`, `refit`, `syncCorners`.

---

### Task 1: `streetFrontages` — pure frontage geometry

**Files:**
- Create: `src/lib/street/frontage.ts`
- Test: `src/lib/street/frontage.test.ts`

**Interfaces:**
- Consumes: `streetRibbon` (geometry.ts), `effectiveWidth` (types.ts), `deriveIntersections` (intersections.ts).
- Produces: `Frontage { streetId; segment; side: "left"|"right"; a: Vec2; b: Vec2; facingFlipped: boolean }`; `streetFrontages(net, setback): Frontage[]`; constants `PAVEMENT_GAP`, `FRONTAGE_MIN`.

- [ ] **Step 1: Write the failing tests** — `src/lib/street/frontage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { streetFrontages } from "./frontage";
import type { StreetNetwork, Vec2 } from "./types";
import { effectiveWidth } from "./types";

const net = (streets: StreetNetwork["streets"]): StreetNetwork => ({ streets, roundabouts: [] });

describe("streetFrontages", () => {
  it("emits a left and a right frontage per drawn segment, offset by ~half width + gap", () => {
    const s = { id: "s1", type: "street" as const, points: [[0, 0], [20, 0]] as Vec2[] };
    const fr = streetFrontages(net([s]), 0);
    expect(fr).toHaveLength(2);
    const half = effectiveWidth(s) / 2;
    // horizontal street → offsets are at ±(half+gap) in z
    const zs = fr.map((f) => f.a[1]).sort((x, y) => x - y);
    expect(Math.abs(zs[0])).toBeGreaterThan(half);
    expect(zs[0]).toBeCloseTo(-zs[1], 6);
  });

  it("faces each frontage at the centreline (normal points inward)", () => {
    const s = { id: "s1", type: "street" as const, points: [[0, 0], [20, 0]] as Vec2[] };
    for (const f of streetFrontages(net([s]), 0)) {
      // block normal (left of a→b, then flipped): recompute the same way blockFrame does
      const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1];
      const L = Math.hypot(dx, dz);
      let nx = -dz / L, nz = dx / L;
      if (f.facingFlipped) { nx = -nx; nz = -nz; }
      const cx = (f.a[0] + f.b[0]) / 2, cz = (f.a[1] + f.b[1]) / 2;
      // centreline point nearest the frontage centre is (cx, 0) for this street
      const toCentre = [0 - 0, 0 - cz]; // centre is z=0
      expect(nx * toCentre[0] + nz * toCentre[1]).toBeGreaterThan(0);
    }
  });

  it("trims a frontage end back at a junction and drops an over-trimmed short segment", () => {
    // Two crossing streets → X at [10,0]; setback large enough to eat a short arm.
    const streets = [
      { id: "h", type: "street" as const, points: [[0, 0], [20, 0]] as Vec2[] },
      { id: "v", type: "street" as const, points: [[10, -8], [10, 8]] as Vec2[] },
    ];
    const trimmed = streetFrontages(net(streets), 3);
    // every frontage still present is at least FRONTAGE_MIN long
    for (const f of trimmed) {
      expect(Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1])).toBeGreaterThanOrEqual(6 - 1e-6);
    }
  });

  it("empty network → no frontages", () => {
    expect(streetFrontages(net([]), 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/street/frontage.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/lib/street/frontage.ts`:

```ts
import type { StreetNetwork, Vec2 } from "./types";
import { effectiveWidth } from "./types";
import { streetRibbon } from "./geometry";
import { deriveIntersections } from "./intersections";

export const PAVEMENT_GAP = 1.5; // m from carriageway edge to the building line
export const FRONTAGE_MIN = 6;   // m — a shorter (junction-crowded) edge yields no building

export interface Frontage {
  streetId: string;
  segment: number;
  side: "left" | "right";
  a: Vec2;
  b: Vec2;
  facingFlipped: boolean;
}

const near = (p: Vec2, q: Vec2, eps = 1e-4) =>
  Math.abs(p[0] - q[0]) < eps && Math.abs(p[1] - q[1]) < eps;

/** Both frontage edges of every DRAWN street segment. The offset uses
 * streetRibbon on the RAW drawn points (mitered joints → adjacent segments'
 * frontages share a bend vertex, so the corner system welds them). Each end is
 * trimmed back by `setback` when its street vertex is a derived junction (SP-2b),
 * and frontages under FRONTAGE_MIN are dropped. Pure. */
export function streetFrontages(net: StreetNetwork, setback: number): Frontage[] {
  const jns = deriveIntersections(net).map((i) => i.pos);
  const isJn = (p: Vec2) => jns.some((j) => near(p, j));
  const out: Frontage[] = [];
  for (const s of net.streets) {
    if (s.points.length < 2) continue;
    const width = effectiveWidth(s) + 2 * PAVEMENT_GAP;
    const { left, right } = streetRibbon(s.points, width); // one offset point per drawn vertex
    for (let i = 0; i < s.points.length - 1; i++) {
      const trimA = isJn(s.points[i]) ? setback : 0;
      const trimB = isJn(s.points[i + 1]) ? setback : 0;
      for (const side of ["left", "right"] as const) {
        const edge = side === "left" ? left : right;
        const a0 = edge[i], b0 = edge[i + 1];
        const dx = b0[0] - a0[0], dz = b0[1] - a0[1];
        const L = Math.hypot(dx, dz);
        if (L < 1e-6) continue;
        const ux = dx / L, uz = dz / L;
        const a: Vec2 = [a0[0] + ux * trimA, a0[1] + uz * trimA];
        const b: Vec2 = [b0[0] - ux * trimB, b0[1] - uz * trimB];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < FRONTAGE_MIN) continue;
        // A block faces its line's LEFT. The left ribbon edge sits on the +normal
        // side of the centreline, so its inward (toward-centre) face is its RIGHT
        // → flipped. The right edge is the mirror → not flipped.
        out.push({ streetId: s.id, segment: i, side, a, b, facingFlipped: side === "left" });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/street/frontage.test.ts` → PASS (if the facing test fails, flip the `facingFlipped` rule — the test is the source of truth). Then `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(street): streetFrontages — mitered both-side edges, junction-trimmed (SP-2c T1)"`

---

### Task 2: `FacadeBlock.source` + `syncStreetBlocks`

**Files:**
- Modify: `src/lib/facade/blocks.ts` (add optional `source` field)
- Create: `src/lib/facade/streetBlocks.ts`
- Test: `src/lib/facade/streetBlocks.test.ts`

**Interfaces:**
- Consumes: `streetFrontages`/`Frontage` (T1), `generateBlock`/`refit` (generate.ts), `DEFAULT_GEN`/`FacadeBlock` (blocks.ts), `syncCorners` (corners.ts).
- Produces: `FacadeBlock.source?: { streetId: string; segment: number; side: "left" | "right" }`; `syncStreetBlocks(net, existing, opts): FacadeBlock[]`.

- [ ] **Step 1: Write the failing tests** — `src/lib/facade/streetBlocks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { syncStreetBlocks } from "./streetBlocks";
import { DEFAULT_GEN, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE } from "./types";
import type { StreetNetwork, Vec2 } from "../street/types";

const net = (streets: StreetNetwork["streets"]): StreetNetwork => ({ streets, roundabouts: [] });
const S = (id: string, pts: Vec2[]) => ({ id, type: "street" as const, points: pts });
const OPTS = { gen: DEFAULT_GEN, setback: 3, maxCornerAngle: 150, cornerChoices: new Map() };

describe("syncStreetBlocks", () => {
  it("generates source-tagged frontage blocks for a new street (both sides)", () => {
    const out = syncStreetBlocks(net([S("s1", [[0, 0], [30, 0]])]), [], OPTS);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.every((b) => b.source?.streetId === "s1")).toBe(true);
    expect(new Set(out.map((b) => b.source!.side))).toEqual(new Set(["left", "right"]));
    expect(out.every((b) => b.lots.length > 0)).toBe(true);
  });

  it("never touches hand-drawn (source-less) blocks", () => {
    const hand: FacadeBlock = {
      id: "hand-1", line: { a: [0, 50], b: [10, 50] }, flipped: false,
      gen: DEFAULT_GEN, seed: 1, lots: [{ params: { ...DEFAULT_FACADE, width: 10 }, customized: false }],
    };
    const out = syncStreetBlocks(net([S("s1", [[0, 0], [30, 0]])]), [hand], OPTS);
    expect(out.find((b) => b.id === "hand-1")).toEqual(hand);
  });

  it("removes a street's blocks when the street is gone", () => {
    const first = syncStreetBlocks(net([S("s1", [[0, 0], [30, 0]])]), [], OPTS);
    const after = syncStreetBlocks(net([]), first, OPTS);
    expect(after.some((b) => b.source?.streetId === "s1")).toBe(false);
  });

  it("refits a moved street's blocks and PINS a customized lot", () => {
    const first = syncStreetBlocks(net([S("s1", [[0, 0], [30, 0]])]), [], OPTS);
    // pin lot 0 of the first frontage block
    const pinned = first.map((b, k) =>
      k === 0 ? { ...b, lots: b.lots.map((l, i) => (i === 0 ? { ...l, customized: true } : l)) } : b,
    );
    const moved = syncStreetBlocks(net([S("s1", [[0, 0], [24, 0]])]), pinned, OPTS);
    const b0 = moved.find((b) => b.id === first[0].id)!;
    expect(b0.lots.some((l) => l.customized)).toBe(true); // pin survived the refit
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/facade/streetBlocks.test.ts` → FAIL.

- [ ] **Step 3: Implement** — add to `blocks.ts` the optional field on `FacadeBlock`:

```ts
  /** Set on blocks auto-derived from a street edge (SP-2c). Absent on
   * hand-drawn blocks. Drives street-driven regeneration/refit. */
  source?: { streetId: string; segment: number; side: "left" | "right" };
```

Create `src/lib/facade/streetBlocks.ts`:

```ts
import type { StreetNetwork } from "../street/types";
import { streetFrontages, type Frontage } from "../street/frontage";
import { generateBlock, refit } from "./generate";
import { syncCorners } from "./corners";
import type { CornerChoice } from "./corners";
import type { BlockGenSettings, FacadeBlock } from "./blocks";

const frontageKey = (f: { streetId: string; segment: number; side: string }) =>
  `${f.streetId}#${f.segment}#${f.side}`;
const blockKey = (b: FacadeBlock) =>
  b.source ? `${b.source.streetId}#${b.source.segment}#${b.source.side}` : null;

// Deterministic per-frontage seed so redraws are stable.
function frontageSeed(f: Frontage): number {
  let h = 2166136261;
  for (const ch of frontageKey(f)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export interface SyncOpts {
  gen: BlockGenSettings;
  setback: number;
  maxCornerAngle: number;
  cornerChoices: Map<string, CornerChoice>;
}

/** Reconcile the derived frontage blocks against `existing`, preserving hand
 * edits: hand-drawn (source-less) blocks pass through untouched; a frontage
 * that still exists keeps its block id + gen + seed and REFITS its line
 * (pinned lots survive); new frontages generate; gone frontages drop. Funnels
 * through syncCorners so bends weld into corner buildings. Pure. */
export function syncStreetBlocks(
  net: StreetNetwork,
  existing: FacadeBlock[],
  opts: SyncOpts,
): FacadeBlock[] {
  const frontages = streetFrontages(net, opts.setback);
  const byKey = new Map(
    existing.filter((b) => b.source).map((b) => [blockKey(b)!, b]),
  );
  const hand = existing.filter((b) => !b.source);

  const derived: FacadeBlock[] = frontages.map((f) => {
    const line = { a: [f.a[0], f.a[1]] as [number, number], b: [f.b[0], f.b[1]] as [number, number] };
    const prev = byKey.get(frontageKey(f));
    if (prev) {
      // keep id/gen/seed/lots; update line; refit to the new length (pins survive)
      const relined: FacadeBlock = { ...prev, line, flipped: f.facingFlipped };
      return refit(relined, "b") ?? relined;
    }
    const seed = frontageSeed(f);
    return {
      id: `street:${frontageKey(f)}`,
      line,
      flipped: f.facingFlipped,
      gen: opts.gen,
      seed,
      lots: generateBlock(line, f.facingFlipped, opts.gen, seed),
      source: { streetId: f.streetId, segment: f.segment, side: f.side },
    };
  });

  return syncCorners([...hand, ...derived], opts.cornerChoices, opts.maxCornerAngle);
}
```

Note: frontage block ids are derived (`street:streetId#seg#side`) so they're stable across syncs without touching the session id counter.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/facade/streetBlocks.test.ts` → PASS. Then `npm test` (full) + `npx tsc --noEmit` → green. If `refit(relined, "b")` returns null in the move test, fall back to `relined` (already coded) — the pin still survives because the fallback keeps prev.lots on the new line.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(facade): syncStreetBlocks — derive/refit/remove street frontage blocks, pins survive (SP-2c T2)"`

---

### Task 3: Page wiring + toggle + save/load

**Files:**
- Modify: `src/app/facade/page.tsx`
- Modify: `src/lib/facade/document.ts` (round-trip `source` — likely already passes through)
- Test: `src/lib/facade/document.test.ts` (round-trip a source-tagged block)

**Interfaces:** consumes `syncStreetBlocks` (T2).

- [ ] **Step 1: Wire street mutations to rebuild frontage blocks** — in `page.tsx`, add a `buildingsFromStreets` state (default `true`) and a helper that, after any street change, recomputes blocks:

```ts
const rebuildStreetBlocks = useCallback(
  (nextNet: StreetNetwork, curBlocks: FacadeBlock[]) =>
    buildingsFromStreets
      ? syncStreetBlocks(nextNet, curBlocks, {
          gen: DEFAULT_GEN, setback: STREET_SETBACK,
          maxCornerAngle, cornerChoices,
        })
      : curBlocks,
  [buildingsFromStreets, maxCornerAngle, cornerChoices],
);
```

Call it from `handleCommitStreet`, `handleDeleteStreet`, `handleStreetChange` (type/width), and any street-move handler: compute the next network, then `setBlocks(rebuildStreetBlocks(nextNet, blocks))` alongside `setStreetNetwork(nextNet)`. Toggling `buildingsFromStreets` on rebuilds; off strips `source` blocks (`setBlocks((bs) => bs.filter((b) => !b.source))`).

- [ ] **Step 2: Write the failing test** — in `document.test.ts`, assert a `source`-tagged block round-trips:

```ts
it("round-trips a street-derived block's source link", () => {
  const s: SceneState = {
    blocks: [{ ...mkBlock("street:s1#0#left", [0, 0], [8, 0], [8]),
               source: { streetId: "s1", segment: 0, side: "left" } }],
    cornerChoices: new Map(), ground: DEFAULT_GROUND,
    streetWidth: STREET_WIDTH_DEFAULT, maxCornerAngle: DEFAULT_MAX_CORNER_ANGLE,
    streetNetwork: EMPTY_NETWORK,
  };
  const res = fromJSON(toJSON(s));
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.scene.blocks[0].source).toEqual({ streetId: "s1", segment: 0, side: "left" });
});
```

- [ ] **Step 3: Run — verify + implement** — `npx vitest run src/lib/facade/document.test.ts`. `serializeScene`/`normalizeBlocks` spread the whole block, so `source` should already survive; if `normalizeBlocks` drops unknown fields, carry `source` through explicitly. Make the test pass.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean; `npm test` green; `npx eslint src/app/facade/page.tsx src/lib/facade/streetBlocks.ts src/lib/street/frontage.ts` clean. Visual (browser checkpoint): draw a street → buildings appear on both sides facing it; draw a crossing → buildings trim back at the X; move a street vertex → buildings re-fit; delete the street → buildings vanish; toggle off → only hand-drawn blocks remain.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(facade): auto-populate editable buildings on street edges (SP-2c T3)"`

---

## Self-Review (author checklist)

- **Spec coverage:** frontage geometry + trim + facing (T1) ✔; source field + derive/refit/remove + pin (T2) ✔; page wiring + toggle + save/load (T3) ✔.
- **Byte-identical:** toggle off / empty net / source-less blocks → unchanged; `source` optional so every existing block literal still valid.
- **Reuse:** frontage blocks are plain FacadeBlocks (generateBlock/refit/syncCorners); no fork of the block model.
- **Type consistency:** `Frontage`/`streetFrontages` match between T1 and T2; `source` shape identical in blocks.ts, streetBlocks.ts, document round-trip.
- **Facing** is test-pinned (normal toward centre), not assumed.
