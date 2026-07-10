# Plan-Drawn Facade Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click-drag lines in the plan pane become blocks of seeded-random facades; every generated lot is selectable and editable with the existing controls — the single-facade editor becomes a small streetscape tool.

**Architecture:** Two new pure modules (`blocks.ts`: block/lot geometry math; `generate.ts`: seeded PRNG + subdivision + lot generation + reroll) feed the existing FacadeParams pipeline unchanged — every lot is a v1 `FacadeParams` positioned/rotated along its block line. Page state becomes `blocks: FacadeBlock[]` + `selected`; `SceneContents` renders the world; the plan pane gains a draw mode; elevations track the selected block via the B-established normal seam.

**Tech Stack:** Existing stack. drei `Line` and `Edges` (both present in drei 10.7.7 core). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-09-facade-blocks-design.md`

## Global Constraints

- **Determinism:** same line + settings + seed → identical street. Seeded PRNG (mulberry32); `Math.random()` allowed ONLY in page-level handlers to mint fresh seeds/ids, never inside `generate.ts`/`blocks.ts`.
- **Reroll semantics:** new seed regenerates ONLY lots with `customized === false`; the subdivision (lot widths) and pinned lots are preserved. Hand-editing a lot sets `customized: true`.
- **Coordinate contract:** block lines live in plan coords `[x, z]`. `blockFrame` handles `flipped` by swapping endpoints so all downstream math ignores it. For the v1 starting line `a=(-w/2,0) → b=(w/2,0)` the frame normal MUST be `[0, 1]` (+z), matching the v1 facade — this is the invariant that keeps elevations perpendicular (they consume the block normal via `elevationCameraPosition`).
- **Grid model unchanged:** lots are full v1 `FacadeParams`; `layout.ts`, `FacadeMesh`, `BayGrid`, prompt parser, AI route are NOT modified.
- Drawing: one drag = one straight segment, facades on one side + flip control; endpoint snapping radius 1 m; minimum block length 3 m; draw mode disables plan-pane MapControls while active.
- Selection: click a lot → lot inspector (existing controls); click the selected lot again → block inspector (gen ranges, preset pool, shopfrontShare, variation, seed + Reroll, Flip, Delete-with-confirm — NO browser confirm() dialogs, use a two-step button). Something is always selected; deleting the last block recreates the v1 starting world.
- Neighbor masses (LotContext) render only while the world is exactly the single starting block with one lot.
- Follow-ups folded in (from B's final review): `fitOrthoZoom` gains a Number.isFinite guard + corrected doc comment; the neighbor width constant is shared between SceneContents and the plan fit.
- Branch `feature/facade-blocks` off `main`. Gate per task: `npm test && npx tsc --noEmit && npm run lint` (49 tests at start). Dev server on :3000 may be running — leave it. Unrelated dirty files (public/default.glb, python/vendor submodule): leave untouched.

---

### Task 1: Block geometry module (TDD)

**Files:**
- Create: `src/lib/facade/blocks.ts`
- Create: `src/lib/facade/blocks.test.ts`

**Interfaces:**
- Consumes: `FacadeParams`, `PresetId` from `./types`.
- Produces (Tasks 2-6 import exactly these): `BlockGenSettings`, `DEFAULT_GEN`, `LotState`, `FacadeBlock`, `BlockFrame`, `blockFrame(block)`, `LotPlacement`, `lotPlacements(block)`, `totalLotsWidth(block)`, `syncLineToLots(block)`, `nextBlockId()`, `initialWorld(params)`, `snapPoint(p, blocks, radius?)`.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git checkout -b feature/facade-blocks
```

- [ ] **Step 2: Write the failing tests** — `src/lib/facade/blocks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  blockFrame,
  lotPlacements,
  totalLotsWidth,
  syncLineToLots,
  initialWorld,
  snapPoint,
  DEFAULT_GEN,
  type FacadeBlock,
} from "./blocks";
import { DEFAULT_FACADE } from "./types";

const lot = (width: number) => ({
  params: { ...DEFAULT_FACADE, width },
  customized: false,
});

const block = (over: Partial<FacadeBlock>): FacadeBlock => ({
  id: "t",
  line: { a: [-5, 0], b: [5, 0] },
  flipped: false,
  gen: DEFAULT_GEN,
  seed: 1,
  lots: [lot(10)],
  ...over,
});

describe("blockFrame", () => {
  it("v1 starting line has normal +z (the v1 facade orientation)", () => {
    const f = blockFrame(block({}));
    expect(f.dir[0]).toBeCloseTo(1, 9);
    expect(f.dir[1]).toBeCloseTo(0, 9);
    expect(f.normal[0]).toBeCloseTo(0, 9);
    expect(f.normal[1]).toBeCloseTo(1, 9);
    expect(f.length).toBeCloseTo(10, 9);
    expect(f.origin).toEqual([-5, 0]);
  });

  it("flipped swaps endpoints, reversing dir and normal", () => {
    const f = blockFrame(block({ flipped: true }));
    expect(f.origin).toEqual([5, 0]);
    expect(f.dir[0]).toBeCloseTo(-1, 9);
    expect(f.normal[1]).toBeCloseTo(-1, 9);
  });

  it("diagonal line (3-4-5) has a unit left-perpendicular normal", () => {
    const f = blockFrame(block({ line: { a: [0, 0], b: [3, 4] } }));
    expect(f.length).toBeCloseTo(5, 9);
    expect(f.dir[0]).toBeCloseTo(0.6, 9);
    expect(f.dir[1]).toBeCloseTo(0.8, 9);
    expect(f.normal[0]).toBeCloseTo(-0.8, 9);
    expect(f.normal[1]).toBeCloseTo(0.6, 9);
    // unit + perpendicular
    expect(Math.hypot(f.normal[0], f.normal[1])).toBeCloseTo(1, 9);
    expect(f.dir[0] * f.normal[0] + f.dir[1] * f.normal[1]).toBeCloseTo(0, 9);
  });
});

describe("lotPlacements", () => {
  it("lays lots at their midpoints along the line", () => {
    const b = block({ lots: [lot(4), lot(6)] });
    const p = lotPlacements(b);
    expect(p).toHaveLength(2);
    // origin -5: lot0 mid at -5+2=-3, lot1 mid at -5+4+3=2
    expect(p[0].position[0]).toBeCloseTo(-3, 9);
    expect(p[1].position[0]).toBeCloseTo(2, 9);
    expect(p[0].position[1]).toBe(0);
    expect(p[0].position[2]).toBeCloseTo(0, 9);
    expect(p[0].rotationY).toBeCloseTo(0, 9); // v1 orientation
    expect(p[1].width).toBe(6);
  });

  it("rotationY maps local +z to the frame normal on a diagonal line", () => {
    const b = block({ line: { a: [0, 0], b: [3, 4] }, lots: [lot(5)] });
    const [p] = lotPlacements(b);
    const f = blockFrame(b);
    // local +z under yaw θ maps to (sinθ, cosθ) in (x, z)
    expect(Math.sin(p.rotationY)).toBeCloseTo(f.normal[0], 9);
    expect(Math.cos(p.rotationY)).toBeCloseTo(f.normal[1], 9);
  });
});

describe("syncLineToLots", () => {
  it("extends line.b when lot widths grow", () => {
    const b = syncLineToLots(block({ lots: [lot(4), lot(8)] }));
    expect(totalLotsWidth(b)).toBe(12);
    expect(b.line.a).toEqual([-5, 0]);
    expect(b.line.b[0]).toBeCloseTo(7, 9); // -5 + 12
    expect(b.line.b[1]).toBeCloseTo(0, 9);
  });

  it("respects flipped (effective origin is b)", () => {
    const b = syncLineToLots(block({ flipped: true, lots: [lot(4)] }));
    expect(b.line.b).toEqual([5, 0]); // effective origin preserved
    expect(b.line.a[0]).toBeCloseTo(1, 9); // 5 - 4 along dir (-1,0)
  });
});

describe("initialWorld / snapPoint", () => {
  it("initialWorld is one unpinned lot on a width-matched +z line", () => {
    const w = initialWorld({ ...DEFAULT_FACADE, width: 8 });
    expect(w.lots).toHaveLength(1);
    expect(w.lots[0].customized).toBe(false);
    expect(w.line.a[0]).toBeCloseTo(-4, 9);
    expect(w.line.b[0]).toBeCloseTo(4, 9);
    expect(blockFrame(w).normal[1]).toBeCloseTo(1, 9);
  });

  it("snapPoint snaps to endpoints within the radius, not beyond", () => {
    const blocks = [block({})]; // endpoints (-5,0) and (5,0)
    expect(snapPoint([4.4, 0.5], blocks, 1)).toEqual([5, 0]);
    expect(snapPoint([3, 3], blocks, 1)).toEqual([3, 3]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/facade/blocks.test.ts`
Expected: FAIL — cannot resolve `./blocks`.

- [ ] **Step 4: Create `src/lib/facade/blocks.ts`**

```ts
import type { FacadeParams, PresetId } from "./types";

export interface BlockGenSettings {
  lotWidth: { min: number; max: number };
  storeys: { min: number; max: number };
  /** Allowed preset pool the generator draws characters from. */
  presets: PresetId[];
  /** 0–1 chance a lot's ground floor is retail. */
  shopfrontShare: number;
  /** 0–1 jitter on ratios/colors/ornament. */
  variation: number;
}

export const DEFAULT_GEN: BlockGenSettings = {
  lotWidth: { min: 5, max: 9 },
  storeys: { min: 2, max: 4 },
  presets: ["georgian", "victorian-shopfront", "modern"],
  shopfrontShare: 0.3,
  variation: 0.5,
};

export interface LotState {
  /** A full v1 citizen — the entire existing stack consumes it unchanged. */
  params: FacadeParams;
  /** Hand-edited → reroll must not touch it. */
  customized: boolean;
}

export interface FacadeBlock {
  id: string;
  /** Drawn segment in plan coords [x, z], meters. */
  line: { a: [number, number]; b: [number, number] };
  /** Facades face the line's left side; flipped swaps sides. */
  flipped: boolean;
  gen: BlockGenSettings;
  seed: number;
  /** In order along the (effective) line. */
  lots: LotState[];
}

export interface BlockFrame {
  origin: [number, number];
  /** Unit vector along the effective line. */
  dir: [number, number];
  /** Unit outward facade normal, plan coords. */
  normal: [number, number];
  length: number;
}

/** flipped swaps the endpoints HERE so all downstream math ignores it.
 * For the v1 starting line a=(-w/2,0)→b=(w/2,0) the normal is [0,1] (+z),
 * matching the v1 facade orientation — a binding invariant. */
export function blockFrame(
  block: Pick<FacadeBlock, "line" | "flipped">,
): BlockFrame {
  const a = block.flipped ? block.line.b : block.line.a;
  const b = block.flipped ? block.line.a : block.line.b;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  const inv = length > 0 ? 1 / length : 1;
  const dir: [number, number] = [dx * inv, dz * inv];
  const normal: [number, number] = [-dir[1], dir[0]];
  return { origin: [a[0], a[1]], dir, normal, length };
}

export interface LotPlacement {
  /** World position of the lot's facade centerline at ground level. */
  position: [number, number, number];
  rotationY: number;
  width: number;
}

/** Lay the lots along the frame in order. rotationY maps the lot's local
 * +x to the frame dir and local +z to the frame normal. */
export function lotPlacements(block: FacadeBlock): LotPlacement[] {
  const { origin, dir } = blockFrame(block);
  const rotationY = Math.atan2(-dir[1], dir[0]);
  let t = 0;
  return block.lots.map((lot) => {
    const w = lot.params.width;
    const mid = t + w / 2;
    t += w;
    return {
      position: [origin[0] + dir[0] * mid, 0, origin[1] + dir[1] * mid],
      rotationY,
      width: w,
    };
  });
}

export function totalLotsWidth(block: FacadeBlock): number {
  return block.lots.reduce((s, l) => s + l.params.width, 0);
}

/** Lot edits change widths — keep the line in sync so the drawn segment and
 * the built street never drift. The effective origin stays fixed. */
export function syncLineToLots(block: FacadeBlock): FacadeBlock {
  const { origin, dir } = blockFrame(block);
  const len = totalLotsWidth(block);
  const end: [number, number] = [
    origin[0] + dir[0] * len,
    origin[1] + dir[1] * len,
  ];
  return {
    ...block,
    line: block.flipped
      ? { a: end, b: origin }
      : { a: origin, b: end },
  };
}

let idCounter = 0;
/** Session-unique ids (no persistence in v1). */
export function nextBlockId(): string {
  idCounter += 1;
  return `block-${idCounter}`;
}

/** The v1 single-facade world: one block, one unpinned lot. */
export function initialWorld(params: FacadeParams): FacadeBlock {
  return {
    id: nextBlockId(),
    line: { a: [-params.width / 2, 0], b: [params.width / 2, 0] },
    flipped: false,
    gen: DEFAULT_GEN,
    seed: 1,
    lots: [{ params, customized: false }],
  };
}

/** Endpoint snapping for the drawing tool. */
export function snapPoint(
  p: [number, number],
  blocks: FacadeBlock[],
  radius = 1,
): [number, number] {
  let best = p;
  let bestD = radius;
  for (const b of blocks) {
    for (const e of [b.line.a, b.line.b]) {
      const d = Math.hypot(p[0] - e[0], p[1] - e[1]);
      if (d < bestD) {
        bestD = d;
        best = [e[0], e[1]];
      }
    }
  }
  return best;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/blocks.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Full gate and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 58 tests, clean.

```bash
git add src/lib/facade/blocks.ts src/lib/facade/blocks.test.ts
git commit -m "feat(facade): block geometry — frames, lot placement, line sync, snapping"
```

---

### Task 2: Seeded generator (TDD)

**Files:**
- Create: `src/lib/facade/generate.ts`
- Create: `src/lib/facade/generate.test.ts`

**Interfaces:**
- Consumes: `BlockGenSettings`, `FacadeBlock`, `LotState`, `blockFrame` (Task 1); `DEFAULT_FACADE`, `FACADE_PRESETS`, `DOOR_SWATCHES`, `FacadeParams`, `WindowStyleId` from `./types`; `WALL_SWATCHES`, `classicalStoreyHeights` from `@/lib/building/types`; `computeLayout` from `./layout` (tests only).
- Produces (Tasks 3-5 consume): `mulberry32(seed): () => number`, `subdivide(length, min, max, rand): number[]`, `generateLot(width, gen, rand): FacadeParams`, `generateBlock(line, flipped, gen, seed): LotState[]`, `rerollBlock(block, seed): FacadeBlock`.

- [ ] **Step 1: Write the failing tests** — `src/lib/facade/generate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  mulberry32,
  subdivide,
  generateLot,
  generateBlock,
  rerollBlock,
} from "./generate";
import { DEFAULT_GEN, initialWorld, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE, FACADE_LIMITS, FACADE_PRESETS } from "./types";
import { computeLayout } from "./layout";

describe("mulberry32", () => {
  it("is deterministic and bounded to [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Set(seqA).size).toBeGreaterThan(15); // actually random-ish
  });
});

describe("subdivide", () => {
  it("widths sum to the length, all-but-last within [min,max]", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rand = mulberry32(seed);
      const widths = subdivide(42.5, 5, 9, rand);
      const sum = widths.reduce((s, w) => s + w, 0);
      expect(sum).toBeCloseTo(42.5, 9);
      for (const w of widths.slice(0, -1)) {
        expect(w).toBeGreaterThanOrEqual(5 - 1e-9);
        expect(w).toBeLessThanOrEqual(9 + 1e-9);
      }
      const last = widths[widths.length - 1];
      expect(last).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(last).toBeLessThan(10); // ≤ max, or in the (max, 2·min) corner
    }
  });

  it("a segment shorter than min becomes a single lot", () => {
    expect(subdivide(3, 5, 9, mulberry32(1))).toEqual([3]);
  });
});

describe("generateLot", () => {
  it("produces valid params across many seeds (layout invariants hold)", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const p = generateLot(6.5, DEFAULT_GEN, mulberry32(seed));
      expect(p.width).toBe(6.5);
      expect(p.storeys).toBeGreaterThanOrEqual(DEFAULT_GEN.storeys.min);
      expect(p.storeys).toBeLessThanOrEqual(DEFAULT_GEN.storeys.max);
      expect(p.bays).toBeGreaterThanOrEqual(FACADE_LIMITS.bays.min);
      expect(p.groundFloor.doorBay).toBeLessThan(p.bays);
      expect(p.storeyHeights).toHaveLength(p.storeys);
      expect(p.preset).toBeUndefined();
      // the generated lot must render valid geometry
      const layout = computeLayout(p);
      for (const o of layout.openings) {
        expect(o.x).toBeGreaterThanOrEqual(-layout.width / 2 - 1e-9);
        expect(o.x + o.w).toBeLessThanOrEqual(layout.width / 2 + 1e-9);
        expect(o.y + o.h).toBeLessThanOrEqual(layout.wallTop + 1e-9);
      }
    }
  });

  it("shopfrontShare extremes: 0 → never retail, 1 → always retail", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const none = generateLot(7, { ...DEFAULT_GEN, shopfrontShare: 0 }, mulberry32(seed));
      expect(none.groundFloor.treatment).not.toBe("shopfront");
      const all = generateLot(7, { ...DEFAULT_GEN, shopfrontShare: 1 }, mulberry32(seed));
      expect(all.groundFloor.treatment).toBe("shopfront");
    }
  });

  it("respects the preset pool at zero variation", () => {
    const gen = { ...DEFAULT_GEN, presets: ["modern" as const], variation: 0 };
    const p = generateLot(7, gen, mulberry32(3));
    expect(p.wallColor).toBe(FACADE_PRESETS.modern.params.wallColor);
    expect(p.windowStyle).toBe("none");
  });
});

describe("generateBlock / rerollBlock", () => {
  const line = { a: [0, 0] as [number, number], b: [30, 0] as [number, number] };

  it("is deterministic: same inputs → identical lots", () => {
    const x = generateBlock(line, false, DEFAULT_GEN, 7);
    const y = generateBlock(line, false, DEFAULT_GEN, 7);
    expect(x).toEqual(y);
    const widths = x.reduce((s, l) => s + l.params.width, 0);
    expect(widths).toBeCloseTo(30, 9);
  });

  it("reroll pins customized lots, regenerates the rest, keeps widths", () => {
    const lots = generateBlock(line, false, DEFAULT_GEN, 7);
    const block: FacadeBlock = {
      ...initialWorld(DEFAULT_FACADE),
      line,
      lots: lots.map((l, i) => (i === 1 ? { ...l, customized: true } : l)),
      seed: 7,
    };
    const rerolled = rerollBlock(block, 99);
    expect(rerolled.lots[1]).toEqual(block.lots[1]); // pinned, untouched
    expect(rerolled.lots[0].params.width).toBe(block.lots[0].params.width);
    expect(rerolled.seed).toBe(99);
    // at least one unpinned lot actually changed
    const changed = rerolled.lots.some(
      (l, i) => i !== 1 && JSON.stringify(l) !== JSON.stringify(block.lots[i]),
    );
    expect(changed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/facade/generate.test.ts`
Expected: FAIL — cannot resolve `./generate`.

- [ ] **Step 3: Create `src/lib/facade/generate.ts`**

```ts
import type { FacadeParams, WindowStyleId } from "./types";
import { DEFAULT_FACADE, FACADE_PRESETS, DOOR_SWATCHES } from "./types";
import { WALL_SWATCHES, classicalStoreyHeights } from "@/lib/building/types";
import type { BlockGenSettings, FacadeBlock, LotState } from "./blocks";
import { blockFrame } from "./blocks";

/** Deterministic PRNG (mulberry32) — same seed, same street. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randIn = (rand: () => number, min: number, max: number) =>
  min + rand() * (max - min);
const randInt = (rand: () => number, min: number, max: number) =>
  Math.min(max, Math.floor(randIn(rand, min, max + 1)));
const pick = <T,>(rand: () => number, arr: T[]): T =>
  arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];
const jitter = (rand: () => number, amount: number) =>
  (rand() * 2 - 1) * amount;
const clampRange = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** Split `length` into lot widths. All lots within [min,max] except: the
 * last lot may land in (max, 2·min) when the tail can't be split further
 * (only possible when max < 2·min), and a segment shorter than min becomes
 * a single full-length lot. Sum is always exactly `length`. */
export function subdivide(
  length: number,
  min: number,
  max: number,
  rand: () => number,
): number[] {
  if (length <= min) return [length];
  const widths: number[] = [];
  let remaining = length;
  while (remaining > max && remaining >= min * 2) {
    const w = randIn(rand, min, Math.min(max, remaining - min));
    widths.push(w);
    remaining -= w;
  }
  widths.push(remaining);
  return widths;
}

/** One lot's FacadeParams: preset character from the pool, then jittered by
 * `variation`. Generated lots carry no active preset chip. */
export function generateLot(
  width: number,
  gen: BlockGenSettings,
  rand: () => number,
): FacadeParams {
  const presetId = gen.presets.length > 0 ? pick(rand, gen.presets) : undefined;
  const base: FacadeParams = {
    ...DEFAULT_FACADE,
    ...(presetId ? FACADE_PRESETS[presetId].params : {}),
    cellOverrides: [],
    preset: undefined,
  };
  const v = gen.variation;
  const storeys = randInt(rand, gen.storeys.min, gen.storeys.max);
  const storeyHeight = +clampRange(
    base.storeyHeight + jitter(rand, 0.2 * v),
    2.4,
    4.0,
  ).toFixed(2);
  const bays = clampRange(Math.round(width / randIn(rand, 2.2, 3.0)), 1, 6);
  const shopfront = rand() < gen.shopfrontShare;
  const treatment = shopfront
    ? ("shopfront" as const)
    : base.groundFloor.treatment;
  return {
    ...base,
    width,
    storeys,
    storeyHeight,
    storeyHeights: classicalStoreyHeights(storeys, storeyHeight),
    bays,
    windowWidthRatio: clampRange(
      base.windowWidthRatio + jitter(rand, 0.1 * v),
      0.2,
      0.8,
    ),
    windowHeightRatio: clampRange(
      base.windowHeightRatio + jitter(rand, 0.1 * v),
      0.3,
      0.8,
    ),
    groundFloor: {
      treatment,
      doorBay: randInt(rand, 0, bays - 1),
      stoop: treatment === "residential" ? rand() < 0.5 : false,
    },
    ornament: {
      cornice:
        rand() < v * 0.5 ? !base.ornament.cornice : base.ornament.cornice,
      parapet:
        rand() < v * 0.5 ? !base.ornament.parapet : base.ornament.parapet,
      sills: base.ornament.sills,
      surrounds:
        rand() < v * 0.5 ? !base.ornament.surrounds : base.ornament.surrounds,
    },
    wallColor: rand() < v ? pick(rand, WALL_SWATCHES).hex : base.wallColor,
    trimColor:
      rand() < v * 0.5 ? pick(rand, WALL_SWATCHES).hex : base.trimColor,
    doorColor: rand() < v ? pick(rand, DOOR_SWATCHES).hex : base.doorColor,
    windowStyle:
      rand() < v * 0.3
        ? pick(rand, ["georgian", "sash", "victorian", "none"] as WindowStyleId[])
        : base.windowStyle,
  };
}

/** Per-lot independent seed streams so lot i's character doesn't shift when
 * an earlier lot's generation consumes a different number of samples. */
const lotSeed = (seed: number, i: number) => (seed + (i + 1) * 7919) >>> 0;

export function generateBlock(
  line: FacadeBlock["line"],
  flipped: boolean,
  gen: BlockGenSettings,
  seed: number,
): LotState[] {
  const { length } = blockFrame({ line, flipped });
  const widths = subdivide(length, gen.lotWidth.min, gen.lotWidth.max, mulberry32(seed));
  return widths.map((w, i) => ({
    params: generateLot(w, gen, mulberry32(lotSeed(seed, i))),
    customized: false,
  }));
}

/** New seed regenerates ONLY unpinned lots; widths and pinned lots persist. */
export function rerollBlock(block: FacadeBlock, seed: number): FacadeBlock {
  return {
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
          },
    ),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/generate.test.ts`
Expected: PASS (7 tests). If the shopfrontShare-extremes test fails: check the order of `rand()` consumption — `shopfront` must be rolled with `rand() < gen.shopfrontShare` exactly once per lot regardless of preset.

- [ ] **Step 5: Full gate and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 65 tests, clean.

```bash
git add src/lib/facade/generate.ts src/lib/facade/generate.test.ts
git commit -m "feat(facade): seeded street generator — subdivision, lot params, reroll"
```

---

### Task 3: World state + blocks scene (visual checkpoint: identical single-lot world)

**Files:**
- Modify: `src/app/facade/page.tsx` (state model: blocks + selected)
- Modify: `src/components/facade/SceneContents.tsx` (render the blocks world)
- Modify: `src/components/facade/FacadeViewer.tsx` (prop pass-through only)

**Interfaces:**
- Consumes: `FacadeBlock`, `LotState`, `initialWorld`, `lotPlacements`, `blockFrame`, `syncLineToLots` (Task 1).
- Produces: `Selection = { blockId: string; lot: number; level: "lot" | "block" }` (exported from `src/lib/facade/blocks.ts` — add it there in this task); new prop contracts:
  - `FacadeViewer({ blocks, selected, onSelectLot, context, view })`
  - `SceneContents({ blocks, selected, onSelectLot, context, view })`
  Task 4 adds inspector props to FacadeControls; Task 5 adds drawing props to FacadeViewer.

- [ ] **Step 1: Add the Selection type** to `src/lib/facade/blocks.ts`:

```ts
export interface Selection {
  blockId: string;
  lot: number;
  level: "lot" | "block";
}
```

- [ ] **Step 2: Rewire page state** in `src/app/facade/page.tsx`:

Replace the single-params state block:

```tsx
  const [params, setParams] = useState<FacadeParams>(DEFAULT_FACADE);
```

with:

```tsx
  const [blocks, setBlocks] = useState<FacadeBlock[]>(() => [
    initialWorld(DEFAULT_FACADE),
  ]);
  const [selected, setSelected] = useState<Selection>(() => ({
    blockId: blocks[0].id,
    lot: 0,
    level: "lot",
  }));
```

NOTE: the `useState` initializer for `selected` cannot reference `blocks`
before it exists — initialize both from one constant instead:

```tsx
  const [initial] = useState(() => initialWorld(DEFAULT_FACADE));
  const [blocks, setBlocks] = useState<FacadeBlock[]>([initial]);
  const [selected, setSelected] = useState<Selection>({
    blockId: initial.id,
    lot: 0,
    level: "lot",
  });
```

Derive the selected lot and its setter (place right after the state):

```tsx
  const selectedBlock =
    blocks.find((b) => b.id === selected.blockId) ?? blocks[0];
  const selectedLot =
    selectedBlock.lots[Math.min(selected.lot, selectedBlock.lots.length - 1)];
  const params = selectedLot.params;

  // Every existing consumer (controls, prompt, AI, header) edits the
  // SELECTED lot; hand edits pin it against reroll and keep the block
  // line in sync with the new widths.
  const setParams = useCallback(
    (next: FacadeParams | ((prev: FacadeParams) => FacadeParams)) => {
      setBlocks((bs) =>
        bs.map((b) => {
          if (b.id !== selected.blockId) return b;
          const lotIndex = Math.min(selected.lot, b.lots.length - 1);
          const prev = b.lots[lotIndex].params;
          const value = typeof next === "function" ? next(prev) : next;
          const lots = b.lots.map((l, i) =>
            i === lotIndex ? { params: value, customized: true } : l,
          );
          return syncLineToLots({ ...b, lots });
        }),
      );
    },
    [selected],
  );

  const handleSelectLot = useCallback((blockId: string, lot: number) => {
    setSelected((s) =>
      s.blockId === blockId && s.lot === lot && s.level === "lot"
        ? { blockId, lot, level: "block" } // second click promotes to block
        : { blockId, lot, level: "lot" },
    );
  }, []);
```

Imports to extend: `initialWorld, syncLineToLots, type FacadeBlock, type Selection` from `@/lib/facade/blocks`.

The existing `handlePrompt` and `specToFacadeParams` code paths work
unchanged because `params`/`setParams` keep their exact contracts
(`setParams` accepts both a value and an updater, as before).

Update the FacadeViewer usage:

```tsx
          <FacadeViewer
            blocks={blocks}
            selected={selected}
            onSelectLot={handleSelectLot}
            context={context}
            view={view}
          />
```

- [ ] **Step 3: FacadeViewer prop pass-through** in `src/components/facade/FacadeViewer.tsx`:

Change the props interface and every `<SceneContents params={params} …/>` usage:

```tsx
interface FacadeViewerProps {
  blocks: FacadeBlock[];
  selected: Selection;
  onSelectLot: (blockId: string, lot: number) => void;
  context: LotContext;
  view?: ViewSettings;
}
```

- import `type FacadeBlock, type Selection` from `@/lib/facade/blocks`.
- Every pane content component (`PlanPane`, `PerspectivePane`, `ElevationPane`) swaps its `params: FacadeParams` prop for `blocks/selected/onSelectLot` and passes them to `<SceneContents blocks={blocks} selected={selected} onSelectLot={onSelectLot} context={context} view={view} />`.
- Panes that used `computeLayout(params)` for fitting (`PlanPane`, `ElevationPane`) temporarily fit on the SELECTED lot's params in this task: derive `const selBlock = blocks.find((b) => b.id === selected.blockId) ?? blocks[0]; const selParams = selBlock.lots[Math.min(selected.lot, selBlock.lots.length - 1)].params;` and keep the existing `computeLayout(selParams)` math (Task 6 replaces this with world/block fitting).

- [ ] **Step 4: Blocks world rendering** in `src/components/facade/SceneContents.tsx`:

Props change:

```tsx
export default function SceneContents({
  blocks,
  selected,
  onSelectLot,
  context,
  view,
}: {
  blocks: FacadeBlock[];
  selected: Selection;
  onSelectLot: (blockId: string, lot: number) => void;
  context: LotContext;
  view: ViewSettings;
}) {
```

Imports to add: `blockFrame, lotPlacements, type FacadeBlock, type Selection` from `@/lib/facade/blocks`; `computeLayout` from `@/lib/facade/layout`; `Edges, Line` from `@react-three/drei`.

Replace the single `<FacadeMesh params={params} />` with the world:

```tsx
      {blocks.map((block) => (
        <BlockGroup
          key={block.id}
          block={block}
          selected={selected}
          onSelectLot={onSelectLot}
        />
      ))}
```

Add the components (in the same file, above SceneContents):

```tsx
function SelectionMarker({ params }: { params: FacadeParams }) {
  const h = useMemo(() => computeLayout(params).totalHeight, [params]);
  return (
    <mesh position={[0, h / 2, -0.15]}>
      <boxGeometry args={[params.width + 0.15, h + 0.15, 0.7]} />
      <meshBasicMaterial visible={false} />
      <Edges color="#3b82f6" lineWidth={1.5} />
    </mesh>
  );
}

function BlockGroup({
  block,
  selected,
  onSelectLot,
}: {
  block: FacadeBlock;
  selected: Selection;
  onSelectLot: (blockId: string, lot: number) => void;
}) {
  const placements = useMemo(() => lotPlacements(block), [block]);
  const frame = useMemo(() => blockFrame(block), [block]);
  const isSelectedBlock = selected.blockId === block.id;
  const mid: [number, number, number] = [
    frame.origin[0] + (frame.dir[0] * frame.length) / 2,
    0,
    frame.origin[1] + (frame.dir[1] * frame.length) / 2,
  ];
  const yaw = Math.atan2(-frame.dir[1], frame.dir[0]);
  return (
    <group>
      {block.lots.map((lot, i) => (
        <group
          key={`${block.id}-${i}`}
          position={placements[i].position}
          rotation={[0, placements[i].rotationY, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onSelectLot(block.id, i);
          }}
        >
          <FacadeMesh params={lot.params} />
          {isSelectedBlock && selected.lot === i && (
            <SelectionMarker params={lot.params} />
          )}
        </group>
      ))}
      {/* Per-block sidewalk strip on the street side of the line */}
      <group position={mid} rotation={[0, yaw, 0]}>
        <mesh position={[0, 0.005, 1.25]} receiveShadow>
          <boxGeometry args={[frame.length, 0.01, 2.5]} />
          <meshStandardMaterial color="#8f8a80" roughness={0.9} />
        </mesh>
      </group>
      {/* The block's line — always visible in plan, accented when selected */}
      <Line
        points={[
          [block.line.a[0], 0.06, block.line.a[1]],
          [block.line.b[0], 0.06, block.line.b[1]],
        ]}
        color={isSelectedBlock && selected.level === "block" ? "#3b82f6" : "#4a4a48"}
        lineWidth={isSelectedBlock && selected.level === "block" ? 3 : 1.5}
      />
    </group>
  );
}
```

Then:
- DELETE the old global axis-aligned sidewalk and road strip meshes (the per-block strip replaces them; roads emerge between facing blocks).
- Gate the neighbor masses: render `<NeighborMasses …/>` only when
  `blocks.length === 1 && blocks[0].lots.length === 1 && context.show`
  (facadeWidth from `blocks[0].lots[0].params.width`).
- The fading ground plane, grid, lights, Environment, ContactShadows stay.

- [ ] **Step 5: Gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 65 tests, clean.

- [ ] **Step 6: VISUAL CHECKPOINT** (controller)

`/facade` must look and behave essentially IDENTICAL to before this task
(one facade, neighbor masses, sidewalk strip along it, all controls +
prompt + presets editing it live in all four panes). The one intended
difference: a subtle block line under the facade and a blue selection
outline around it. This checkpoint gates the refactor.

- [ ] **Step 7: Commit**

```bash
git add src/app/facade/page.tsx src/components/facade/SceneContents.tsx src/components/facade/FacadeViewer.tsx src/lib/facade/blocks.ts
git commit -m "feat(facade): blocks world state — selected-lot editing, world rendering"
```

---

### Task 4: Block inspector + selection promotion

**Files:**
- Modify: `src/components/facade/FacadeControls.tsx` (block-inspector mode)
- Modify: `src/app/facade/page.tsx` (block-level handlers)

**Interfaces:**
- Consumes: `Selection`, `FacadeBlock`, `BlockGenSettings`, `DEFAULT_GEN` (Task 1), `rerollBlock`, `generateBlock` (Task 2), existing `Toggle`/`SliderRow`/`Section` components in FacadeControls.
- Produces: extended `FacadeControlsProps`:

```ts
interface FacadeControlsProps {
  params: FacadeParams;
  onChange: (p: FacadeParams) => void;
  context: LotContext;
  onContextChange: (c: LotContext) => void;
  view: ViewSettings;
  onViewChange: (v: ViewSettings) => void;
  // block inspector (Task 4)
  selection: Selection;
  block: FacadeBlock;
  onSelectionLevel: (level: "lot" | "block") => void;
  onGenChange: (gen: BlockGenSettings) => void;
  onReroll: () => void;
  onFlip: () => void;
  onDeleteBlock: () => void;
}
```

- [ ] **Step 1: Page handlers** in `src/app/facade/page.tsx` (below `handleSelectLot`):

```tsx
  const updateSelectedBlock = useCallback(
    (fn: (b: FacadeBlock) => FacadeBlock) => {
      setBlocks((bs) => bs.map((b) => (b.id === selected.blockId ? fn(b) : b)));
    },
    [selected.blockId],
  );

  const handleGenChange = useCallback(
    (gen: BlockGenSettings) => updateSelectedBlock((b) => ({ ...b, gen })),
    [updateSelectedBlock],
  );

  const handleReroll = useCallback(() => {
    const seed = Math.floor(Math.random() * 1e9);
    updateSelectedBlock((b) => rerollBlock(b, seed));
  }, [updateSelectedBlock]);

  const handleFlip = useCallback(
    () => updateSelectedBlock((b) => ({ ...b, flipped: !b.flipped })),
    [updateSelectedBlock],
  );

  const handleDeleteBlock = useCallback(() => {
    setBlocks((bs) => {
      const rest = bs.filter((b) => b.id !== selected.blockId);
      const next = rest.length > 0 ? rest : [initialWorld(DEFAULT_FACADE)];
      setSelected({ blockId: next[0].id, lot: 0, level: "lot" });
      return next;
    });
  }, [selected.blockId]);

  const handleSelectionLevel = useCallback(
    (level: "lot" | "block") => setSelected((s) => ({ ...s, level })),
    [],
  );
```

Pass all of them (plus `selection={selected}` and `block={selectedBlock}`)
to `<FacadeControls …/>`.

- [ ] **Step 2: Block inspector UI** in `src/components/facade/FacadeControls.tsx`:

Extend the props interface as in **Interfaces**. Add imports:
`type Selection, type FacadeBlock, type BlockGenSettings` from
`@/lib/facade/blocks`; `useState` from react (for the two-step delete).

At the TOP of the returned `<div className="space-y-5">`, add the
level breadcrumb (always visible):

```tsx
      <div className="grid grid-cols-2 gap-1">
        <Toggle
          label={`Lot ${selection.lot + 1}/${block.lots.length}`}
          on={selection.level === "lot"}
          onClick={() => onSelectionLevel("lot")}
        />
        <Toggle
          label="Block"
          on={selection.level === "block"}
          onClick={() => onSelectionLevel("block")}
        />
      </div>
```

Then wrap the ENTIRE existing controls body (presets row through the
Context & Sun section) in `{selection.level === "lot" && (<>…</>)}` and add
the block inspector as its sibling:

```tsx
      {selection.level === "block" && (
        <BlockInspector
          block={block}
          onGenChange={onGenChange}
          onReroll={onReroll}
          onFlip={onFlip}
          onDeleteBlock={onDeleteBlock}
        />
      )}
```

New component in the same file (uses the existing `Section`, `SliderRow`,
`Toggle` helpers — note gen-range settings apply on the NEXT reroll):

```tsx
function BlockInspector({
  block,
  onGenChange,
  onReroll,
  onFlip,
  onDeleteBlock,
}: {
  block: FacadeBlock;
  onGenChange: (gen: BlockGenSettings) => void;
  onReroll: () => void;
  onFlip: () => void;
  onDeleteBlock: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const gen = block.gen;
  const update = (u: Partial<BlockGenSettings>) => onGenChange({ ...gen, ...u });
  return (
    <div className="space-y-5">
      <Section title="Generation">
        <SliderRow
          label="Lot width min"
          value={gen.lotWidth.min}
          display={`${gen.lotWidth.min.toFixed(1)}m`}
          min={4}
          max={gen.lotWidth.max}
          step={0.5}
          onChange={(v) => update({ lotWidth: { ...gen.lotWidth, min: v } })}
        />
        <SliderRow
          label="Lot width max"
          value={gen.lotWidth.max}
          display={`${gen.lotWidth.max.toFixed(1)}m`}
          min={gen.lotWidth.min}
          max={14}
          step={0.5}
          onChange={(v) => update({ lotWidth: { ...gen.lotWidth, max: v } })}
        />
        <SliderRow
          label="Storeys min"
          value={gen.storeys.min}
          display={`${gen.storeys.min}`}
          min={1}
          max={gen.storeys.max}
          step={1}
          onChange={(v) => update({ storeys: { ...gen.storeys, min: v } })}
        />
        <SliderRow
          label="Storeys max"
          value={gen.storeys.max}
          display={`${gen.storeys.max}`}
          min={gen.storeys.min}
          max={6}
          step={1}
          onChange={(v) => update({ storeys: { ...gen.storeys, max: v } })}
        />
        <SliderRow
          label="Shopfront share"
          value={gen.shopfrontShare}
          display={`${Math.round(gen.shopfrontShare * 100)}%`}
          min={0}
          max={1}
          step={0.05}
          onChange={(shopfrontShare) => update({ shopfrontShare })}
        />
        <SliderRow
          label="Variation"
          value={gen.variation}
          display={`${Math.round(gen.variation * 100)}%`}
          min={0}
          max={1}
          step={0.05}
          onChange={(variation) => update({ variation })}
        />
        <div>
          <span className="text-[10px] text-[var(--muted)] block mb-1">
            Preset pool
          </span>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(FACADE_PRESETS) as PresetId[]).map((id) => {
              const on = gen.presets.includes(id);
              return (
                <Toggle
                  key={id}
                  label={FACADE_PRESETS[id].label}
                  on={on}
                  onClick={() =>
                    update({
                      presets: on
                        ? gen.presets.filter((p) => p !== id)
                        : [...gen.presets, id],
                    })
                  }
                />
              );
            })}
          </div>
        </div>
        <div className="text-[9px] text-[var(--muted)]">
          Settings apply on the next reroll. Seed {block.seed} ·{" "}
          {block.lots.length} lots.
        </div>
      </Section>

      <Section title="Actions">
        <div className="grid grid-cols-2 gap-1">
          <Toggle label="Reroll" on={false} onClick={onReroll} />
          <Toggle label="Flip side" on={block.flipped} onClick={onFlip} />
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirmDelete) {
              onDeleteBlock();
              setConfirmDelete(false);
            } else {
              setConfirmDelete(true);
              window.setTimeout(() => setConfirmDelete(false), 3000);
            }
          }}
          className={`w-full px-2 py-1.5 rounded text-[11px] transition-colors ${
            confirmDelete
              ? "bg-red-600 text-white"
              : "bg-[var(--border)] text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {confirmDelete ? "Confirm delete?" : "Delete block"}
        </button>
      </Section>
    </div>
  );
}
```

(`FACADE_PRESETS` and `PresetId` are already imported in this file for the
preset chips.)

- [ ] **Step 3: Gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 65 tests, clean.

- [ ] **Step 4: VISUAL CHECKPOINT** (controller)

1. Click the facade → blue outline + "Lot 1/1" breadcrumb active.
2. Click it again (or the Block chip) → block inspector: gen sliders,
   preset pool, Reroll/Flip/Delete.
3. Reroll on the single starting block regenerates it (unpinned).
4. Edit a slider in lot mode, reroll again → the edited lot is PINNED.
5. Flip: facade + stoop + sidewalk jump to the other side of the line.
6. Delete: two-step confirm → world resets to the starting facade.

- [ ] **Step 5: Commit**

```bash
git add src/components/facade/FacadeControls.tsx src/app/facade/page.tsx
git commit -m "feat(facade): block inspector — gen settings, reroll, flip, delete"
```

---

### Task 5: Plan-pane drawing

**Files:**
- Modify: `src/components/facade/FacadeViewer.tsx` (draw mode state + toggle button + DrawSurface in PlanPane)
- Modify: `src/app/facade/page.tsx` (onCommitLine handler)

**Interfaces:**
- Consumes: `snapPoint`, `nextBlockId`, `DEFAULT_GEN`, `type FacadeBlock` (Task 1); `generateBlock` (Task 2); drei `Line`.
- Produces: `FacadeViewerProps` gains `onCommitLine: (a: [number, number], b: [number, number]) => void`. Page creates + selects the new block.

- [ ] **Step 1: Page handler** in `src/app/facade/page.tsx`:

```tsx
  const handleCommitLine = useCallback(
    (a: [number, number], b: [number, number]) => {
      const seed = Math.floor(Math.random() * 1e9);
      const line = { a, b };
      const newBlock: FacadeBlock = {
        id: nextBlockId(),
        line,
        flipped: false,
        gen: DEFAULT_GEN,
        seed,
        lots: generateBlock(line, false, DEFAULT_GEN, seed),
      };
      setBlocks((bs) => [...bs, newBlock]);
      setSelected({ blockId: newBlock.id, lot: 0, level: "block" });
    },
    [],
  );
```

Pass `onCommitLine={handleCommitLine}` to `<FacadeViewer …/>`. Extend the
blocks imports with `nextBlockId, DEFAULT_GEN` and add
`generateBlock` from `@/lib/facade/generate`.

- [ ] **Step 2: Draw mode + surface** in `src/components/facade/FacadeViewer.tsx`:

2a. Workspace state (next to `maximized`):

```tsx
  const [drawMode, setDrawMode] = useState(false);
```

2b. New component (above the pane components; import `Line` from drei and
`snapPoint` from `@/lib/facade/blocks`):

```tsx
const MIN_BLOCK_LENGTH = 3;

/** Invisible ground-plane pick surface + rubber-band line. Lives ONLY in
 * the plan pane, so drawing gestures can't fire from other panes. */
function DrawSurface({
  blocks,
  onCommitLine,
}: {
  blocks: FacadeBlock[];
  onCommitLine: (a: [number, number], b: [number, number]) => void;
}) {
  const [draft, setDraft] = useState<null | {
    a: [number, number];
    b: [number, number];
  }>(null);
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          const p = snapPoint([e.point.x, e.point.z], blocks);
          setDraft({ a: p, b: p });
        }}
        onPointerMove={(e) => {
          if (!draft) return;
          setDraft({ a: draft.a, b: [e.point.x, e.point.z] });
        }}
        onPointerUp={(e) => {
          if (!draft) return;
          const b = snapPoint([e.point.x, e.point.z], blocks);
          const len = Math.hypot(b[0] - draft.a[0], b[1] - draft.a[1]);
          if (len >= MIN_BLOCK_LENGTH) onCommitLine(draft.a, b);
          setDraft(null);
        }}
      >
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {draft && (
        <Line
          points={[
            [draft.a[0], 0.08, draft.a[1]],
            [draft.b[0], 0.08, draft.b[1]],
          ]}
          color="#3b82f6"
          lineWidth={3}
          dashed
          dashSize={0.5}
          gapSize={0.3}
        />
      )}
    </>
  );
}
```

2c. In `PlanPane`, add props `drawMode: boolean` and `onCommitLine`, and:
- render `{drawMode && <DrawSurface blocks={blocks} onCommitLine={onCommitLine} />}` next to `<SceneContents …/>`;
- disable panning while drawing: `<MapControls … enabled={!drawMode} />`.

2d. Draw-mode toggle button — HTML overlay on the PLAN CELL only (in the
workspace shell where cells render, next to the pane label, plan pane only):

```tsx
            {p.id === "plan" && (
              <button
                type="button"
                onClick={() => setDrawMode((d) => !d)}
                aria-label={drawMode ? "Exit draw mode" : "Draw a block"}
                className={`absolute top-1 left-16 grid h-6 px-2 place-items-center rounded text-[10px] transition-colors ${
                  drawMode
                    ? "bg-[var(--accent)] text-white"
                    : "bg-black/40 text-white/70 hover:bg-black/60"
                }`}
              >
                {drawMode ? "drawing…" : "✏ draw"}
              </button>
            )}
```

- [ ] **Step 3: Gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 65 tests, clean.

- [ ] **Step 4: VISUAL CHECKPOINT** (controller)

1. Plan pane shows a "✏ draw" chip; clicking it arms draw mode (accent) and
   freezes plan panning.
2. Drag a line in plan → dashed rubber band → on release a block of
   generated facades appears in ALL panes, selected, block inspector open.
3. Endpoints snap when starting/ending within 1 m of existing endpoints.
4. Tiny drags (< 3 m) create nothing.
5. Draw a second line parallel to the first, facades facing each other →
   street reads correctly in perspective.
6. Neighbor masses disappeared once the second block existed.

- [ ] **Step 5: Commit**

```bash
git add src/components/facade/FacadeViewer.tsx src/app/facade/page.tsx
git commit -m "feat(facade): plan-pane drawing — rubber band, snapping, block creation"
```

---

### Task 6: Elevation tracking + world fitting + B follow-ups

**Files:**
- Modify: `src/components/facade/FacadeViewer.tsx` (ElevationPane tracks the selected block; PlanPane fits the world)
- Modify: `src/lib/facade/camera.ts` + `src/lib/facade/camera.test.ts` (finite-guard follow-up)
- Modify: `src/components/facade/SceneContents.tsx` + `src/lib/facade/blocks.ts` (shared NEIGHBOR_WIDTH constant)

**Interfaces:**
- Consumes: `blockFrame`, `totalLotsWidth` (Task 1); `computeLayout`; `elevationCameraPosition`, `fitOrthoZoom` (existing).
- Produces: `NEIGHBOR_WIDTH = 8` exported from `src/lib/facade/blocks.ts`.

- [ ] **Step 1: Elevation panes track the selected block** in `FacadeViewer.tsx`:

Replace `ElevationPane`'s selected-lot fitting (from Task 3) with
block-frame-derived cameras. The pane receives `block: FacadeBlock` and
`selected: Selection` (plus blocks/onSelectLot for SceneContents):

```tsx
function ElevationPane({
  blocks,
  selected,
  onSelectLot,
  context,
  view,
  size,
  mode,
}: {
  blocks: FacadeBlock[];
  selected: Selection;
  onSelectLot: (blockId: string, lot: number) => void;
  context: LotContext;
  view: ViewSettings;
  size: { w: number; h: number };
  mode: "overview" | "detail";
}) {
  const block = blocks.find((b) => b.id === selected.blockId) ?? blocks[0];
  const frame = useMemo(() => blockFrame(block), [block]);
  const lots = block.lots;
  const maxH = useMemo(
    () => Math.max(...lots.map((l) => computeLayout(l.params).totalHeight)),
    [lots],
  );
  const length = totalLotsWidth(block);
  // Overview frames the whole block strip; detail frames the SELECTED
  // lot's ground storey.
  const lotIndex = Math.min(selected.lot, lots.length - 1);
  const lotParams = lots[lotIndex].params;
  const lotLayout = useMemo(() => computeLayout(lotParams), [lotParams]);
  const placements = useMemo(() => lotPlacements(block), [block]);
  const lotPos = placements[lotIndex].position;

  const worldW = mode === "overview" ? length : lotParams.width;
  const worldH =
    mode === "overview"
      ? maxH
      : Math.min(lotLayout.storeyLevels[1] + 0.8, lotLayout.totalHeight);
  const targetY = worldH / 2;
  const mid: [number, number, number] =
    mode === "overview"
      ? [
          frame.origin[0] + (frame.dir[0] * length) / 2,
          targetY,
          frame.origin[1] + (frame.dir[1] * length) / 2,
        ]
      : [lotPos[0], targetY, lotPos[2]];
  const normal3: [number, number, number] = [frame.normal[0], 0, frame.normal[1]];
  const zoom = fitOrthoZoom(size.w, size.h, worldW, worldH);
  const position = elevationCameraPosition(mid, normal3, ELEVATION_DISTANCE);
  const camRef = useRef<THREE.OrthographicCamera>(null);
  useEffect(() => {
    const cam = camRef.current;
    if (!cam) return;
    cam.position.set(position[0], position[1], position[2]);
    cam.lookAt(mid[0], mid[1], mid[2]);
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, position[0], position[1], position[2], mid[0], mid[1], mid[2]]);
  return (
    <>
      <SceneContents
        blocks={blocks}
        selected={selected}
        onSelectLot={onSelectLot}
        context={context}
        view={view}
      />
      <OrthographicCamera
        ref={camRef}
        makeDefault
        position={position}
        zoom={zoom}
        near={0.1}
        far={400}
      />
      <MapControls
        makeDefault
        enableRotate={false}
        target={mid}
        screenSpacePanning
        zoomSpeed={1}
      />
    </>
  );
}
```

(Also extend the imports: `lotPlacements, totalLotsWidth` from
`@/lib/facade/blocks`.) MapControls `target` prop updates re-aim panning
when the selection moves between blocks.

- [ ] **Step 2: Plan pane fits the whole world** in `PlanPane`:

```tsx
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const b of blocks) {
      for (const e of [b.line.a, b.line.b]) {
        minX = Math.min(minX, e[0]); maxX = Math.max(maxX, e[0]);
        minZ = Math.min(minZ, e[1]); maxZ = Math.max(maxZ, e[1]);
      }
    }
    const pad = 2 * NEIGHBOR_WIDTH + 4;
    return {
      w: Math.max(maxX - minX + pad, 30),
      d: Math.max(maxZ - minZ + pad, 30),
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
    };
  }, [blocks]);
  const zoom = fitOrthoZoom(size.w, size.h, bounds.w, bounds.d);
```

Camera position `[bounds.cx, 60, bounds.cz - 2]`, MapControls target
`[bounds.cx, 0, bounds.cz - 2]` (import `NEIGHBOR_WIDTH` from
`@/lib/facade/blocks`).

- [ ] **Step 3: B follow-ups**

3a. `src/lib/facade/blocks.ts` — add:

```ts
/** Grey party-wall neighbor mass width (shared by the scene and plan fit). */
export const NEIGHBOR_WIDTH = 8;
```

In `SceneContents.tsx`'s `NeighborMasses`, replace the local `const W = 8;`
with the imported `NEIGHBOR_WIDTH`.

3b. `src/lib/facade/camera.ts` — harden `fitOrthoZoom`; replace its guard
line and doc comment:

```ts
/** Orthographic zoom (pixels per world unit) that fits a worldW×worldH
 * rectangle into a viewW×viewH viewport. margin > 1 leaves breathing room
 * (1.15 = 15%). Non-finite or non-positive inputs (including margin)
 * return 1 — visible, never NaN/Infinity. */
export function fitOrthoZoom(
  viewW: number,
  viewH: number,
  worldW: number,
  worldH: number,
  margin = 1.15,
): number {
  const args = [viewW, viewH, worldW, worldH, margin];
  if (args.some((v) => !Number.isFinite(v) || v <= 0)) return 1;
  return Math.min(viewW / (worldW * margin), viewH / (worldH * margin));
}
```

Append to `camera.test.ts`'s `fitOrthoZoom` describe block:

```ts
  it("non-finite and non-positive margins return 1", () => {
    expect(fitOrthoZoom(NaN, 600, 10, 20)).toBe(1);
    expect(fitOrthoZoom(800, 600, Infinity, 20)).toBe(1);
    expect(fitOrthoZoom(800, 600, 10, 20, 0)).toBe(1);
  });
```

- [ ] **Step 4: Gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 66 tests, clean.

- [ ] **Step 5: VISUAL CHECKPOINT** (controller)

1. Draw an angled line → select a facade on it → BOTH elevation panes
   re-aim head-on to that block (perpendicular rule live on an angle).
2. Overview frames the whole block strip; detail frames the selected lot's
   ground floor; selecting a different lot re-aims the detail pane.
3. Plan pane auto-fits as blocks are added.
4. All 65+ tests green.

- [ ] **Step 6: Commit**

```bash
git add src/components/facade/FacadeViewer.tsx src/components/facade/SceneContents.tsx src/lib/facade/camera.ts src/lib/facade/camera.test.ts src/lib/facade/blocks.ts
git commit -m "feat(facade): elevations track the selected block; plan fits the world"
```

---

### Task 7: Finish

**Files:**
- Modify: `AGENTS.md` (facade section: blocks, drawing, new modules, test count)

- [ ] **Step 1: Full gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 66 tests pass, tsc clean, lint 0 errors.

- [ ] **Step 2: Update AGENTS.md**

In the "Facade designer (`/facade`)" section, update the bullet list to
document the workspace + blocks (replace the existing three bullets):

```markdown
- **Layout engine**: `src/lib/facade/layout.ts` is a pure function
  (FacadeParams → rectangles) holding ALL validity clamps; the mesh renders
  whatever it returns.
- **Grid model**: (storeys × bays) cells, treatment-derived defaults + sparse
  `cellOverrides` patches.
- **Quad workspace**: plan / perspective / elevation overview / detail as
  drei `<View>` viewports over one Canvas (`FacadeViewer.tsx`); elevation
  cameras always aim along the facade normal (`src/lib/facade/camera.ts`).
- **Blocks & streets**: draw lines in the plan pane; `src/lib/facade/blocks.ts`
  (frames/placement) + `generate.ts` (seeded subdivision + lot params) turn
  them into editable streets. Every lot is a full `FacadeParams`; hand edits
  pin lots against reroll.
- **AI prompt**: `/api/facade-prompt` (flat fully-required zod spec — OpenAI
  structured output rejects optionals) targets the selected lot, plus an
  instant local keyword parser.
```

Also update the Tests line under Commands if the count is stated anywhere
(the current AGENTS.md text doesn't pin a number — verify and leave if so).

In the Key file layout block, add under `lib/facade/`:

```
      camera.ts        — ortho fit + normal-derived elevation cameras
      blocks.ts        — street blocks: frames, lot placement, selection types
      generate.ts      — seeded generator: subdivision, lot params, reroll
```

and under `components/facade/`:

```
      SceneContents.tsx  — shared world scene (blocks, ground, lights)
```

- [ ] **Step 3: Commit docs**

```bash
git add AGENTS.md
git commit -m "docs: facade blocks + quad workspace in AGENTS.md"
```

- [ ] **Step 4: Hand off**

Full-branch final review, then superpowers:finishing-a-development-branch.

## Self-Review Notes

- Spec coverage: data model (FacadeBlock/LotState/BlockGenSettings/Selection) → T1+T3; generator determinism/subdivision/pinning → T2; one-world model with selected-lot editing bridge → T3; selection promotion + block inspector (ranges, pool, share, variation, seed+reroll, flip, two-step delete) → T4; drawing (segment, one-side+flip, snapping 1 m, min length, rubber band, controls freeze) → T5; elevations track selected block via normals + plan world-fit + per-block sidewalk + neighbor-mass gating → T3/T6; AI targets selected lot → T3 (setParams bridge); B follow-ups (finite guard, NEIGHBOR_WIDTH) → T6; docs → T7.
- Deliberately deferred per spec: corner junctions, curved lines, persistence, street-elevation exports.
- Type consistency: `Selection` defined T3 in blocks.ts, consumed T3-T6; `FacadeControlsProps` extension in T4 matches the page's handler names; `onCommitLine` signature matches page↔viewer; `NEIGHBOR_WIDTH` produced T6 step 3a before its consumer in step 2 of the same task (single-task ordering note: implementer should apply 3a before 2 if tsc complains — both are in T6).
- Known risk (not a placeholder): R3F pointer events inside drei Views for the DrawSurface and lot onClick — browser checkpoints in T3/T5 gate them; drei View event routing was already proven for controls in B.
