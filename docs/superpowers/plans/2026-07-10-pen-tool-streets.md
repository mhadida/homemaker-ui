# Pen-Tool Streets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plan pane's one-drag-one-segment drawing with a pen tool (click-chained nodes, Escape/close-loop) and make every node — including shared vertices between blocks — draggable, with buildings re-fitting live.

**Architecture:** Coincidence welding — `FacadeBlock.line` keeps raw coordinates and a "node" is derived from endpoints with bit-identical coordinates. One pure function `refit` re-fits a block's lots after its length changes; one pure function `moveNode` moves every coincident endpoint and refits every attached block. The width-edit path (`syncLineToLots`) routes its computed endpoint through `moveNode`, so welded neighbors re-fit exactly as if the node were dragged.

**Tech Stack:** Next.js 16 App Router, React 19 (Strict Mode), three + @react-three/fiber 9 + drei 10, vitest.

**Spec:** `docs/superpowers/specs/2026-07-10-pen-tool-streets-design.md`

## Global Constraints

- **Weld invariant (verbatim from spec):** "welded endpoints always hold copied, never independently recomputed, coordinate values." The single place arithmetic produces a fresh endpoint (`syncLineToLots`) must route through `moveNode`, which propagates that computed value to all welded endpoints. Endpoint comparison is exact float equality (`===` on both components) — never epsilon.
- **Split rule:** an absorbing lot splits when it reaches `gen.lotWidth.max + gen.lotWidth.min`; the new lot's width is drawn from `[min, max]` via `mulberry32(lotSeed(seed, lotCountAtSplit))`, independent of the absorber's width. The absorber keeps the remainder; the new lot becomes the next absorber.
- **Pinned lots (`customized: true`) are never resized or removed.** `refit`/`moveNode` return `null` to reject a whole move; callers keep prior state (the node "sticks", the slider edit is dropped).
- `moveNode` returns `null` when no endpoint matches `from` (stale-frame guard) and when any attached block cannot absorb.
- **No `Math.random` anywhere in `src/lib/facade/`** — seeds enter from page handlers only.
- `MIN_BLOCK_LENGTH` = 3 m (clicks closer than this to the last node are ignored, including the closing click). Snap radius = 1 m.
- **React Strict Mode purity:** no impure work inside `setState` updaters (`moveNode` is pure and allowed inside updaters; `nextBlockId()`/`Math.random()` must stay outside).
- Baseline before Task 1: 72 vitest tests green (`npm test`). 3 pre-existing lint warnings in `src/lib/building/prompt-parser.ts` and `src/lib/python-server.ts` are the accepted baseline. Local `npm run build` fails for a pre-existing reason (python/.venv symlink vs Turbopack) — do NOT chase it; `npx tsc --noEmit` and `npm run lint` are the gates.
- UI uses the existing dark CSS vars (`--accent`, etc.); no colored edge stripes.

## File map

| File | Change |
|---|---|
| `src/lib/facade/generate.ts` | Add `refit(block, movedEnd)` (Task 1) |
| `src/lib/facade/generate.test.ts` | Add `refit` describe block (Task 1) |
| `src/lib/facade/nodes.ts` | **New** — `WorldNode`, `deriveNodes`, `moveNode` (Task 2) |
| `src/lib/facade/nodes.test.ts` | **New** (Task 2) |
| `src/components/facade/FacadeViewer.tsx` | DrawSurface → PenSurface (Task 3); NodeHandles + drag (Task 4) |
| `src/app/facade/page.tsx` | `handleMoveNode` + prop (Task 4); setParams ripple (Task 5) |
| `AGENTS.md` | Facade section + file layout (Task 5) |

---

### Task 1: `refit` — the one re-fit rule

**Files:**
- Modify: `src/lib/facade/generate.ts` (append after `rerollBlock`)
- Test: `src/lib/facade/generate.test.ts` (append)

**Interfaces:**
- Consumes: existing private helpers in `generate.ts` — `mulberry32`, `lotSeed`, `offsetFor`, `generateLot` — and `blockFrame` from `./blocks`.
- Produces: `export function refit(block: FacadeBlock, movedEnd: "a" | "b"): FacadeBlock | null`. Task 2's `moveNode` calls it. Contract: `block` already carries its NEW `line`; `refit` returns a copy whose lots sum exactly to the new length, or `null` if the move must be rejected. It never mutates its input.

Semantics recap (spec §"The one re-fit rule"): the unpinned lot nearest the moved endpoint absorbs the length delta; lots at the fixed end keep width and position. Below `min` the absorber is removed and the remainder folds onward (next unpinned toward the fixed end). At `max + min` the absorber splits: a seed-drawn new lot appears at the moved side and becomes the next absorber — matching what frame-by-frame dragging produces, so final widths are drag-path independent.

- [ ] **Step 0: Branch + baseline**

```bash
git checkout -b feature/pen-tool-streets
npm test
```
Expected: 72 tests pass.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/facade/generate.test.ts` (it already imports `DEFAULT_GEN`, `initialWorld`, `FacadeBlock` from `./blocks` and `DEFAULT_FACADE` from `./types` — extend the `./generate` import with `refit`, and the `./blocks` import with `type LotState`):

```ts
// ── refit ────────────────────────────────────────────────────────────────

const mkLot = (width: number, customized = false): LotState => ({
  params: { ...DEFAULT_FACADE, width },
  customized,
});

const mkRefitBlock = (
  lots: LotState[],
  opts: Partial<Pick<FacadeBlock, "flipped" | "seed">> = {},
): FacadeBlock => ({
  id: "t",
  line: {
    a: [0, 0],
    b: [lots.reduce((s, l) => s + l.params.width, 0), 0],
  },
  flipped: opts.flipped ?? false,
  gen: structuredClone(DEFAULT_GEN),
  seed: opts.seed ?? 42,
  lots,
});

/** Re-line the block to a new length along +x (a stays at the origin). */
const withLength = (b: FacadeBlock, len: number): FacadeBlock => ({
  ...b,
  line: { a: [0, 0], b: [len, 0] },
});

describe("refit", () => {
  it("grows the lot nearest the moved end; fixed-end lots untouched", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const r = refit(withLength(b, 13), "b")!;
    expect(r.lots.map((l) => l.params.width)).toEqual([5, 8]);
  });

  it("absorbs at the head when line.a moved (unflipped)", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const r = refit({ ...b, line: { a: [-2, 0], b: [11, 0] } }, "a")!;
    expect(r.lots.map((l) => l.params.width)).toEqual([7, 6]);
  });

  it("flipped swaps which array end absorbs", () => {
    // Flipped: frame origin = line.b, so lots[0] sits nearest b.
    const b = mkRefitBlock([mkLot(5), mkLot(6)], { flipped: true });
    const r = refit(withLength(b, 13), "b")!;
    expect(r.lots.map((l) => l.params.width)).toEqual([7, 6]);
  });

  it("skips pinned lots when picking the absorber", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6), mkLot(5, true)]);
    const r = refit(withLength(b, 18), "b")!;
    expect(r.lots.map((l) => l.params.width)).toEqual([5, 8, 5]);
    expect(r.lots[2].customized).toBe(true);
  });

  it("rejects when every lot is pinned", () => {
    const b = mkRefitBlock([mkLot(5, true), mkLot(6, true)]);
    expect(refit(withLength(b, 12), "b")).toBeNull();
  });

  it("shrinking below lotWidth.min removes the absorber and folds onward", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const r = refit(withLength(b, 9), "b")!;
    expect(r.lots.map((l) => l.params.width)).toEqual([9]);
  });

  it("rejects when the only lot would drop below lotWidth.min", () => {
    const b = mkRefitBlock([mkLot(7.5)]);
    expect(refit(withLength(b, 4), "b")).toBeNull();
  });

  it("rejects when removal leaves only pinned lots that cannot fit", () => {
    const b = mkRefitBlock([mkLot(5, true), mkLot(6)]);
    expect(refit(withLength(b, 4), "b")).toBeNull();
  });

  it("splits once the absorber reaches max + min", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const r = refit(withLength(b, 25), "b")!;
    const widths = r.lots.map((l) => l.params.width);
    const T = DEFAULT_GEN.lotWidth.max + DEFAULT_GEN.lotWidth.min;
    expect(widths[0]).toBe(5); // fixed-end lot untouched
    expect(widths.length).toBeGreaterThan(2); // at least one new lot
    expect(widths.reduce((s, w) => s + w, 0)).toBeCloseTo(25, 9);
    for (const w of widths.slice(1)) {
      expect(w).toBeGreaterThanOrEqual(DEFAULT_GEN.lotWidth.min);
      expect(w).toBeLessThan(T);
    }
    for (const l of r.lots.slice(2)) expect(l.customized).toBe(false);
  });

  it("final widths are drag-path independent", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const direct = refit(withLength(b, 25), "b")!;
    const stepped = refit(withLength(refit(withLength(b, 18), "b")!, 25), "b")!;
    expect(stepped.lots.map((l) => l.params.width)).toEqual(
      direct.lots.map((l) => l.params.width),
    );
  });

  it("is deterministic", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const r1 = refit(withLength(b, 25), "b")!;
    const r2 = refit(withLength(b, 25), "b")!;
    expect(r2.lots.map((l) => l.params)).toEqual(r1.lots.map((l) => l.params));
  });

  it("preserves depthOffset on surviving lots and assigns one to new lots", () => {
    const lots: LotState[] = [{ ...mkLot(5), depthOffset: 0.05 }, mkLot(6)];
    const b = mkRefitBlock(lots);
    const r = refit(withLength(b, 25), "b")!;
    expect(r.lots[0].depthOffset).toBe(0.05);
    for (const l of r.lots.slice(2)) expect(typeof l.depthOffset).toBe("number");
  });

  it("returns lots unchanged when the length already matches", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const r = refit(b, "b")!;
    expect(r.lots).toEqual(b.lots);
  });

  it("does not mutate its input", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const snapshot = structuredClone(b);
    refit(withLength(b, 25), "b");
    expect(b).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/facade/generate.test.ts`
Expected: FAIL — `refit` is not exported (`SyntaxError` / `refit is not a function`).

- [ ] **Step 3: Implement `refit`**

Append to `src/lib/facade/generate.ts`:

```ts
const REFIT_EPS = 1e-6;

/** Re-fit a block's lots after its line changed (node drag / weld ripple).
 * `block` already carries the NEW line; `movedEnd` names the raw endpoint
 * that moved. The unpinned lot nearest the moved end absorbs the delta:
 * below lotWidth.min it is removed (remainder folds onward), and at
 * lotWidth.max + lotWidth.min it splits — a seed-drawn new lot appears at
 * the moved side and becomes the next absorber, which is exactly what
 * frame-by-frame dragging produces, so final widths are drag-path
 * independent. Pinned lots are never resized or removed. Returns null when
 * the move cannot be satisfied (caller rejects it). Pure — never mutates. */
export function refit(
  block: FacadeBlock,
  movedEnd: "a" | "b",
): FacadeBlock | null {
  const { min, max } = block.gen.lotWidth;
  const T = max + min; // split threshold: first width divisible into two legal lots
  const target = blockFrame(block).length;
  if (target < REFIT_EPS) return null;
  // Process lots ordered fixed end → moved end. The frame origin sits at
  // line.a unless flipped, so lots[last] is nearest line.b when unflipped.
  const movedAtTail = (movedEnd === "b") !== block.flipped;
  const arr = movedAtTail ? [...block.lots] : [...block.lots].reverse();

  for (let guard = 0; guard <= block.lots.length; guard++) {
    const sum = arr.reduce((s, l) => s + l.params.width, 0);
    const delta = target - sum;
    if (Math.abs(delta) < REFIT_EPS) {
      const lots = movedAtTail ? arr : arr.reverse();
      return { ...block, lots };
    }
    let i = arr.length - 1;
    while (i >= 0 && arr[i].customized) i--;
    if (i < 0) return null; // every lot pinned — nothing may resize
    let aw = arr[i].params.width + delta;
    if (aw < min - REFIT_EPS) {
      if (arr.length === 1) return null; // a block never drops its last lot
      arr.splice(i, 1); // remove; the loop folds the remainder onward
      continue;
    }
    // Grow (or shrink within limits). Split while the absorber can make
    // two legal lots; each split freezes the current absorber at T - nw
    // and hands the remaining growth to the new lot.
    const drawn: { nw: number; r: () => number; idx: number }[] = [];
    let count = arr.length;
    while (aw >= T) {
      const r = mulberry32(lotSeed(block.seed, count));
      const nw = min + r() * (max - min);
      drawn.push({ nw, r, idx: count });
      aw = nw + (aw - T);
      count++;
    }
    const absorberW = drawn.length === 0 ? aw : T - drawn[0].nw;
    arr[i] = {
      ...arr[i],
      params: { ...arr[i].params, width: absorberW },
    };
    const newLots: LotState[] = drawn.map(({ nw, r, idx }, k) => ({
      // Character comes from the seed-drawn width; the final width is the
      // frozen split remainder (or the leftover growth for the newest lot).
      params: {
        ...generateLot(nw, block.gen, r),
        width: k === drawn.length - 1 ? aw : T - drawn[k + 1].nw,
      },
      customized: false,
      depthOffset: offsetFor(block.seed, idx, block.gen.depthJitter),
    }));
    arr.splice(i + 1, 0, ...newLots);
    const lots = movedAtTail ? arr : arr.reverse();
    return { ...block, lots };
  }
  return null;
}
```

Note the `LotState` import already exists in `generate.ts` (`import type { BlockGenSettings, FacadeBlock, LotState } from "./blocks"`). `generateLot(nw, gen, r)` continues the SAME stream `r` that drew the width — that's intentional and deterministic.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/generate.test.ts`
Expected: all pass (existing + 14 new).

Then run the whole suite: `npm test` — expected 86 tests pass, none broken.

- [ ] **Step 5: Commit**

```bash
git add src/lib/facade/generate.ts src/lib/facade/generate.test.ts
git commit -m "feat(facade): refit — re-fit a block's lots after its line changes"
```

---

### Task 2: `nodes.ts` — derived nodes + `moveNode`

**Files:**
- Create: `src/lib/facade/nodes.ts`
- Test: `src/lib/facade/nodes.test.ts`

**Interfaces:**
- Consumes: `refit(block, movedEnd): FacadeBlock | null` from `./generate` (Task 1); `FacadeBlock`, `syncLineToLots`, `DEFAULT_GEN` from `./blocks`.
- Produces (Tasks 4–5 rely on these exact names):

```ts
export interface WorldNode {
  pos: [number, number];
  refs: { blockId: string; end: "a" | "b" }[];
}
export function deriveNodes(blocks: FacadeBlock[]): WorldNode[];
export function moveNode(
  blocks: FacadeBlock[],
  from: [number, number],
  to: [number, number],
): FacadeBlock[] | null;
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/facade/nodes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveNodes, moveNode } from "./nodes";
import {
  syncLineToLots,
  DEFAULT_GEN,
  type FacadeBlock,
} from "./blocks";
import { DEFAULT_FACADE } from "./types";

const mkBlock = (
  id: string,
  a: [number, number],
  b: [number, number],
  widths: number[],
  customized: boolean[] = [],
): FacadeBlock => ({
  id,
  line: { a, b },
  flipped: false,
  gen: structuredClone(DEFAULT_GEN),
  seed: 7,
  lots: widths.map((w, i) => ({
    params: { ...DEFAULT_FACADE, width: w },
    customized: customized[i] ?? false,
  })),
});

describe("deriveNodes", () => {
  it("clusters exactly-equal endpoints into one node with both refs", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const b2 = mkBlock("b2", [11, 0], [22, 0], [5, 6]);
    const nodes = deriveNodes([b1, b2]);
    expect(nodes).toHaveLength(3);
    const shared = nodes.find((n) => n.pos[0] === 11 && n.pos[1] === 0)!;
    expect(shared.refs).toEqual([
      { blockId: "b1", end: "b" },
      { blockId: "b2", end: "a" },
    ]);
  });

  it("keeps distinct endpoints separate (exact equality, no epsilon)", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const b2 = mkBlock("b2", [11.001, 0], [22, 0], [5, 6]);
    expect(deriveNodes([b1, b2])).toHaveLength(4);
  });
});

describe("moveNode", () => {
  it("moves every welded endpoint and refits both blocks", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const b2 = mkBlock("b2", [11, 0], [22, 0], [5, 6]);
    const out = moveNode([b1, b2], [11, 0], [13, 0])!;
    expect(out[0].line.b).toEqual([13, 0]);
    expect(out[1].line.a).toEqual([13, 0]);
    expect(out[0].lots.map((l) => l.params.width)).toEqual([5, 8]);
    // b2 shrank 11 → 9: head lot 5 − 2 = 3 < min → removed, folds → [9]
    expect(out[1].lots.map((l) => l.params.width)).toEqual([9]);
  });

  it("returns null when any attached block cannot absorb", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const b2 = mkBlock("b2", [11, 0], [22, 0], [5, 6], [true, true]);
    expect(moveNode([b1, b2], [11, 0], [13, 0])).toBeNull();
  });

  it("returns null when no endpoint matches (stale-frame guard)", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    expect(moveNode([b1], [99, 99], [100, 100])).toBeNull();
  });

  it("returns the input array when from equals to", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const blocks = [b1];
    expect(moveNode(blocks, [11, 0], [11, 0])).toBe(blocks);
  });

  it("rejects a move that collapses an attached block to zero length", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const b2 = mkBlock("b2", [11, 0], [22, 0], [5, 6]);
    expect(moveNode([b1, b2], [11, 0], [22, 0])).toBeNull();
  });

  it("width-edit ripple: a syncLineToLots end routed through moveNode refits the neighbor", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const b2 = mkBlock("b2", [11, 0], [22, 0], [5, 6]);
    // Hand-widen b1's lot 1 from 6 to 8 — exactly what page setParams does.
    const lots = b1.lots.map((l, i) =>
      i === 1
        ? { ...l, params: { ...l.params, width: 8 }, customized: true }
        : l,
    );
    const updated = syncLineToLots({ ...b1, lots });
    expect(updated.line.b).toEqual([13, 0]);
    const out = moveNode([updated, b2], [11, 0], updated.line.b)!;
    expect(out[0]).toBe(updated); // edited block untouched by moveNode
    expect(out[1].line.a).toEqual([13, 0]);
    expect(out[1].lots.map((l) => l.params.width)).toEqual([9]);
  });

  it("welds survive around a closed loop; unattached blocks keep identity", () => {
    const b1 = mkBlock("b1", [0, 0], [12, 0], [6, 6]);
    const b2 = mkBlock("b2", [12, 0], [12, 11], [5, 6]);
    const b3 = mkBlock("b3", [12, 11], [0, 0], [8, 8]);
    const out = moveNode([b1, b2, b3], [12, 0], [13, 0])!;
    expect(deriveNodes(out)).toHaveLength(3);
    expect(out[0].line.b).toEqual([13, 0]);
    expect(out[1].line.a).toEqual([13, 0]);
    expect(out[2]).toBe(b3); // not attached — byte-identical
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/facade/nodes.test.ts`
Expected: FAIL — cannot resolve `./nodes`.

- [ ] **Step 3: Implement `nodes.ts`**

Create `src/lib/facade/nodes.ts`:

```ts
import type { FacadeBlock } from "./blocks";
import { refit } from "./generate";

/** A derived node: every block endpoint whose coordinates are exactly
 * equal (bit-identical floats). The weld invariant — welded endpoints
 * always hold copied, never independently recomputed, values — makes
 * exact equality safe here. */
export interface WorldNode {
  pos: [number, number];
  refs: { blockId: string; end: "a" | "b" }[];
}

const eq = (p: [number, number], q: [number, number]) =>
  p[0] === q[0] && p[1] === q[1];

export function deriveNodes(blocks: FacadeBlock[]): WorldNode[] {
  const map = new Map<string, WorldNode>();
  for (const b of blocks) {
    for (const end of ["a", "b"] as const) {
      const p = b.line[end];
      const key = `${p[0]}:${p[1]}`;
      let node = map.get(key);
      if (!node) {
        node = { pos: [p[0], p[1]], refs: [] };
        map.set(key, node);
      }
      node.refs.push({ blockId: b.id, end });
    }
  }
  return [...map.values()];
}

/** Move every endpoint at `from` to `to` and re-fit every attached block.
 * Returns null when the move must be rejected: an attached block cannot
 * absorb it, a block would collapse to zero length, or nothing sits at
 * `from` (a stale drag frame — rejecting makes it a harmless no-op). */
export function moveNode(
  blocks: FacadeBlock[],
  from: [number, number],
  to: [number, number],
): FacadeBlock[] | null {
  if (eq(from, to)) return blocks;
  let matched = false;
  const out: FacadeBlock[] = [];
  for (const b of blocks) {
    const hitA = eq(b.line.a, from);
    const hitB = eq(b.line.b, from);
    if (!hitA && !hitB) {
      out.push(b);
      continue;
    }
    matched = true;
    if (hitA && hitB) return null; // degenerate zero-length block
    const line = {
      a: hitA ? ([to[0], to[1]] as [number, number]) : b.line.a,
      b: hitB ? ([to[0], to[1]] as [number, number]) : b.line.b,
    };
    const refitted = refit({ ...b, line }, hitA ? "a" : "b");
    if (!refitted) return null;
    out.push(refitted);
  }
  return matched ? out : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/nodes.test.ts` — expected: 9 pass.
Then `npm test` — expected: 95 pass, none broken.

- [ ] **Step 5: Commit**

```bash
git add src/lib/facade/nodes.ts src/lib/facade/nodes.test.ts
git commit -m "feat(facade): derived world nodes + moveNode with weld-wide refit"
```

---

### Task 3: PenSurface — click-chained drawing

**Files:**
- Modify: `src/components/facade/FacadeViewer.tsx` (replace `DrawSurface`, lines ~106–166, and its use in `PlanPane`)

**Interfaces:**
- Consumes: `snapPoint` from `./blocks` (already imported), existing `onCommitLine(a, b)` prop — signature unchanged, so `page.tsx` needs no edits in this task.
- Produces: `PenSurface` component used by `PlanPane`. The `drawMode` state and ✏ toggle in the workspace shell are unchanged.

Behavior (spec §"Pen drawing"): click places a node (snapped within 1 m); from the second click each click commits a segment via `onCommitLine(last, target)`; rubber band previews from the last node to the snapped cursor; Escape ends the path (placed segments stay); toggling ✏ off ends it; clicking within snap radius of the FIRST node commits the closing segment and ends the path; clicks closer than `MIN_BLOCK_LENGTH` to the last node are ignored (closing click included). No pointer capture is needed — clicks are discrete, there is no drag.

- [ ] **Step 1: Replace `DrawSurface` with `PenSurface`**

Delete the whole `DrawSurface` function (the block starting `/** Invisible ground-plane pick surface + rubber-band line...` through its closing brace) and put this in its place:

```tsx
/** Pen tool: click chains nodes into welded segments. Lives ONLY in the
 * plan pane. Each click from the second on commits a block immediately;
 * Escape (or leaving draw mode) ends the path; clicking near the FIRST
 * node closes the loop. Consecutive segments share exact endpoint
 * coordinates — welded by construction. */
function PenSurface({
  blocks,
  active,
  onCommitLine,
}: {
  blocks: FacadeBlock[];
  active: boolean;
  onCommitLine: (a: [number, number], b: [number, number]) => void;
}) {
  const [path, setPath] = useState<[number, number][]>([]);
  const [cursor, setCursor] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (!active) {
      setPath([]);
      setCursor(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPath([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (!active) return null;
  const first = path[0];
  const last = path[path.length - 1];
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          const p = snapPoint([e.point.x, e.point.z], blocks);
          if (path.length === 0) {
            setPath([p]);
            return;
          }
          const closing =
            path.length >= 2 &&
            Math.hypot(p[0] - first[0], p[1] - first[1]) <= 1;
          const target = closing ? first : p;
          const len = Math.hypot(target[0] - last[0], target[1] - last[1]);
          if (len < MIN_BLOCK_LENGTH) return;
          onCommitLine(last, target);
          setPath(closing ? [] : [...path, target]);
        }}
        onPointerMove={(e) =>
          setCursor(snapPoint([e.point.x, e.point.z], blocks))
        }
      >
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {last && cursor && (
        <Line
          points={[
            [last[0], 0.08, last[1]],
            [cursor[0], 0.08, cursor[1]],
          ]}
          color="#3b82f6"
          lineWidth={3}
          dashed
          dashSize={0.5}
          gapSize={0.3}
        />
      )}
      {path.length >= 2 && (
        <mesh
          position={[first[0], 0.09, first[1]]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.5, 0.7, 24]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.9} />
        </mesh>
      )}
    </>
  );
}
```

- [ ] **Step 2: Swap the use in `PlanPane`**

In `PlanPane`'s JSX, replace

```tsx
{drawMode && <DrawSurface blocks={blocks} onCommitLine={onCommitLine} />}
```

with

```tsx
<PenSurface blocks={blocks} active={drawMode} onCommitLine={onCommitLine} />
```

(`PenSurface` self-gates on `active` so its Escape listener can clean up when draw mode ends.)

- [ ] **Step 3: Typecheck + lint + suite**

```bash
npx tsc --noEmit
npm run lint
npm test
```
Expected: clean (3 baseline lint warnings only), 95 tests pass.

- [ ] **Step 4: Report for visual checkpoint**

The controller verifies in the browser (dev server on :3000): ✏ on → click, click, click chains connected blocks with a rubber band; Escape ends; drawing a rough rectangle and clicking the first node's ring closes the loop; sub-3 m clicks do nothing; each committed segment generates a street block immediately.

- [ ] **Step 5: Commit**

```bash
git add src/components/facade/FacadeViewer.tsx
git commit -m "feat(facade): pen-tool drawing — click-chained welded segments, escape/close-loop"
```

---

### Task 4: NodeHandles — visible, draggable nodes

**Files:**
- Modify: `src/components/facade/FacadeViewer.tsx` (add `NodeHandle`/`NodeHandles`, wire into `PlanPane`)
- Modify: `src/app/facade/page.tsx` (add `handleMoveNode`, pass prop)

**Interfaces:**
- Consumes: `deriveNodes`, `moveNode`, `WorldNode` from `@/lib/facade/nodes` (Task 2).
- Produces: `FacadeViewerProps.onMoveNode: (from: [number, number], to: [number, number]) => boolean` — returns whether the move was applied (false = rejected, the node "sticks"). `PlanPane` gains props `onMoveNode` and internal `nodeDrag` state gating `MapControls`.

- [ ] **Step 1: Add the handle components to `FacadeViewer.tsx`**

Add imports: `deriveNodes` and `type WorldNode` from `@/lib/facade/nodes`. Then add below `PenSurface`:

```tsx
/** One draggable node handle (plan pane). Flat circle just above the
 * block lines; hover/drag states use the accent blue. */
function NodeHandle({
  node,
  active,
  interactive,
  onStart,
}: {
  node: WorldNode;
  active: boolean;
  interactive: boolean;
  onStart: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <mesh
      position={[node.pos[0], 0.1, node.pos[1]]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={
        interactive
          ? (e) => {
              e.stopPropagation();
              onStart();
            }
          : undefined
      }
      onPointerOver={
        interactive
          ? (e) => {
              e.stopPropagation();
              setHover(true);
            }
          : undefined
      }
      onPointerOut={interactive ? () => setHover(false) : undefined}
    >
      <circleGeometry args={[hover || active ? 0.8 : 0.55, 24]} />
      <meshBasicMaterial
        color={active ? "#3b82f6" : hover ? "#93c5fd" : "#e5e7eb"}
        transparent
        opacity={0.95}
        depthWrite={false}
      />
    </mesh>
  );
}

/** All node handles + the drag interaction. Handles are always visible in
 * the plan pane; dragging is disabled while the pen path is active. While
 * dragging, moves apply LIVE via onMoveNode (which may reject — the node
 * sticks), and the node snaps (1 m) to nodes of unattached blocks so
 * releasing there welds them. */
function NodeHandles({
  blocks,
  interactive,
  onMoveNode,
  onDraggingChange,
}: {
  blocks: FacadeBlock[];
  interactive: boolean;
  onMoveNode: (from: [number, number], to: [number, number]) => boolean;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const nodes = useMemo(() => deriveNodes(blocks), [blocks]);
  const [drag, setDrag] = useState<null | {
    pos: [number, number];
    targets: [number, number][];
  }>(null);
  const endDrag = useCallback(() => {
    setDrag(null);
    onDraggingChange(false);
  }, [onDraggingChange]);
  // A release outside the pane must not strand the drag.
  useEffect(() => {
    if (!drag) return;
    window.addEventListener("pointerup", endDrag);
    return () => window.removeEventListener("pointerup", endDrag);
  }, [drag, endDrag]);
  return (
    <>
      {nodes.map((n) => (
        <NodeHandle
          key={`${n.pos[0]}:${n.pos[1]}`}
          node={n}
          active={drag !== null && drag.pos[0] === n.pos[0] && drag.pos[1] === n.pos[1]}
          interactive={interactive && drag === null}
          onStart={() => {
            const attached = new Set(n.refs.map((r) => r.blockId));
            const targets = nodes
              .filter(
                (m) => m !== n && !m.refs.some((r) => attached.has(r.blockId)),
              )
              .map((m) => m.pos);
            setDrag({ pos: n.pos, targets });
            onDraggingChange(true);
          }}
        />
      ))}
      {drag && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.03, 0]}
          onPointerMove={(e) => {
            const raw: [number, number] = [e.point.x, e.point.z];
            let best: [number, number] | null = null;
            let bestD = 1;
            for (const t of drag.targets) {
              const d = Math.hypot(raw[0] - t[0], raw[1] - t[1]);
              if (d < bestD) {
                bestD = d;
                best = t;
              }
            }
            const to = best ?? raw;
            if (onMoveNode(drag.pos, to))
              setDrag((d) => (d ? { ...d, pos: to } : d));
          }}
          onPointerUp={endDrag}
        >
          <planeGeometry args={[600, 600]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </>
  );
}
```

- [ ] **Step 2: Wire into `PlanPane`**

Add to `PlanPane` props: `onMoveNode: (from: [number, number], to: [number, number]) => boolean;` and a state `const [nodeDrag, setNodeDrag] = useState(false);`. In its JSX, after the `PenSurface` line, add:

```tsx
<NodeHandles
  blocks={blocks}
  interactive={!drawMode}
  onMoveNode={onMoveNode}
  onDraggingChange={setNodeDrag}
/>
```

and change the `MapControls` prop to `enabled={!drawMode && !nodeDrag}`.

Thread the prop through: add `onMoveNode` to `FacadeViewerProps`, to the `FacadeViewer` destructure, and to the `<PlanPane …>` call in `paneContent`.

- [ ] **Step 3: Add `handleMoveNode` in `page.tsx`**

Import `moveNode` from `@/lib/facade/nodes`. Add after `handleCommitLine`:

```tsx
const handleMoveNode = useCallback(
  (from: [number, number], to: [number, number]) => {
    // Computed OUTSIDE the updater so the boolean result is available
    // synchronously; moveNode is pure. A stale-closure frame (blocks not
    // yet re-rendered) returns null and is simply skipped — the drag
    // recovers on the next frame.
    const next = moveNode(blocks, from, to);
    if (next && next !== blocks) setBlocks(next);
    return next !== null;
  },
  [blocks],
);
```

Pass it: `<FacadeViewer … onMoveNode={handleMoveNode} />`.

- [ ] **Step 4: Typecheck + lint + suite**

```bash
npx tsc --noEmit && npm run lint && npm test
```
Expected: clean (baseline warnings only), 95 tests pass.

- [ ] **Step 5: Report for visual checkpoint**

Controller verifies: handles visible on every endpoint; dragging a shared node reshapes both blocks live with lots appearing/disappearing at limits; dragging clamps (sticks) when a block is fully pinned; dragging near a foreign endpoint snaps and welds; plan doesn't pan during a handle drag; handles don't drag while the pen path is active.

- [ ] **Step 6: Commit**

```bash
git add src/components/facade/FacadeViewer.tsx src/app/facade/page.tsx
git commit -m "feat(facade): draggable node handles with live weld-wide refit"
```

---

### Task 5: Width-edit ripple + docs

**Files:**
- Modify: `src/app/facade/page.tsx` (the `setParams` callback)
- Modify: `AGENTS.md` (facade section + file layout)

**Interfaces:**
- Consumes: `moveNode` from `@/lib/facade/nodes` (already imported in Task 4); `syncLineToLots` (already imported).
- Produces: nothing new — behavior change only. The pure logic is already covered by the Task 2 ripple test; this task routes the page through it.

- [ ] **Step 1: Route `setParams` line changes through `moveNode`**

Replace the existing `setParams` callback body in `page.tsx` with:

```tsx
const setParams = useCallback(
  (next: FacadeParams | ((prev: FacadeParams) => FacadeParams)) => {
    setBlocks((bs) => {
      const b = bs.find((x) => x.id === selected.blockId);
      if (!b) return bs;
      const lotIndex = Math.min(selected.lot, b.lots.length - 1);
      const prev = b.lots[lotIndex].params;
      const value = typeof next === "function" ? next(prev) : next;
      const lots = b.lots.map((l, i) =>
        i === lotIndex ? { ...l, params: value, customized: true } : l,
      );
      const updated = syncLineToLots({ ...b, lots });
      const replaced = bs.map((x) => (x.id === b.id ? updated : x));
      const endKey = b.flipped ? ("a" as const) : ("b" as const);
      const oldEnd = b.line[endKey];
      const newEnd = updated.line[endKey];
      if (oldEnd[0] === newEnd[0] && oldEnd[1] === newEnd[1]) return replaced;
      const welded = bs.some(
        (x) =>
          x.id !== b.id &&
          ((x.line.a[0] === oldEnd[0] && x.line.a[1] === oldEnd[1]) ||
            (x.line.b[0] === oldEnd[0] && x.line.b[1] === oldEnd[1])),
      );
      if (!welded) return replaced;
      // The computed end is a node move: welded neighbors re-fit exactly
      // as if the shared node were dragged. If any cannot absorb, the
      // whole edit is rejected (the slider clamps). moveNode is pure, so
      // it is Strict Mode-safe inside this updater.
      return moveNode(replaced, oldEnd, newEnd) ?? bs;
    });
  },
  [selected],
);
```

Free (unwelded) endpoints take the `!welded` early return — byte-identical behavior to today.

- [ ] **Step 2: Typecheck + lint + suite**

```bash
npx tsc --noEmit && npm run lint && npm test
```
Expected: clean, 95 tests pass.

- [ ] **Step 3: Update `AGENTS.md`**

In the key-file-layout block, add after the `generate.ts` line:

```
      nodes.ts         — derived nodes (coincidence welds), moveNode + refit ripple
```

In the "Facade designer (`/facade`)" section, replace the "Blocks & streets" bullet with:

```markdown
- **Blocks & streets**: pen-tool drawing in the plan pane — click chains
  nodes into welded segments (Escape ends, clicking the first node closes
  the loop); every segment is a generated block (`src/lib/facade/blocks.ts`
  + `generate.ts`). Nodes are derived from exactly-equal endpoints
  (`nodes.ts`); dragging one re-fits every attached block (`refit` in
  `generate.ts` — absorb at the moved end, split at lotWidth.max+min,
  remove below min). Width edits ripple through welds the same way. Hand
  edits pin lots against reroll.
```

- [ ] **Step 4: Commit**

```bash
git add src/app/facade/page.tsx AGENTS.md
git commit -m "feat(facade): width edits ripple through welds; document pen-tool streets"
```

---

## Final verification (controller)

1. `npm test` — 95 passing; `npx tsc --noEmit` + `npm run lint` clean (baseline warnings only).
2. Browser: draw a 3-segment street + a closed loop; drag interior nodes (blocks re-fit, lots split/merge at limits); pin a lot (hand edit) and confirm dragging clamps at it; width-slider a lot in a welded chain and watch the neighbor re-fit; free-standing single block still behaves exactly as v1.
3. Final whole-branch review (most capable model) with `scripts/review-package $(git merge-base main HEAD) HEAD`.
