# Corner Buildings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two street segments welded at a node merge into ONE corner building: shared shell (storeys/colors/ornament, cornice & parapet continuous around the corner), unified or two-facades frontage modes, mitered wall geometry, corner-node selection with an inspector.

**Architecture:** Corners are DERIVED from welded nodes (like nodes themselves) by pure `detectCorners`; only user decisions live in a sparse `Map<pairKey, CornerChoice>`. One pure choke point `syncCorners` runs after every block mutation so stored params are always truthful. Wall miters are computed per corner (`miterFor`) and consumed by `FacadeMesh` via an optional prop.

**Tech Stack:** Next.js 16 App Router, React 19 Strict Mode, three + @react-three/fiber 9 + drei 10, vitest.

**Spec:** `docs/superpowers/specs/2026-07-13-corner-buildings-design.md`

## Global Constraints

- **Corner rule (spec verbatim):** every welded node joining exactly TWO blocks whose turn ≤ the global max merges. "Turn = 180° − interior angle: 0° is straight-through, 90° a right angle." `DEFAULT_MAX_CORNER_ANGLE = 150`.
- **Shell (spec verbatim, single source of truth `SHELL_FIELDS`):** storeys, storeyHeight, storeyHeights, wallColor, trimColor, ornament, windowStyle. Always shared in both modes. Unified additionally mirrors windowWidthRatio, windowHeightRatio, groundFloor (doorBay clamped), and bay rhythm `partner.bays = clamp(round(partnerWidth / (sourceWidth / sourceBays)), 1, 9)`. `cellOverrides` are NEVER mirrored.
- **Sync semantics:** shell flows FROM the edited block when given, else FROM the primary. Sync never sets `customized` on the partner and never clears it on either side. Both corner lots' `depthOffset` forced to 0. Idempotent; returns the INPUT ARRAY IDENTITY when nothing changed.
- **Miter (spec verbatim):** `extend = clamp(tan(turnRad / 2) * WALL_THICKNESS, 0, 3 * WALL_THICKNESS)`; convex extends outward, concave trims (negative). Openings never enter the mitered sliver (layout engine untouched).
- Default choice: `{ mode: "two-facades", primary: wider frontage }`.
- Weld invariant unchanged: exact float equality on endpoints, never epsilon; corners must not mutate `line` coordinates.
- No `Math.random` in `src/lib/facade/`; React Strict Mode purity (syncCorners/detectCorners are pure and MAY run inside setState updaters; `Map` state is replaced, never mutated in place).
- Gates: `npx tsc --noEmit` clean; `npm run lint` = exactly 3 pre-existing warnings (src/lib/building/prompt-parser.ts ×2, src/lib/python-server.ts ×1); `npm test` green (103 baseline + this plan's additions). Local `npm run build` fails for a pre-existing unrelated reason — do not chase it.
- Never touch `public/default.glb` or `python/vendor/homemaker-addon`.

## File map

| File | Change |
|---|---|
| `src/lib/facade/corners.ts` | **New** — types, `detectCorners`, `cornerChoice`, `syncCorners`, `miterFor`, `SHELL_FIELDS` (T1–T3) |
| `src/lib/facade/corners.test.ts` | **New** (T1–T3) |
| `src/lib/facade/blocks.ts` | `Selection` gains `level: "corner"` + `cornerKey?` (T4) |
| `src/components/facade/FacadeMesh.tsx` | optional `miter` prop → wall/cornice/parapet extension (T3) |
| `src/components/facade/SceneContents.tsx` | corners prop → per-lot miter map → FacadeMesh (T3) |
| `src/app/facade/page.tsx` | cornerChoices + maxCornerAngle state, sync choke points, corner selection (T4) |
| `src/components/facade/FacadeViewer.tsx` | corner-tinted handles, stationary-click corner select (T4) |
| `src/components/facade/FacadeControls.tsx` | CornerInspector (T5) |
| `AGENTS.md` | file layout + facade section (T5) |

---

### Task 1: `detectCorners` — derived corners

**Files:**
- Create: `src/lib/facade/corners.ts`
- Test: `src/lib/facade/corners.test.ts`

**Interfaces:**
- Consumes: `deriveNodes` from `./nodes`; `blockFrame`, `FacadeBlock` from `./blocks`.
- Produces (T2–T5 rely on these exact names):

```ts
export interface CornerSide {
  blockId: string;
  end: "a" | "b";
  lotIndex: number;
  /** Which side of that LOT touches the node (frame origin = "left"). */
  lotSide: "left" | "right";
}
export interface Corner {
  key: string;
  node: [number, number];
  a: CornerSide;
  b: CornerSide;
  turn: number;      // degrees, 0 = straight through
  convex: boolean;
}
export const DEFAULT_MAX_CORNER_ANGLE = 150;
export function detectCorners(blocks: FacadeBlock[], maxTurnDeg: number): Corner[];
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/facade/corners.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectCorners } from "./corners";
import { DEFAULT_GEN, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE } from "./types";

const mkBlock = (
  id: string,
  a: [number, number],
  b: [number, number],
  widths: number[],
  flipped = false,
): FacadeBlock => ({
  id,
  line: { a, b },
  flipped,
  gen: structuredClone(DEFAULT_GEN),
  seed: 7,
  lots: widths.map((w) => ({
    params: { ...DEFAULT_FACADE, width: w },
    customized: false,
  })),
});

describe("detectCorners", () => {
  it("right-angle weld of two blocks is one corner with turn 90", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
    const B = mkBlock("B", [10, 0], [10, 10], [5, 5]);
    const corners = detectCorners([A, B], 150);
    expect(corners).toHaveLength(1);
    const c = corners[0];
    expect(c.turn).toBeCloseTo(90, 6);
    expect(c.node).toEqual([10, 0]);
    // sides sorted by blockId:end — A:b before B:a
    expect(c.a).toEqual({ blockId: "A", end: "b", lotIndex: 1, lotSide: "right" });
    expect(c.b).toEqual({ blockId: "B", end: "a", lotIndex: 0, lotSide: "left" });
    expect(c.key).toBe("A:b|B:a");
  });

  it("respects the max turn threshold (boundary inclusive)", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [10, 10], [10]);
    expect(detectCorners([A, B], 90)).toHaveLength(1);
    expect(detectCorners([A, B], 89.99)).toHaveLength(0);
  });

  it("straight-through weld has turn 0", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [20, 0], [10]);
    const [c] = detectCorners([A, B], 150);
    expect(c.turn).toBeCloseTo(0, 6);
  });

  it("flipped blocks resolve lotIndex/lotSide via the frame, not raw ends", () => {
    // B flipped: frame origin = line.b = (10,10); node (10,0) = line.a = frame END.
    const A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
    const B = mkBlock("B", [10, 0], [10, 10], [5, 5], true);
    const [c] = detectCorners([A, B], 150);
    expect(c.b).toEqual({ blockId: "B", end: "a", lotIndex: 1, lotSide: "right" });
  });

  it("convexity: facades wrapping the outer corner are convex; back-to-back are not", () => {
    // A faces +z (normal [0,1]); B along +z from the node faces -x.
    // Streets share the x<10, z>0 quadrant -> convex (outer corner).
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [10, 10], [10]);
    expect(detectCorners([A, B], 150)[0].convex).toBe(true);
    // B2 runs the other way (toward -z): its facade faces +x, away from
    // A's street -> building interiors interpenetrate -> concave.
    const B2 = mkBlock("B2", [10, 0], [10, -10], [10]);
    expect(detectCorners([A, B2], 150)[0].convex).toBe(false);
  });

  it("3-way junctions and free endpoints never merge", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [10, 10], [10]);
    const C = mkBlock("C", [10, 0], [20, 0], [10]);
    expect(detectCorners([A, B, C], 180)).toHaveLength(0);
    expect(detectCorners([A], 180)).toHaveLength(0);
  });

  it("a two-block closed loop yields two corners with distinct keys", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [0, 0], [10]);
    const corners = detectCorners([A, B], 180);
    expect(corners).toHaveLength(2);
    expect(new Set(corners.map((c) => c.key)).size).toBe(2);
  });

  it("key is stable under node drag (same blocks/ends, moved coordinates)", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [10, 10], [10]);
    const k1 = detectCorners([A, B], 150)[0].key;
    const A2 = { ...A, line: { a: [0, 0] as [number, number], b: [11, 2] as [number, number] } };
    const B2 = { ...B, line: { a: [11, 2] as [number, number], b: [10, 10] as [number, number] } };
    const k2 = detectCorners([A2, B2], 150)[0].key;
    expect(k2).toBe(k1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/facade/corners.test.ts`
Expected: FAIL — cannot resolve `./corners`.

- [ ] **Step 3: Implement**

Create `src/lib/facade/corners.ts`:

```ts
import type { FacadeBlock } from "./blocks";
import { blockFrame } from "./blocks";
import { deriveNodes } from "./nodes";

/** One block's side of a corner. lotSide names which end of that LOT's
 * local x-axis touches the node (frame origin = "left"). */
export interface CornerSide {
  blockId: string;
  end: "a" | "b";
  lotIndex: number;
  lotSide: "left" | "right";
}

export interface Corner {
  /** Sorted pair key — stable across drags, dies with block deletion. */
  key: string;
  node: [number, number];
  a: CornerSide;
  b: CornerSide;
  /** Turn at the node in degrees: 0 = straight through, 90 = right angle. */
  turn: number;
  /** Facades wrap the outer corner (wedge gap) vs interpenetrate (concave). */
  convex: boolean;
}

export const DEFAULT_MAX_CORNER_ANGLE = 150;

/** Unit vector pointing from the node INTO the block along its line. */
function awayDir(block: FacadeBlock, end: "a" | "b"): [number, number] {
  const from = block.line[end];
  const to = block.line[end === "a" ? "b" : "a"];
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
}

function sideFor(block: FacadeBlock, end: "a" | "b"): CornerSide {
  // Frame origin sits at line.a unless flipped (see blockFrame).
  const atOrigin = (end === "a") !== block.flipped;
  return {
    blockId: block.id,
    end,
    lotIndex: atOrigin ? 0 : block.lots.length - 1,
    lotSide: atOrigin ? "left" : "right",
  };
}

export function detectCorners(
  blocks: FacadeBlock[],
  maxTurnDeg: number,
): Corner[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const corners: Corner[] = [];
  for (const node of deriveNodes(blocks)) {
    if (node.refs.length !== 2) continue;
    const [r1, r2] = node.refs;
    if (r1.blockId === r2.blockId) continue; // zero-length self-weld
    const [ra, rb] =
      `${r1.blockId}:${r1.end}` < `${r2.blockId}:${r2.end}` ? [r1, r2] : [r2, r1];
    const A = byId.get(ra.blockId)!;
    const B = byId.get(rb.blockId)!;
    const uA = awayDir(A, ra.end);
    const uB = awayDir(B, rb.end);
    const dot = Math.max(-1, Math.min(1, uA[0] * uB[0] + uA[1] * uB[1]));
    const turn = 180 - (Math.acos(dot) * 180) / Math.PI;
    if (turn > maxTurnDeg) continue;
    const nA = blockFrame(A).normal;
    const convex = uB[0] * nA[0] + uB[1] * nA[1] > 1e-9;
    corners.push({
      key: `${ra.blockId}:${ra.end}|${rb.blockId}:${rb.end}`,
      node: node.pos,
      a: sideFor(A, ra.end),
      b: sideFor(B, rb.end),
      turn,
      convex,
    });
  }
  return corners;
}
```

- [ ] **Step 4: Run to verify pass**

`npx vitest run src/lib/facade/corners.test.ts` — 8 pass. Then `npm test` — 111 total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/facade/corners.ts src/lib/facade/corners.test.ts
git commit -m "feat(facade): detect corner buildings at two-block welds (turn + convexity)"
```

---

### Task 2: `cornerChoice` + `syncCorners` — the shell choke point

**Files:**
- Modify: `src/lib/facade/corners.ts` (append)
- Test: `src/lib/facade/corners.test.ts` (append)

**Interfaces:**
- Consumes: T1's `Corner`, `detectCorners`; `FacadeParams` from `./types`; `LotState` from `./blocks`.
- Produces:

```ts
export interface CornerChoice { mode: "unified" | "two-facades"; primary: "a" | "b"; }
export const SHELL_FIELDS: readonly ["storeys","storeyHeight","storeyHeights","wallColor","trimColor","ornament","windowStyle"];
export function cornerChoice(choices: ReadonlyMap<string, CornerChoice>, corner: Corner, blocks: FacadeBlock[]): CornerChoice;
export function syncCorners(blocks: FacadeBlock[], choices: ReadonlyMap<string, CornerChoice>, maxTurnDeg: number, editedBlockId?: string): FacadeBlock[];
```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/facade/corners.test.ts` (extend the import from `./corners` with `syncCorners, cornerChoice, type CornerChoice`):

```ts
const rightAngle = () => {
  const A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
  const B = mkBlock("B", [10, 0], [10, 10], [4, 6]);
  A.lots[1].params = {
    ...A.lots[1].params,
    storeys: 4,
    wallColor: "#111111",
    ornament: { cornice: true, parapet: true, sills: false, surrounds: true },
  };
  return { A, B };
};

describe("cornerChoice", () => {
  it("defaults to two-facades with the wider frontage as primary", () => {
    const { A, B } = rightAngle(); // A end lot 5m, B end lot 4m
    const [c] = detectCorners([A, B], 150);
    expect(cornerChoice(new Map(), c, [A, B])).toEqual({
      mode: "two-facades",
      primary: "a",
    });
  });
});

describe("syncCorners", () => {
  it("copies the shell from the edited side; face fields stay per-side", () => {
    const { A, B } = rightAngle();
    const out = syncCorners([A, B], new Map(), 150, "A");
    const bLot = out[1].lots[0].params;
    expect(bLot.storeys).toBe(4);
    expect(bLot.wallColor).toBe("#111111");
    expect(bLot.ornament).toEqual(A.lots[1].params.ornament);
    // face untouched (two-facades default)
    expect(bLot.bays).toBe(B.lots[0].params.bays);
    expect(bLot.groundFloor).toEqual(B.lots[0].params.groundFloor);
    expect(bLot.width).toBe(4); // width never copied
    // non-corner lots byte-identical
    expect(out[0].lots[0]).toBe(A.lots[0]);
    expect(out[1].lots[1]).toBe(B.lots[1]);
  });

  it("flows from the primary when no edited side is given", () => {
    const { A, B } = rightAngle();
    const out = syncCorners([A, B], new Map(), 150);
    expect(out[1].lots[0].params.storeys).toBe(4); // primary = a (wider)
  });

  it("unified mode mirrors ratios, groundFloor, and bay rhythm (never cellOverrides)", () => {
    const { A, B } = rightAngle();
    const src = A.lots[1].params;
    A.lots[1].params = {
      ...src,
      bays: 2, // 5m / 2 bays = 2.5m rhythm
      windowWidthRatio: 0.61,
      windowHeightRatio: 0.44,
      groundFloor: { treatment: "shopfront", doorBay: 1, stoop: false },
      cellOverrides: [{ storey: 1, bay: 0, kind: "blank" }],
    };
    const [c] = detectCorners([A, B], 150);
    const choices = new Map<string, CornerChoice>([
      [c.key, { mode: "unified", primary: "a" }],
    ]);
    const out = syncCorners([A, B], choices, 150, "A");
    const bLot = out[1].lots[0].params;
    expect(bLot.bays).toBe(2); // round(4 / 2.5) = 2
    expect(bLot.windowWidthRatio).toBe(0.61);
    expect(bLot.groundFloor.treatment).toBe("shopfront");
    expect(bLot.groundFloor.doorBay).toBe(1); // clamped to bays-1 = 1
    expect(bLot.cellOverrides).toEqual(B.lots[0].params.cellOverrides);
  });

  it("zeroes depthOffset on corner lots only; preserves customized flags", () => {
    const { A, B } = rightAngle();
    A.lots[0].depthOffset = 0.05;
    A.lots[1].depthOffset = 0.08;
    B.lots[0].depthOffset = -0.06;
    B.lots[0].customized = true;
    const out = syncCorners([A, B], new Map(), 150, "A");
    expect(out[0].lots[0].depthOffset).toBe(0.05); // non-corner untouched
    expect(out[0].lots[1].depthOffset).toBe(0);
    expect(out[1].lots[0].depthOffset).toBe(0);
    expect(out[1].lots[0].customized).toBe(true); // sync never flips pins
  });

  it("is idempotent and returns the input array identity when nothing changes", () => {
    const { A, B } = rightAngle();
    const once = syncCorners([A, B], new Map(), 150, "A");
    const twice = syncCorners(once, new Map(), 150, "A");
    expect(twice).toBe(once);
  });

  it("no corners -> input identity", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const blocks = [A];
    expect(syncCorners(blocks, new Map(), 150)).toBe(blocks);
  });
});
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run src/lib/facade/corners.test.ts` — new tests FAIL (`syncCorners` not exported).

- [ ] **Step 3: Implement**

Append to `src/lib/facade/corners.ts`:

```ts
import type { FacadeParams } from "./types";

export interface CornerChoice {
  mode: "unified" | "two-facades";
  /** Which side is the design source in unified mode (and the default
   * shell source when no edited side is known). */
  primary: "a" | "b";
}

/** The shared shell — the single source of truth for what "one building"
 * means across a corner. Width, bays, openings, colors of doors etc. stay
 * per-frontage (unless unified mirrors some of them). */
export const SHELL_FIELDS = [
  "storeys",
  "storeyHeight",
  "storeyHeights",
  "wallColor",
  "trimColor",
  "ornament",
  "windowStyle",
] as const;

const lotOf = (blocks: FacadeBlock[], side: CornerSide) =>
  blocks.find((b) => b.id === side.blockId)!.lots[side.lotIndex];

export function cornerChoice(
  choices: ReadonlyMap<string, CornerChoice>,
  corner: Corner,
  blocks: FacadeBlock[],
): CornerChoice {
  const existing = choices.get(corner.key);
  if (existing) return existing;
  const wa = lotOf(blocks, corner.a).params.width;
  const wb = lotOf(blocks, corner.b).params.width;
  return { mode: "two-facades", primary: wa >= wb ? "a" : "b" };
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** Copy the shell (and, when unified, the face) from source to target.
 * Returns null when the target already matches (idempotence). */
function syncedParams(
  source: FacadeParams,
  target: FacadeParams,
  unified: boolean,
): FacadeParams | null {
  const next: FacadeParams = {
    ...target,
    storeys: source.storeys,
    storeyHeight: source.storeyHeight,
    storeyHeights: [...source.storeyHeights],
    wallColor: source.wallColor,
    trimColor: source.trimColor,
    ornament: { ...source.ornament },
    windowStyle: source.windowStyle,
  };
  if (unified) {
    const rhythm = source.width / source.bays;
    next.bays = clamp(Math.round(target.width / rhythm), 1, 9);
    next.windowWidthRatio = source.windowWidthRatio;
    next.windowHeightRatio = source.windowHeightRatio;
    next.groundFloor = {
      treatment: source.groundFloor.treatment,
      doorBay: clamp(source.groundFloor.doorBay, 0, next.bays - 1),
      stoop: source.groundFloor.stoop,
    };
  }
  const same =
    next.storeys === target.storeys &&
    next.storeyHeight === target.storeyHeight &&
    next.storeyHeights.length === target.storeyHeights.length &&
    next.storeyHeights.every((h, i) => h === target.storeyHeights[i]) &&
    next.wallColor === target.wallColor &&
    next.trimColor === target.trimColor &&
    next.windowStyle === target.windowStyle &&
    next.ornament.cornice === target.ornament.cornice &&
    next.ornament.parapet === target.ornament.parapet &&
    next.ornament.sills === target.ornament.sills &&
    next.ornament.surrounds === target.ornament.surrounds &&
    (!unified ||
      (next.bays === target.bays &&
        next.windowWidthRatio === target.windowWidthRatio &&
        next.windowHeightRatio === target.windowHeightRatio &&
        next.groundFloor.treatment === target.groundFloor.treatment &&
        next.groundFloor.doorBay === target.groundFloor.doorBay &&
        next.groundFloor.stoop === target.groundFloor.stoop));
  return same ? null : next;
}

/** The one choke point: every block mutation funnels its result through
 * here so corner pairs always share a truthful shell. Pure and idempotent —
 * safe inside React setState updaters. */
export function syncCorners(
  blocks: FacadeBlock[],
  choices: ReadonlyMap<string, CornerChoice>,
  maxTurnDeg: number,
  editedBlockId?: string,
): FacadeBlock[] {
  const corners = detectCorners(blocks, maxTurnDeg);
  if (corners.length === 0) return blocks;
  const work = new Map<string, FacadeBlock>();
  const get = (id: string) =>
    work.get(id) ?? blocks.find((b) => b.id === id)!;
  const patchLot = (
    side: CornerSide,
    params: FacadeParams | null,
    zeroDepth: boolean,
  ) => {
    const block = get(side.blockId);
    const lot = block.lots[side.lotIndex];
    const needsDepth = zeroDepth && (lot.depthOffset ?? 0) !== 0;
    if (!params && !needsDepth) return;
    const lots = block.lots.map((l, i) =>
      i === side.lotIndex
        ? { ...l, params: params ?? l.params, ...(needsDepth ? { depthOffset: 0 } : {}) }
        : l,
    );
    work.set(side.blockId, { ...block, lots });
  };
  for (const corner of corners) {
    const choice = cornerChoice(choices, corner, blocks);
    const sourceSide =
      editedBlockId === corner.a.blockId
        ? "a"
        : editedBlockId === corner.b.blockId
          ? "b"
          : choice.primary;
    const src = corner[sourceSide];
    const dst = corner[sourceSide === "a" ? "b" : "a"];
    const srcLot = get(src.blockId).lots[src.lotIndex];
    const dstLot = get(dst.blockId).lots[dst.lotIndex];
    patchLot(
      dst,
      syncedParams(srcLot.params, dstLot.params, choice.mode === "unified"),
      true,
    );
    patchLot(src, null, true); // depthOffset zeroing on the source side too
  }
  if (work.size === 0) return blocks;
  return blocks.map((b) => work.get(b.id) ?? b);
}
```

- [ ] **Step 4: Run to verify pass**

`npx vitest run src/lib/facade/corners.test.ts` — 15 pass. `npm test` — 118.

- [ ] **Step 5: Commit**

```bash
git add src/lib/facade/corners.ts src/lib/facade/corners.test.ts
git commit -m "feat(facade): corner shell sync — one choke point, idempotent, pin-preserving"
```

---

### Task 3: `miterFor` + mitered wall/cornice/parapet geometry

**Files:**
- Modify: `src/lib/facade/corners.ts` (append), `src/components/facade/FacadeMesh.tsx`, `src/components/facade/SceneContents.tsx`
- Test: `src/lib/facade/corners.test.ts` (append)

**Interfaces:**
- Consumes: T1's `Corner`; `WALL_THICKNESS` from `./layout` (0.35).
- Produces: `export interface LotMiter { left: number; right: number }` and
  `export function miterFor(corner: Corner): { a: number; b: number }` — metres of
  wall extension at the corner side of each lot (positive extend, negative trim; side b is
  always 0 — one side fills the corner so coincident faces never z-fight).
  `FacadeMesh` gains `miter?: LotMiter`; `SceneContents` computes a per-lot miter map.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/facade/corners.test.ts` (extend the `./corners` import with `miterFor`; add `import { WALL_THICKNESS } from "./layout";`):

```ts
describe("miterFor", () => {
  it("convex right angle: side a extends by tan(45°)·T = T; side b untouched", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [10, 10], [10]);
    const [c] = detectCorners([A, B], 150);
    const m = miterFor(c);
    expect(m.a).toBeCloseTo(WALL_THICKNESS, 9);
    expect(m.b).toBe(0);
  });

  it("concave right angle: side a trims (negative, half depth)", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B2 = mkBlock("B2", [10, 0], [10, -10], [10]);
    const [c] = detectCorners([A, B2], 150);
    const m = miterFor(c);
    expect(m.a).toBeCloseTo(-WALL_THICKNESS / 2, 9);
    expect(m.b).toBe(0);
  });

  it("straight through: no correction", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [20, 0], [10]);
    const [c] = detectCorners([A, B], 150);
    expect(miterFor(c)).toEqual({ a: 0, b: 0 });
  });

  it("clamps at extreme turns", () => {
    // Near-hairpin: B doubles back toward A's start -> turn ≈ 177°,
    // tan(turn/2)·T ≈ 38·T, clamped to 3·T.
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [0, 0.5], [10]);
    const [c] = detectCorners([A, B], 179);
    expect(c.turn).toBeGreaterThan(170);
    const m = miterFor(c);
    expect(Math.abs(m.a)).toBeCloseTo(3 * WALL_THICKNESS, 9);
  });
});
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run src/lib/facade/corners.test.ts` — FAIL (`miterFor` not exported).

- [ ] **Step 3: Implement `miterFor`**

Append to `src/lib/facade/corners.ts` (add `import { WALL_THICKNESS } from "./layout";` at the top):

```ts
/** Per-lot wall extension at each end, metres. */
export interface LotMiter {
  left: number;
  right: number;
}

/** How far each side's wall extends (+) or trims (−) at the corner so the
 * two slabs meet without a wedge gap (convex) or z-fighting overlap
 * (concave). Only side a is corrected: one slab fills the corner while the
 * other butts against it — extending both would create exactly coincident
 * faces. Openings never enter the correction (layout engine untouched). */
export function miterFor(corner: Corner): { a: number; b: number } {
  const turnRad = (corner.turn * Math.PI) / 180;
  const base = Math.min(
    Math.tan(turnRad / 2) * WALL_THICKNESS,
    3 * WALL_THICKNESS,
  );
  if (base < 1e-9) return { a: 0, b: 0 };
  return { a: corner.convex ? base : -base / 2, b: 0 };
}
```

Run the tests: `npx vitest run src/lib/facade/corners.test.ts` — 19 pass.

- [ ] **Step 4: Thread miters through the mesh**

In `src/components/facade/FacadeMesh.tsx`:

1. Change the component signature and layout plumbing:

```tsx
export default function FacadeMesh({
  params,
  miter,
}: {
  params: FacadeParams;
  miter?: { left: number; right: number };
}) {
  const ml = miter?.left ?? 0;
  const mr = miter?.right ?? 0;
  const layout = useMemo(() => computeLayout(params), [params]);
  const wallGeo = useMemo(
    () => buildWallGeometry(layout, ml, mr),
    [layout, ml, mr],
  );
```

2. Extend `buildWallGeometry` — the outer rectangle only (holes untouched):

```tsx
function buildWallGeometry(
  layout: FacadeLayout,
  miterL = 0,
  miterR = 0,
): THREE.ExtrudeGeometry {
  const x0 = -layout.width / 2 - miterL;
  const x1 = layout.width / 2 + miterR;
  const shape = new THREE.Shape();
  shape.moveTo(x0, 0);
  shape.lineTo(x1, 0);
  shape.lineTo(x1, layout.wallTop);
  shape.lineTo(x0, layout.wallTop);
  shape.closePath();
  // ... holes loop and extrusion exactly as today ...
```

3. `Cornice` gains `ml`/`mr` props (default 0). Each step box widens and shifts:

```tsx
<boxGeometry args={[layout.width + ml + mr + b.p * 2, b.h, WALL_THICKNESS + b.p]} />
```
with mesh `position` x = `(mr - ml) / 2` instead of `0`. Call site: `<Cornice layout={layout} trimColor={params.trimColor} ml={ml} mr={mr} />`.

4. Parapet body + coping: widths `layout.width + ml + mr` (+0.1 for the coping as today), x position `(mr - ml) / 2`.

Sills, surrounds, openings, stoop: untouched (they never reach the corner sliver).

- [ ] **Step 5: Compute miters in SceneContents**

In `src/components/facade/SceneContents.tsx`:

1. Imports: `import { detectCorners, miterFor, type LotMiter } from "@/lib/facade/corners";` — plus accept a new prop `maxCornerAngle: number` on `SceneContents` (threaded from the page through FacadeViewer's panes, same as `view`).
2. Build the map once per world change (top of `SceneContents`):

```tsx
const miters = useMemo(() => {
  const m = new Map<string, LotMiter>();
  for (const c of detectCorners(blocks, maxCornerAngle)) {
    const ext = miterFor(c);
    for (const [side, e] of [
      [c.a, ext.a],
      [c.b, ext.b],
    ] as const) {
      if (e === 0) continue;
      const key = `${side.blockId}:${side.lotIndex}`;
      const cur = m.get(key) ?? { left: 0, right: 0 };
      m.set(key, { ...cur, [side.lotSide]: e });
    }
  }
  return m;
}, [blocks, maxCornerAngle]);
```

3. Pass down: `BlockGroup` gains a `miters` prop; the lot render becomes

```tsx
<FacadeMesh params={lot.params} miter={miters.get(`${block.id}:${i}`)} />
```

   The map key format `${blockId}:${lotIndex}` must match step 2 exactly.

- [ ] **Step 6: Gates + commit**

```bash
npx tsc --noEmit && npm run lint && npm test
git add src/lib/facade/corners.ts src/lib/facade/corners.test.ts src/components/facade/FacadeMesh.tsx src/components/facade/SceneContents.tsx
git commit -m "feat(facade): mitered corner walls with continuous cornice/parapet"
```

Note: after this task corners LOOK merged (walls meet, moldings continue) with default 150° — the controller's browser checkpoint happens after T4 wiring makes shells sync live.

---

### Task 4: page wiring — state, choke points, corner selection

**Files:**
- Modify: `src/lib/facade/blocks.ts` (Selection), `src/app/facade/page.tsx`, `src/components/facade/FacadeViewer.tsx`

**Interfaces:**
- Consumes: `syncCorners`, `detectCorners`, `cornerChoice`, `DEFAULT_MAX_CORNER_ANGLE`, `CornerChoice`, `Corner` from `@/lib/facade/corners`.
- Produces for T5: page state `cornerChoices: Map<string, CornerChoice>`, `maxCornerAngle: number`; handlers `handleCornerChoice(key, choice)`, `setMaxCornerAngle`; `selected.level === "corner"` with `selected.cornerKey`.

- [ ] **Step 1: Selection type**

In `src/lib/facade/blocks.ts`:

```ts
export interface Selection {
  blockId: string;
  lot: number;
  level: "lot" | "block" | "corner";
  /** Set when level === "corner". */
  cornerKey?: string;
}
```

- [ ] **Step 2: Page state + sync choke points**

In `src/app/facade/page.tsx`:

1. Imports: `import { syncCorners, detectCorners, cornerChoice, DEFAULT_MAX_CORNER_ANGLE, type CornerChoice } from "@/lib/facade/corners";`
2. State (near the other useState calls):

```tsx
const [cornerChoices, setCornerChoices] = useState<Map<string, CornerChoice>>(
  () => new Map(),
);
const [maxCornerAngle, setMaxCornerAngle] = useState(DEFAULT_MAX_CORNER_ANGLE);
```

3. Choke points — each mutation's computed result goes through `syncCorners` (pure → allowed inside updaters). Exact edits:
   - `setParams`: the updater currently ends with `return moveNode(replaced, oldEnd, newEnd) ?? bs;` and the earlier `return replaced;` paths. Wrap every return value: `return syncCorners(X, cornerChoices, maxCornerAngle, selected.blockId);` where X is the existing expression (`replaced` or the moveNode result with `?? bs` OUTSIDE the sync: `const moved = moveNode(replaced, oldEnd, newEnd); return moved ? syncCorners(moved, cornerChoices, maxCornerAngle, selected.blockId) : bs;`). Add `cornerChoices, maxCornerAngle` to the callback deps.
   - `handleMoveNode`: `const next = moveNode(blocks, from, to); if (next && next !== blocks) setBlocks(syncCorners(next, cornerChoices, maxCornerAngle)); return next !== null;` (deps + `cornerChoices, maxCornerAngle`).
   - `handleCommitLine`: `setBlocks((bs) => syncCorners([...bs, newBlock], cornerChoices, maxCornerAngle));` (new corner defaults: primary = wider side).
   - `updateSelectedBlock` (covers reroll/flip/gen): `setBlocks((bs) => syncCorners(bs.map((b) => (b.id === selected.blockId ? fn(b) : b)), cornerChoices, maxCornerAngle, selected.blockId));`
   - Delete-key lot branch: after `deleteLot` succeeds, `setBlocks((bs) => syncCorners(bs.map((b) => (b.id === block.id ? next : b)), cornerChoices, maxCornerAngle, block.id));`
   - Angle-dial changes re-run sync once:

```tsx
useEffect(() => {
  setBlocks((bs) => syncCorners(bs, cornerChoices, maxCornerAngle));
}, [maxCornerAngle, cornerChoices]);
```
   (`syncCorners` returns input identity when nothing changed, so this cannot loop.)

4. Corner selection + choice handlers:

```tsx
const corners = useMemo(
  () => detectCorners(blocks, maxCornerAngle),
  [blocks, maxCornerAngle],
);

const handleSelectCorner = useCallback(
  (cornerKey: string) => {
    const c = corners.find((x) => x.key === cornerKey);
    if (!c) return;
    setSelected({
      blockId: c.a.blockId,
      lot: c.a.lotIndex,
      level: "corner",
      cornerKey,
    });
  },
  [corners],
);

const handleCornerChoice = useCallback(
  (key: string, choice: CornerChoice) => {
    setCornerChoices((m) => {
      const next = new Map(m);
      next.set(key, choice);
      return next;
    });
    // Apply the new choice immediately (e.g. switching primary re-sources
    // the shell; switching to unified mirrors the face now).
    setBlocks((bs) =>
      syncCorners(bs, new Map(cornerChoices).set(key, choice), maxCornerAngle),
    );
  },
  [cornerChoices, maxCornerAngle],
);
```

5. Pass to the viewer: `<FacadeViewer … corners={corners} onSelectCorner={handleSelectCorner} maxCornerAngle={maxCornerAngle} />` and thread `maxCornerAngle` to `SceneContents` (T3's prop).

- [ ] **Step 3: Handles — tint + stationary-click corner select**

In `src/components/facade/FacadeViewer.tsx`:

1. `FacadeViewerProps` gains `corners: Corner[]; onSelectCorner: (key: string) => void; maxCornerAngle: number;` (import `type Corner` from `@/lib/facade/corners`). Thread `corners`/`onSelectCorner` to `PlanPane` → `NodeHandles`, and `maxCornerAngle` to every `SceneContents` render.
2. `NodeHandles` gains `corners` + `onSelectCorner`. Build a lookup:

```tsx
const cornerAt = useMemo(() => {
  const m = new Map<string, string>();
  for (const c of corners) m.set(`${c.node[0]}:${c.node[1]}`, c.key);
  return m;
}, [corners]);
```

3. Track real movement during a drag: add `const movedRef = useRef(false);` — set `movedRef.current = true` inside the drag-catcher's `onPointerMove` whenever `onMoveNode(...)` returned true AND `to` differs from `drag.pos`. Reset to `false` in `onStart`.
4. In `endDrag`: before clearing state, `const key = drag ? cornerAt.get(`${drag.pos[0]}:${drag.pos[1]}`) : undefined; if (!movedRef.current && key) onSelectCorner(key);` — a stationary click on a merged corner's handle selects the corner (the existing 300 ms window still suppresses the underlying lot click; R3F's hit order makes a handle-level onClick unreachable, which is why selection hooks into the drag lifecycle instead).
5. Tint: `NodeHandle` gains `isCorner: boolean`; base color becomes `isCorner ? "#d4a017" : "#e5e7eb"` (hover `#e8c35a` : `#93c5fd"`, active stays accent blue). Pass `isCorner={cornerAt.has(`${n.pos[0]}:${n.pos[1]}`)}`.

- [ ] **Step 4: Gates + commit**

```bash
npx tsc --noEmit && npm run lint && npm test
git add src/lib/facade/blocks.ts src/app/facade/page.tsx src/components/facade/FacadeViewer.tsx
git commit -m "feat(facade): corner state, live shell-sync choke points, corner-node selection"
```

Note: FacadeControls does not yet know `level === "corner"` — it renders the lot panel for the corner's a-side lot (Selection carries blockId/lot). That interim behavior is acceptable for this task; T5 adds the inspector.

---

### Task 5: Corner inspector + docs

**Files:**
- Modify: `src/components/facade/FacadeControls.tsx`, `src/app/facade/page.tsx` (props), `AGENTS.md`

**Interfaces:**
- Consumes: T4's page handlers and `Corner`/`CornerChoice`; `DEFAULT_MAX_CORNER_ANGLE`.
- Produces: final UI.

- [ ] **Step 1: FacadeControls corner branch**

`FacadeControlsProps` gains:

```ts
corner: { data: Corner; choice: CornerChoice; widthA: number; widthB: number } | null;
onCornerChoice: (key: string, choice: CornerChoice) => void;
maxCornerAngle: number;
onMaxCornerAngle: (deg: number) => void;
```

Page computes `corner` for the current selection (`selected.level === "corner"` → find in `corners`, `cornerChoice(...)`, end-lot widths) and passes the four props.

Breadcrumb row: when `corner` is non-null render a third Toggle `Corner` (on) beside `Lot n/m` and `Block` (both off; clicking them switches level as today via `onSelectionLevel` — extend its type to accept `"lot" | "block"`, corner selection only ever set by node click).

Below the breadcrumb, when `corner` non-null render `CornerInspector` INSTEAD of the lot/block panels:

```tsx
function CornerInspector({
  corner,
  onCornerChoice,
  maxCornerAngle,
  onMaxCornerAngle,
}: {
  corner: { data: Corner; choice: CornerChoice; widthA: number; widthB: number };
  onCornerChoice: (key: string, choice: CornerChoice) => void;
  maxCornerAngle: number;
  onMaxCornerAngle: (deg: number) => void;
}) {
  const { data, choice, widthA, widthB } = corner;
  return (
    <div className="space-y-5">
      <Section title="Corner building">
        <div className="grid grid-cols-2 gap-1">
          <Toggle
            label="Unified"
            on={choice.mode === "unified"}
            onClick={() => onCornerChoice(data.key, { ...choice, mode: "unified" })}
          />
          <Toggle
            label="2 facades"
            on={choice.mode === "two-facades"}
            onClick={() =>
              onCornerChoice(data.key, { ...choice, mode: "two-facades" })
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Toggle
            label={`Street A · ${widthA.toFixed(1)}m`}
            on={choice.primary === "a"}
            onClick={() => onCornerChoice(data.key, { ...choice, primary: "a" })}
          />
          <Toggle
            label={`Street B · ${widthB.toFixed(1)}m`}
            on={choice.primary === "b"}
            onClick={() => onCornerChoice(data.key, { ...choice, primary: "b" })}
          />
        </div>
        <p className="text-[10px] text-[var(--muted)] leading-relaxed">
          Shell (storeys, colors, cornice, parapet, glazing style) is always
          shared.{" "}
          {choice.mode === "unified"
            ? `Faces mirror Street ${choice.primary.toUpperCase()} — windows, bays, ground floor.`
            : "Each frontage keeps its own windows, bays, and ground floor."}
        </p>
      </Section>
      <Section title="Detection">
        <SliderRow
          label="Max corner angle (global)"
          value={maxCornerAngle}
          display={`${Math.round(maxCornerAngle)}°`}
          min={0}
          max={180}
          step={5}
          onChange={onMaxCornerAngle}
        />
        <p className="text-[10px] text-[var(--muted)]">
          This corner turns {Math.round(data.turn)}°. Junctions turning more
          than the max stay separate buildings.
        </p>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Gates**

```bash
npx tsc --noEmit && npm run lint && npm test
```

- [ ] **Step 3: AGENTS.md**

File-layout block, after the `nodes.ts` line:

```
      corners.ts       — corner detection (turn/convexity), shell sync, miters
```

Facade designer section, new bullet after "Blocks & streets":

```markdown
- **Corner buildings**: welded two-block junctions turning ≤ the global max
  angle merge into one building (`src/lib/facade/corners.ts`): shells
  (storeys/colors/ornament/glazing) sync through the `syncCorners` choke
  point on every mutation; walls miter so cornice/parapet run continuously;
  corner nodes tint gold and a stationary click opens the corner inspector
  (unified ↔ 2-facades, primary side, global angle).
```

- [ ] **Step 4: Commit**

```bash
git add src/components/facade/FacadeControls.tsx src/app/facade/page.tsx AGENTS.md
git commit -m "feat(facade): corner inspector (mode, primary, global angle) + docs"
```

---

## Final verification (controller)

1. `npm test` (119+), `npx tsc --noEmit`, `npm run lint` (3 baseline).
2. Browser: draw an L street → corner node tints gold, walls meet (no wedge gap), cornice/parapet lines run around the corner; edit storeys/colors on either side → both change; stationary click on the gold node → corner inspector; switch primary → shell re-sources; unified → bays/windows mirror; drag the corner node → corner survives, shells stay synced; lower the max angle below the turn → corner dissolves (independent buildings return); concave corner (streets on the outside of the L) shows no z-fighting; delete one leg → partner returns to normal.
3. Final whole-branch review with `scripts/review-package $(git merge-base main HEAD) HEAD`.
