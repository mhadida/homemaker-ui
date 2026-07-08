# Facade Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-wall parametric facade designer for infill urban lots at a new `/facade` route — pure client-side Three.js geometry, live sliders, bay-grid opening control, ornament, neighbor-mass context, AI prompt.

**Architecture:** A pure layout engine (`src/lib/facade/layout.ts`) turns `FacadeParams` into flat rectangle data (`FacadeLayout`); an R3F mesh component renders that layout (wall = extruded shape with punched holes); a viewer + controls page wires it all with plain `useState` (no draft/committed split — everything is live). AI prompt gets a sibling route cloned from `/api/prompt`.

**Tech Stack:** Next.js 16.2.1 (App Router), React 19, three 0.184 + @react-three/fiber 9 + drei 10, Tailwind v4 CSS vars, zod 4 + `ai` SDK (existing), vitest (new devDependency, unit tests for the layout engine only).

**Spec:** `docs/superpowers/specs/2026-07-06-facade-designer-design.md`

## Global Constraints

- Next.js is 16.2.1 — APIs may differ from training data. Read `node_modules/next/dist/docs/` before writing Next-specific code (per AGENTS.md).
- Dark-only theme. Use the existing CSS vars: `--background`, `--foreground`, `--panel-bg`, `--border`, `--accent`, `--muted`. No light theme.
- Tailwind v4 (`@import "tailwindcss"`, no config file). Match the control-panel idioms in `src/components/demo/SliderControls.tsx` (label style: `text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium`).
- **No colored edge stripes** on any panel/card (project design rule).
- No new runtime dependencies. The only new devDependency is `vitest`.
- Path alias `@/*` → `./src/*`.
- The main `/` page, Python pipeline, `/build`, and `/api/prompt` are NOT modified. The only existing files touched: `package.json` (vitest), `src/components/demo/PromptInput.tsx` (two optional backwards-compatible props — a small, justified deviation from the spec's "reused unchanged": the hardcoded suggestion chips are building-specific and wrong for facades), `AGENTS.md` (docs, final task).
- All facade dimensions in meters. Facade coordinate system: **x ∈ [-width/2, width/2]** (0 = lot centerline), **y ∈ [0, wallTop]** (0 = sidewalk), **z = 0 is the facade front face, facing +z (the street)**; the wall body extends to z = -0.35.
- Commit after every task. Work happens on branch `feature/facade-designer`.

---

### Task 1: Branch, vitest infrastructure, facade types module

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/facade/types.ts`
- Create: `src/lib/facade/types.test.ts`
- Modify: `package.json` (add vitest devDependency + `test` script)

**Interfaces:**
- Consumes: `classicalStoreyHeights` from `@/lib/building/types` (existing: `(storeys: number, baseStoreyHeight: number, style?: StyleId) => number[]`).
- Produces: `OpeningKind`, `GroundTreatment`, `GroundFloorConfig`, `OrnamentConfig`, `CellOverride`, `PresetId`, `FacadeParams`, `LotContext`, `FACADE_LIMITS`, `DEFAULT_FACADE`, `DEFAULT_LOT_CONTEXT`, `DOOR_SWATCHES`, `FACADE_PRESETS` — every later task imports from this module.

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feature/facade-designer
```

- [ ] **Step 2: Install vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 3: Add the test script to package.json**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 4: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 5: Write the failing test** — `src/lib/facade/types.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_FACADE,
  FACADE_PRESETS,
  FACADE_LIMITS,
} from "./types";

describe("facade types", () => {
  it("default params are within limits", () => {
    expect(DEFAULT_FACADE.width).toBeGreaterThanOrEqual(FACADE_LIMITS.width.min);
    expect(DEFAULT_FACADE.width).toBeLessThanOrEqual(FACADE_LIMITS.width.max);
    expect(DEFAULT_FACADE.storeys).toBeGreaterThanOrEqual(FACADE_LIMITS.storeys.min);
    expect(DEFAULT_FACADE.storeys).toBeLessThanOrEqual(FACADE_LIMITS.storeys.max);
    expect(DEFAULT_FACADE.bays).toBeGreaterThanOrEqual(FACADE_LIMITS.bays.min);
    expect(DEFAULT_FACADE.bays).toBeLessThanOrEqual(FACADE_LIMITS.bays.max);
    expect(DEFAULT_FACADE.groundFloor.doorBay).toBeLessThan(DEFAULT_FACADE.bays);
    expect(DEFAULT_FACADE.storeyHeights).toHaveLength(DEFAULT_FACADE.storeys);
  });

  it("every preset produces valid params when spread over defaults", () => {
    for (const [id, preset] of Object.entries(FACADE_PRESETS)) {
      const p = { ...DEFAULT_FACADE, ...preset.params };
      expect(p.storeys, id).toBeGreaterThanOrEqual(1);
      expect(p.storeys, id).toBeLessThanOrEqual(6);
      expect(p.bays, id).toBeGreaterThanOrEqual(1);
      expect(p.groundFloor.doorBay, id).toBeLessThan(p.bays);
      expect(p.storeyHeights, id).toBeDefined();
      expect(preset.label, id).toBeTruthy();
    }
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/lib/facade/types.test.ts`
Expected: FAIL — cannot resolve `./types`.

- [ ] **Step 7: Create `src/lib/facade/types.ts`**

```ts
import { classicalStoreyHeights } from "@/lib/building/types";

export type OpeningKind = "window" | "door" | "blank" | "shopfront" | "garage";

export type GroundTreatment = "residential" | "shopfront" | "garage";

export interface GroundFloorConfig {
  treatment: GroundTreatment;
  /** Which bay gets the entrance (0 = leftmost). Clamped to bays-1 by the
   * layout engine, so stale values after a bay-count change are harmless. */
  doorBay: number;
  /** Entry steps in front of the door (residential treatment only). */
  stoop: boolean;
}

export interface OrnamentConfig {
  cornice: boolean;
  parapet: boolean;
  sills: boolean;
  surrounds: boolean;
}

export interface CellOverride {
  /** 0 = ground storey */
  storey: number;
  /** 0 = leftmost bay */
  bay: number;
  kind: OpeningKind;
}

export type PresetId = "georgian" | "victorian-shopfront" | "modern";

export interface FacadeParams {
  /** Lot width in meters */
  width: number;
  /** 1–6 */
  storeys: number;
  /** Baseline average storey height */
  storeyHeight: number;
  /** Per-storey heights (bottom-up), classical ratios. Falls back to
   * storeyHeight per storey when absent/short. */
  storeyHeights?: number[];
  /** Vertical bay count, 1–9 */
  bays: number;
  /** Opening width as fraction of bay width */
  windowWidthRatio: number;
  /** Opening height as fraction of storey height */
  windowHeightRatio: number;
  /** Sparse per-cell overrides of the default grid kinds */
  cellOverrides?: CellOverride[];
  groundFloor: GroundFloorConfig;
  ornament: OrnamentConfig;
  /** #RRGGBB — wall render color */
  wallColor: string;
  /** #RRGGBB — cornice/sills/surrounds/frames */
  trimColor: string;
  /** #RRGGBB — door + garage panel */
  doorColor: string;
  preset?: PresetId;
}

/** Grey party-wall neighbor masses. Separate from FacadeParams so tweaking
 * them never rebuilds the facade geometry. */
export interface LotContext {
  leftNeighborHeight: number;
  rightNeighborHeight: number;
  show: boolean;
}

export const FACADE_LIMITS = {
  width: { min: 4, max: 20 },
  storeys: { min: 1, max: 6 },
  storeyHeight: { min: 2.2, max: 4.5 },
  bays: { min: 1, max: 9 },
  windowWidthRatio: { min: 0.2, max: 0.8 },
  windowHeightRatio: { min: 0.3, max: 0.8 },
  neighborHeight: { min: 3, max: 20 },
} as const;

export const DEFAULT_FACADE: FacadeParams = {
  width: 7.5,
  storeys: 3,
  storeyHeight: 3.0,
  storeyHeights: classicalStoreyHeights(3, 3.0),
  bays: 3,
  windowWidthRatio: 0.45,
  windowHeightRatio: 0.55,
  groundFloor: { treatment: "residential", doorBay: 0, stoop: true },
  ornament: { cornice: true, parapet: false, sills: true, surrounds: false },
  wallColor: "#c7bca8",
  trimColor: "#ece8e0",
  doorColor: "#3d4a42",
};

export const DEFAULT_LOT_CONTEXT: LotContext = {
  leftNeighborHeight: 9,
  rightNeighborHeight: 7,
  show: true,
};

/** Door + garage panel swatches — deep traditional door colors. */
export const DOOR_SWATCHES: { id: string; label: string; hex: string }[] = [
  { id: "racing-green", label: "Green", hex: "#3d4a42" },
  { id: "oxblood", label: "Oxblood", hex: "#5c3a35" },
  { id: "navy", label: "Navy", hex: "#2e3a4d" },
  { id: "black", label: "Black", hex: "#26262a" },
  { id: "white", label: "White", hex: "#e8e4da" },
];

/** Presets are parameter bundles, not code paths. Applying one spreads
 * `params` over DEFAULT_FACADE and clears cellOverrides (done by the page). */
export const FACADE_PRESETS: Record<
  PresetId,
  { label: string; params: Partial<FacadeParams> }
> = {
  georgian: {
    label: "Georgian",
    params: {
      storeys: 3,
      bays: 3,
      storeyHeight: 3.2,
      storeyHeights: classicalStoreyHeights(3, 3.2),
      windowWidthRatio: 0.4,
      windowHeightRatio: 0.6,
      groundFloor: { treatment: "residential", doorBay: 0, stoop: true },
      ornament: { cornice: true, parapet: true, sills: true, surrounds: false },
      wallColor: "#c7bca8",
      trimColor: "#ece8e0",
      doorColor: "#3d4a42",
    },
  },
  "victorian-shopfront": {
    label: "Shopfront",
    params: {
      storeys: 3,
      bays: 3,
      storeyHeight: 3.4,
      storeyHeights: classicalStoreyHeights(3, 3.4),
      windowWidthRatio: 0.5,
      windowHeightRatio: 0.6,
      groundFloor: { treatment: "shopfront", doorBay: 1, stoop: false },
      ornament: { cornice: true, parapet: false, sills: true, surrounds: true },
      wallColor: "#a89c8d",
      trimColor: "#ddd3c3",
      doorColor: "#26262a",
    },
  },
  modern: {
    label: "Modern",
    params: {
      storeys: 4,
      bays: 2,
      storeyHeight: 2.9,
      storeyHeights: classicalStoreyHeights(4, 2.9),
      windowWidthRatio: 0.7,
      windowHeightRatio: 0.7,
      groundFloor: { treatment: "residential", doorBay: 1, stoop: false },
      ornament: { cornice: false, parapet: true, sills: false, surrounds: false },
      wallColor: "#ece8e0",
      trimColor: "#8e9298",
      doorColor: "#26262a",
    },
  },
};
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/lib/facade/types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Verify the Next build still typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/facade/
git commit -m "feat(facade): vitest infra + facade types module"
```

---

### Task 2: Layout engine — grid resolution

**Files:**
- Create: `src/lib/facade/layout.ts` (started here, extended in Task 3)
- Create: `src/lib/facade/layout.test.ts` (started here, extended in Task 3)

**Interfaces:**
- Consumes: `FacadeParams`, `OpeningKind` from `./types` (Task 1).
- Produces: `resolveGrid(params: FacadeParams): OpeningKind[][]` — indexed `[storey][bay]`, storey 0 = ground, bay 0 = leftmost. Used by Task 3 (computeLayout) and Task 6 (BayGrid editor).

- [ ] **Step 1: Write the failing tests** — `src/lib/facade/layout.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { resolveGrid } from "./layout";
import { DEFAULT_FACADE, type FacadeParams } from "./types";

function p(overrides: Partial<FacadeParams>): FacadeParams {
  return { ...DEFAULT_FACADE, ...overrides };
}

describe("resolveGrid", () => {
  it("upper storeys default to windows", () => {
    const grid = resolveGrid(p({ storeys: 3, bays: 3 }));
    expect(grid).toHaveLength(3);
    expect(grid[1]).toEqual(["window", "window", "window"]);
    expect(grid[2]).toEqual(["window", "window", "window"]);
  });

  it("residential ground row: door at doorBay, windows elsewhere", () => {
    const grid = resolveGrid(
      p({
        bays: 3,
        groundFloor: { treatment: "residential", doorBay: 1, stoop: false },
      }),
    );
    expect(grid[0]).toEqual(["window", "door", "window"]);
  });

  it("shopfront ground row: shopfront everywhere except the door bay", () => {
    const grid = resolveGrid(
      p({
        bays: 3,
        groundFloor: { treatment: "shopfront", doorBay: 0, stoop: false },
      }),
    );
    expect(grid[0]).toEqual(["door", "shopfront", "shopfront"]);
  });

  it("garage ground row: garage at doorBay, windows elsewhere", () => {
    const grid = resolveGrid(
      p({
        bays: 3,
        groundFloor: { treatment: "garage", doorBay: 2, stoop: false },
      }),
    );
    expect(grid[0]).toEqual(["window", "window", "garage"]);
  });

  it("out-of-range doorBay clamps to the last bay", () => {
    const grid = resolveGrid(
      p({
        bays: 2,
        groundFloor: { treatment: "residential", doorBay: 7, stoop: false },
      }),
    );
    expect(grid[0]).toEqual(["window", "door"]);
  });

  it("cellOverrides patch individual cells", () => {
    const grid = resolveGrid(
      p({
        storeys: 2,
        bays: 2,
        cellOverrides: [{ storey: 1, bay: 0, kind: "blank" }],
      }),
    );
    expect(grid[1][0]).toBe("blank");
    expect(grid[1][1]).toBe("window");
  });

  it("out-of-range overrides are ignored", () => {
    const grid = resolveGrid(
      p({
        storeys: 2,
        bays: 2,
        cellOverrides: [
          { storey: 5, bay: 0, kind: "blank" },
          { storey: 0, bay: 9, kind: "blank" },
          { storey: -1, bay: 0, kind: "blank" },
        ],
      }),
    );
    expect(grid.flat()).not.toContain("blank");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/facade/layout.test.ts`
Expected: FAIL — cannot resolve `./layout`.

- [ ] **Step 3: Create `src/lib/facade/layout.ts` with resolveGrid**

```ts
import type { FacadeParams, OpeningKind } from "./types";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Resolve the (storeys × bays) grid of opening kinds: defaults from the
 * ground-floor treatment + upper-storey windows, then sparse overrides.
 * Indexed [storey][bay]; storey 0 = ground, bay 0 = leftmost. */
export function resolveGrid(params: FacadeParams): OpeningKind[][] {
  const { storeys, bays } = params;
  const doorBay = clamp(params.groundFloor.doorBay, 0, bays - 1);
  const t = params.groundFloor.treatment;

  const grid: OpeningKind[][] = [];
  for (let s = 0; s < storeys; s++) {
    const row: OpeningKind[] = [];
    for (let b = 0; b < bays; b++) {
      if (s === 0) {
        if (b === doorBay) row.push(t === "garage" ? "garage" : "door");
        else row.push(t === "shopfront" ? "shopfront" : "window");
      } else {
        row.push("window");
      }
    }
    grid.push(row);
  }

  for (const o of params.cellOverrides ?? []) {
    if (o.storey >= 0 && o.storey < storeys && o.bay >= 0 && o.bay < bays) {
      grid[o.storey][o.bay] = o.kind;
    }
  }
  return grid;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/layout.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/facade/layout.ts src/lib/facade/layout.test.ts
git commit -m "feat(facade): grid resolution — treatment defaults + sparse overrides"
```

---

### Task 3: Layout engine — geometry layout with clamps

**Files:**
- Modify: `src/lib/facade/layout.ts` (append below resolveGrid)
- Modify: `src/lib/facade/layout.test.ts` (append)

**Interfaces:**
- Consumes: `resolveGrid` (Task 2), `FacadeParams` (Task 1).
- Produces (all consumed by Task 4's mesh and Task 5's viewer):
  - `computeLayout(params: FacadeParams): FacadeLayout`
  - `interface OpeningRect { kind; storey; bay; x; y; w; h }` — x/y is the bottom-left corner in facade coords.
  - `interface FacadeLayout { width; wallTop; totalHeight; storeyLevels; grid; openings; cornice; parapet; sills; surrounds; stoop }`
  - Exported constants: `WALL_THICKNESS = 0.35`, `MIN_PIER = 0.3`, plus the others below.

- [ ] **Step 1: Append the failing tests** to `src/lib/facade/layout.test.ts`

Add `computeLayout` to the existing import from `./layout`, `type OpeningRect` too, then append:

```ts
function rectsOverlap(a: OpeningRect, b: OpeningRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function invariants(params: FacadeParams) {
  const layout = computeLayout(params);
  for (const o of layout.openings) {
    // inside the wall, with tolerance for float noise
    expect(o.x).toBeGreaterThanOrEqual(-layout.width / 2 - 1e-9);
    expect(o.x + o.w).toBeLessThanOrEqual(layout.width / 2 + 1e-9);
    expect(o.y).toBeGreaterThanOrEqual(-1e-9);
    expect(o.y + o.h).toBeLessThanOrEqual(layout.wallTop + 1e-9);
    expect(o.w).toBeGreaterThan(0);
    expect(o.h).toBeGreaterThan(0);
  }
  for (let i = 0; i < layout.openings.length; i++) {
    for (let j = i + 1; j < layout.openings.length; j++) {
      expect(
        rectsOverlap(layout.openings[i], layout.openings[j]),
        `openings ${i} and ${j} overlap`,
      ).toBe(false);
    }
  }
  return layout;
}

describe("computeLayout", () => {
  it("default params satisfy all invariants", () => {
    const layout = invariants(DEFAULT_FACADE);
    expect(layout.storeyLevels).toHaveLength(DEFAULT_FACADE.storeys + 1);
    expect(layout.wallTop).toBeCloseTo(
      layout.storeyLevels[DEFAULT_FACADE.storeys],
      9,
    );
  });

  it("the door lands in doorBay", () => {
    const layout = computeLayout(
      p({ bays: 3, groundFloor: { treatment: "residential", doorBay: 2, stoop: false } }),
    );
    const door = layout.openings.find((o) => o.kind === "door");
    expect(door).toBeDefined();
    expect(door!.bay).toBe(2);
    expect(door!.y).toBe(0); // no stoop → threshold at sidewalk level
  });

  it("stoop raises the door threshold by the total rise", () => {
    const layout = computeLayout(
      p({ groundFloor: { treatment: "residential", doorBay: 0, stoop: true } }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    expect(door.y).toBeCloseTo(0.3, 9); // STOOP_RISE 0.15 × STOOP_STEPS 2
    expect(layout.stoop).not.toBeNull();
    expect(layout.stoop!.x).toBeLessThan(door.x);
    expect(layout.stoop!.x + layout.stoop!.w).toBeGreaterThan(door.x + door.w);
  });

  it("a blank override removes that cell's opening", () => {
    const layout = computeLayout(
      p({ cellOverrides: [{ storey: 1, bay: 1, kind: "blank" }] }),
    );
    expect(
      layout.openings.find((o) => o.storey === 1 && o.bay === 1),
    ).toBeUndefined();
  });

  it("extreme narrow bays (width 4, 9 bays) skip degenerate openings but never crash", () => {
    invariants(p({ width: 4, bays: 9 }));
  });

  it("max window ratios keep a pier between adjacent windows", () => {
    const layout = invariants(
      p({ windowWidthRatio: 0.8, windowHeightRatio: 0.8, bays: 4 }),
    );
    const row = layout.openings
      .filter((o) => o.storey === 1)
      .sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].x - (row[i - 1].x + row[i - 1].w);
      expect(gap).toBeGreaterThanOrEqual(0.3 - 1e-9); // MIN_PIER
    }
  });

  it("shopfront glazing fills the bay minus a party-wall pier and fascia", () => {
    const params = p({
      width: 9,
      bays: 3,
      groundFloor: { treatment: "shopfront", doorBay: 1, stoop: false },
    });
    const layout = invariants(params);
    const shops = layout.openings.filter((o) => o.kind === "shopfront");
    expect(shops).toHaveLength(2);
    const left = shops.find((o) => o.bay === 0)!;
    expect(left.x).toBeCloseTo(-4.5 + 0.3, 9); // party edge keeps MIN_PIER
    const storeyH = layout.storeyLevels[1] - layout.storeyLevels[0];
    expect(left.h).toBeCloseTo(storeyH - 0.5, 9); // SHOPFRONT_FASCIA
  });

  it("ornament toggles populate/clear their layout entries", () => {
    const on = computeLayout(
      p({ ornament: { cornice: true, parapet: true, sills: true, surrounds: true } }),
    );
    expect(on.cornice).not.toBeNull();
    expect(on.parapet).not.toBeNull();
    expect(on.sills.length).toBeGreaterThan(0);
    expect(on.surrounds.length).toBeGreaterThan(0);
    expect(on.totalHeight).toBeGreaterThan(on.wallTop);

    const off = computeLayout(
      p({ ornament: { cornice: false, parapet: false, sills: false, surrounds: false } }),
    );
    expect(off.cornice).toBeNull();
    expect(off.parapet).toBeNull();
    expect(off.sills).toHaveLength(0);
    expect(off.surrounds).toHaveLength(0);
    expect(off.totalHeight).toBeCloseTo(off.wallTop, 9);
  });

  it("parapet sits on top of the cornice when both are enabled", () => {
    const layout = computeLayout(
      p({ ornament: { cornice: true, parapet: true, sills: false, surrounds: false } }),
    );
    expect(layout.parapet!.y).toBeCloseTo(
      layout.cornice!.y + layout.cornice!.height,
      9,
    );
  });

  it("short storeys (2.2m) still produce valid windows", () => {
    invariants(p({ storeyHeight: 2.2, storeyHeights: [2.2, 2.2, 2.2] }));
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/lib/facade/layout.test.ts`
Expected: FAIL — `computeLayout` not exported. The 7 resolveGrid tests still pass.

- [ ] **Step 3: Append constants, types, and computeLayout to `src/lib/facade/layout.ts`**

```ts
// ── Layout constants (meters) ────────────────────────────────────────────────
export const WALL_THICKNESS = 0.35;
export const MIN_PIER = 0.3; // min wall between adjacent openings / at party edges
export const SILL_HEIGHT = 0.9; // window sill above storey floor
export const WINDOW_HEAD_GAP = 0.3; // min wall above a window within its storey
export const DOOR_WIDTH = 1.0;
export const DOOR_HEIGHT_MAX = 2.3;
export const DOOR_HEAD_GAP = 0.3;
export const GARAGE_WIDTH_MAX = 2.6;
export const GARAGE_HEIGHT_MAX = 2.4;
export const SHOPFRONT_FASCIA = 0.5; // wall band above shopfront glazing
export const SHOPFRONT_MULLION = 0.06; // half-gap between adjacent shopfront bays
export const STOOP_RISE = 0.15;
export const STOOP_RUN = 0.3;
export const STOOP_STEPS = 2;
export const CORNICE_HEIGHT = 0.35;
export const CORNICE_PROJECTION = 0.25;
export const PARAPET_HEIGHT = 0.75;
const MIN_OPENING_WIDTH = 0.2;
const MIN_WINDOW_HEIGHT = 0.4;

export interface OpeningRect {
  kind: Exclude<OpeningKind, "blank">;
  storey: number;
  bay: number;
  /** left edge, facade coords */
  x: number;
  /** bottom edge, facade coords */
  y: number;
  w: number;
  h: number;
}

export interface FacadeLayout {
  width: number;
  /** top of the wall body (bottom of cornice, if any) */
  wallTop: number;
  /** wallTop + cornice + parapet */
  totalHeight: number;
  /** y of each storey floor, length storeys+1 (last = wallTop) */
  storeyLevels: number[];
  /** resolved [storey][bay] kinds (same as resolveGrid) */
  grid: OpeningKind[][];
  openings: OpeningRect[];
  cornice: { y: number; height: number; projection: number } | null;
  parapet: { y: number; height: number } | null;
  /** one per window when ornament.sills */
  sills: { x: number; y: number; w: number }[];
  /** window rects to frame when ornament.surrounds */
  surrounds: OpeningRect[];
  stoop: {
    x: number;
    w: number;
    steps: number;
    rise: number;
    run: number;
  } | null;
}

/** storeyHeights padded/truncated to `storeys`, falling back to storeyHeight. */
function resolveStoreyHeights(params: FacadeParams): number[] {
  const hs = params.storeyHeights ?? [];
  const out: number[] = [];
  for (let s = 0; s < params.storeys; s++) out.push(hs[s] ?? params.storeyHeight);
  return out;
}

/** Pure layout: FacadeParams → flat rectangles. All validity clamps live
 * HERE (single source of truth) — the mesh layer renders whatever this
 * returns without further checks. Degenerate cells (too narrow/short after
 * clamping) are silently skipped, never emitted invalid. */
export function computeLayout(params: FacadeParams): FacadeLayout {
  const width = params.width;
  const bays = params.bays;
  const heights = resolveStoreyHeights(params);
  const storeyLevels: number[] = [0];
  for (const h of heights) storeyLevels.push(storeyLevels[storeyLevels.length - 1] + h);
  const wallTop = storeyLevels[params.storeys];
  const grid = resolveGrid(params);
  const bayWidth = width / bays;
  const stoopRise = STOOP_RISE * STOOP_STEPS;

  const openings: OpeningRect[] = [];
  for (let s = 0; s < params.storeys; s++) {
    const floorY = storeyLevels[s];
    const sh = heights[s];
    for (let b = 0; b < bays; b++) {
      const kind = grid[s][b];
      if (kind === "blank") continue;
      const bayLeft = -width / 2 + b * bayWidth;
      const bayCenter = bayLeft + bayWidth / 2;
      const maxW = bayWidth - MIN_PIER;
      if (maxW < MIN_OPENING_WIDTH) continue; // degenerate bay — skip

      let x: number, y: number, w: number, h: number;
      if (kind === "window") {
        w = clamp(params.windowWidthRatio * bayWidth, MIN_OPENING_WIDTH, maxW);
        const maxH = sh - SILL_HEIGHT - WINDOW_HEAD_GAP;
        if (maxH < MIN_WINDOW_HEIGHT) continue;
        h = clamp(params.windowHeightRatio * sh, MIN_WINDOW_HEIGHT, maxH);
        x = bayCenter - w / 2;
        y = floorY + SILL_HEIGHT;
      } else if (kind === "door") {
        const raised = s === 0 && params.groundFloor.stoop &&
          params.groundFloor.treatment === "residential";
        const yOff = raised ? stoopRise : 0;
        w = Math.min(DOOR_WIDTH, maxW);
        h = Math.min(DOOR_HEIGHT_MAX, sh - DOOR_HEAD_GAP - yOff);
        if (h < 1.6) continue;
        x = bayCenter - w / 2;
        y = floorY + yOff;
      } else if (kind === "garage") {
        w = Math.min(GARAGE_WIDTH_MAX, maxW);
        h = Math.min(GARAGE_HEIGHT_MAX, sh - 0.4);
        if (h < 1.6) continue;
        x = bayCenter - w / 2;
        y = floorY;
      } else {
        // shopfront: fill the bay; MIN_PIER at party edges, slim mullion gap
        // against interior neighbors
        const left = b === 0 ? bayLeft + MIN_PIER : bayLeft + SHOPFRONT_MULLION;
        const right =
          b === bays - 1
            ? bayLeft + bayWidth - MIN_PIER
            : bayLeft + bayWidth - SHOPFRONT_MULLION;
        w = right - left;
        if (w < MIN_OPENING_WIDTH) continue;
        h = sh - SHOPFRONT_FASCIA;
        if (h < 1.8) continue;
        x = left;
        y = floorY;
      }
      openings.push({ kind, storey: s, bay: b, x, y, w, h });
    }
  }

  // ── Ornament ──
  const cornice = params.ornament.cornice
    ? { y: wallTop, height: CORNICE_HEIGHT, projection: CORNICE_PROJECTION }
    : null;
  const parapet = params.ornament.parapet
    ? { y: wallTop + (cornice ? cornice.height : 0), height: PARAPET_HEIGHT }
    : null;
  const totalHeight =
    wallTop + (cornice ? cornice.height : 0) + (parapet ? parapet.height : 0);

  const windows = openings.filter((o) => o.kind === "window");
  const sills = params.ornament.sills
    ? windows.map((o) => ({ x: o.x - 0.06, y: o.y - 0.07, w: o.w + 0.12 }))
    : [];
  const surrounds = params.ornament.surrounds ? [...windows] : [];

  const door = openings.find((o) => o.kind === "door" && o.storey === 0);
  const stoop =
    door &&
    params.groundFloor.stoop &&
    params.groundFloor.treatment === "residential"
      ? {
          x: door.x - 0.2,
          w: door.w + 0.4,
          steps: STOOP_STEPS,
          rise: STOOP_RISE,
          run: STOOP_RUN,
        }
      : null;

  return {
    width,
    wallTop,
    totalHeight,
    storeyLevels,
    grid,
    openings,
    cornice,
    parapet,
    sills,
    surrounds,
    stoop,
  };
}
```

Also add `OpeningKind` to the existing type import at the top of the file if not already there (it is, from Task 2).

- [ ] **Step 4: Run all layout tests**

Run: `npx vitest run src/lib/facade/layout.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/facade/layout.ts src/lib/facade/layout.test.ts
git commit -m "feat(facade): pure layout engine — opening rects, ornament, clamps"
```

---

### Task 4: FacadeMesh — layout → Three.js geometry

**Files:**
- Create: `src/components/facade/FacadeMesh.tsx`

No unit tests (R3F rendering is verified visually in Task 5's checkpoint). Verification here = typecheck + lint.

**Interfaces:**
- Consumes: `computeLayout`, `FacadeLayout`, `OpeningRect`, `WALL_THICKNESS`, `STOOP_*` constants (Task 3); `FacadeParams` (Task 1).
- Produces: `default FacadeMesh({ params }: { params: FacadeParams })` — a `<group>` containing the whole facade. Task 5's viewer mounts it. Also exports nothing else; all sub-pieces are private.

- [ ] **Step 1: Create `src/components/facade/FacadeMesh.tsx`**

```tsx
"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  computeLayout,
  WALL_THICKNESS,
  SHOPFRONT_FASCIA,
  type FacadeLayout,
  type OpeningRect,
} from "@/lib/facade/layout";
import type { FacadeParams } from "@/lib/facade/types";

const FRAME_T = 0.07; // window frame member thickness
const FRAME_D = 0.06; // frame depth
const GLASS_RECESS = 0.15; // how far frames/glass sit behind the wall face

/** Wall body: outer rect with punched opening holes, extruded to thickness.
 * ExtrudeGeometry runs +z from the shape plane, so we shift it back so the
 * front face lands at z=0 (the facade plane). */
function buildWallGeometry(layout: FacadeLayout): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-layout.width / 2, 0);
  shape.lineTo(layout.width / 2, 0);
  shape.lineTo(layout.width / 2, layout.wallTop);
  shape.lineTo(-layout.width / 2, layout.wallTop);
  shape.closePath();
  for (const o of layout.openings) {
    const hole = new THREE.Path();
    hole.moveTo(o.x, o.y);
    hole.lineTo(o.x + o.w, o.y);
    hole.lineTo(o.x + o.w, o.y + o.h);
    hole.lineTo(o.x, o.y + o.h);
    hole.closePath();
    shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: WALL_THICKNESS,
    bevelEnabled: false,
  });
  geo.translate(0, 0, -WALL_THICKNESS);
  return geo;
}

/** Shared glass material treatment — mirrors the "homemaker:window" handling
 * in GLTFBuildingScene (high envMapIntensity, transparent, no depth write). */
function Glass({ w, h }: { w: number; h: number }) {
  return (
    <mesh position={[0, 0, -0.02]}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial
        color="#8fa9bd"
        roughness={0.08}
        metalness={0.6}
        envMapIntensity={3.0}
        transparent
        opacity={0.9}
        depthWrite={false}
      />
    </mesh>
  );
}

function Trim({ color }: { color: string }) {
  return <meshStandardMaterial color={color} roughness={0.6} />;
}

function WindowFill({ o, trimColor }: { o: OpeningRect; trimColor: string }) {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  return (
    <group position={[cx, cy, -GLASS_RECESS]}>
      <Glass w={o.w} h={o.h} />
      {/* frame: top / bottom / left / right */}
      <mesh position={[0, o.h / 2 - FRAME_T / 2, 0]}>
        <boxGeometry args={[o.w, FRAME_T, FRAME_D]} />
        <Trim color={trimColor} />
      </mesh>
      <mesh position={[0, -o.h / 2 + FRAME_T / 2, 0]}>
        <boxGeometry args={[o.w, FRAME_T, FRAME_D]} />
        <Trim color={trimColor} />
      </mesh>
      <mesh position={[-o.w / 2 + FRAME_T / 2, 0, 0]}>
        <boxGeometry args={[FRAME_T, o.h, FRAME_D]} />
        <Trim color={trimColor} />
      </mesh>
      <mesh position={[o.w / 2 - FRAME_T / 2, 0, 0]}>
        <boxGeometry args={[FRAME_T, o.h, FRAME_D]} />
        <Trim color={trimColor} />
      </mesh>
      {/* central mullion + transom bar (sash feel) */}
      <mesh>
        <boxGeometry args={[0.05, o.h, FRAME_D]} />
        <Trim color={trimColor} />
      </mesh>
      <mesh position={[0, o.h * 0.12, 0]}>
        <boxGeometry args={[o.w, 0.05, FRAME_D]} />
        <Trim color={trimColor} />
      </mesh>
    </group>
  );
}

function DoorFill({ o, doorColor }: { o: OpeningRect; doorColor: string }) {
  return (
    <group position={[o.x + o.w / 2, o.y + o.h / 2, -0.18]}>
      <mesh castShadow>
        <boxGeometry args={[o.w, o.h, 0.07]} />
        <meshStandardMaterial color={doorColor} roughness={0.5} />
      </mesh>
      {/* two raised panel hints */}
      <mesh position={[0, o.h * 0.22, 0.045]}>
        <boxGeometry args={[o.w * 0.62, o.h * 0.3, 0.015]} />
        <meshStandardMaterial color={doorColor} roughness={0.4} />
      </mesh>
      <mesh position={[0, -o.h * 0.22, 0.045]}>
        <boxGeometry args={[o.w * 0.62, o.h * 0.3, 0.015]} />
        <meshStandardMaterial color={doorColor} roughness={0.4} />
      </mesh>
      {/* knob */}
      <mesh position={[o.w * 0.32, 0, 0.06]}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshStandardMaterial color="#b8a878" roughness={0.25} metalness={0.8} />
      </mesh>
    </group>
  );
}

function ShopfrontFill({ o, trimColor }: { o: OpeningRect; trimColor: string }) {
  return (
    <group position={[o.x + o.w / 2, o.y + o.h / 2, -0.1]}>
      <Glass w={o.w} h={o.h} />
      {/* stallriser: solid base band */}
      <mesh position={[0, -o.h / 2 + 0.25, 0]}>
        <boxGeometry args={[o.w, 0.5, 0.08]} />
        <Trim color={trimColor} />
      </mesh>
      {/* transom bar at door height when the glazing is tall enough */}
      {o.h > 2.4 && (
        <mesh position={[0, -o.h / 2 + 2.1, 0]}>
          <boxGeometry args={[o.w, 0.08, 0.08]} />
          <Trim color={trimColor} />
        </mesh>
      )}
      {/* vertical mullions at thirds */}
      <mesh position={[-o.w / 6, 0, 0]}>
        <boxGeometry args={[0.06, o.h, 0.08]} />
        <Trim color={trimColor} />
      </mesh>
      <mesh position={[o.w / 6, 0, 0]}>
        <boxGeometry args={[0.06, o.h, 0.08]} />
        <Trim color={trimColor} />
      </mesh>
      {/* fascia band over the glazing, slightly proud of the wall face */}
      <mesh position={[0, o.h / 2 + SHOPFRONT_FASCIA / 2, 0.12]} castShadow>
        <boxGeometry args={[o.w + 0.2, SHOPFRONT_FASCIA - 0.1, 0.08]} />
        <Trim color={trimColor} />
      </mesh>
    </group>
  );
}

function GarageFill({ o, doorColor }: { o: OpeningRect; doorColor: string }) {
  const RIBS = 5;
  return (
    <group position={[o.x + o.w / 2, o.y + o.h / 2, -0.15]}>
      <mesh castShadow>
        <boxGeometry args={[o.w, o.h, 0.06]} />
        <meshStandardMaterial color={doorColor} roughness={0.55} metalness={0.15} />
      </mesh>
      {Array.from({ length: RIBS }, (_, i) => (
        <mesh
          key={i}
          position={[0, -o.h / 2 + ((i + 0.5) * o.h) / RIBS, 0.04]}
        >
          <boxGeometry args={[o.w - 0.1, 0.05, 0.02]} />
          <meshStandardMaterial color={doorColor} roughness={0.4} metalness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

/** Stepped classical cornice: three stacked boxes with growing projection. */
function Cornice({ layout, trimColor }: { layout: FacadeLayout; trimColor: string }) {
  if (!layout.cornice) return null;
  const { y, height, projection } = layout.cornice;
  const steps = [
    { h: height * 0.4, p: projection * 0.4 },
    { h: height * 0.35, p: projection * 0.7 },
    { h: height * 0.25, p: projection },
  ];
  let cursor = y;
  const boxes = steps.map((s) => {
    const box = { yCenter: cursor + s.h / 2, ...s };
    cursor += s.h;
    return box;
  });
  return (
    <>
      {boxes.map((b, i) => (
        <mesh
          key={i}
          position={[0, b.yCenter, (-WALL_THICKNESS + b.p) / 2]}
          castShadow
        >
          <boxGeometry args={[layout.width + b.p * 2, b.h, WALL_THICKNESS + b.p]} />
          <Trim color={trimColor} />
        </mesh>
      ))}
    </>
  );
}

export default function FacadeMesh({ params }: { params: FacadeParams }) {
  const layout = useMemo(() => computeLayout(params), [params]);
  const wallGeo = useMemo(() => buildWallGeometry(layout), [layout]);
  // R3F does NOT auto-dispose geometry passed via the `geometry` prop —
  // without this, every slider tick leaks a GPU buffer.
  useEffect(() => () => wallGeo.dispose(), [wallGeo]);

  return (
    <group>
      <mesh geometry={wallGeo} castShadow receiveShadow>
        <meshStandardMaterial color={params.wallColor} roughness={0.85} />
      </mesh>

      {layout.openings.map((o) => {
        const key = `${o.storey}-${o.bay}`;
        switch (o.kind) {
          case "window":
            return <WindowFill key={key} o={o} trimColor={params.trimColor} />;
          case "door":
            return <DoorFill key={key} o={o} doorColor={params.doorColor} />;
          case "shopfront":
            return <ShopfrontFill key={key} o={o} trimColor={params.trimColor} />;
          case "garage":
            return <GarageFill key={key} o={o} doorColor={params.doorColor} />;
        }
      })}

      {/* sills: proud boxes under windows */}
      {layout.sills.map((s, i) => (
        <mesh key={i} position={[s.x + s.w / 2, s.y + 0.04, 0]} castShadow>
          <boxGeometry args={[s.w, 0.08, 0.2]} />
          <Trim color={params.trimColor} />
        </mesh>
      ))}

      {/* surrounds: top + side trim around windows (sill covers the bottom) */}
      {layout.surrounds.map((o, i) => (
        <group key={i}>
          <mesh position={[o.x + o.w / 2, o.y + o.h + 0.07, 0]} castShadow>
            <boxGeometry args={[o.w + 0.28, 0.14, 0.1]} />
            <Trim color={params.trimColor} />
          </mesh>
          <mesh position={[o.x - 0.07, o.y + o.h / 2, 0]}>
            <boxGeometry args={[0.14, o.h, 0.1]} />
            <Trim color={params.trimColor} />
          </mesh>
          <mesh position={[o.x + o.w + 0.07, o.y + o.h / 2, 0]}>
            <boxGeometry args={[0.14, o.h, 0.1]} />
            <Trim color={params.trimColor} />
          </mesh>
        </group>
      ))}

      <Cornice layout={layout} trimColor={params.trimColor} />

      {/* parapet: wall-colored extension + thin trim coping */}
      {layout.parapet && (
        <group>
          <mesh
            position={[0, layout.parapet.y + layout.parapet.height / 2, -WALL_THICKNESS / 2]}
            castShadow
          >
            <boxGeometry args={[layout.width, layout.parapet.height, WALL_THICKNESS]} />
            <meshStandardMaterial color={params.wallColor} roughness={0.85} />
          </mesh>
          <mesh
            position={[0, layout.parapet.y + layout.parapet.height + 0.04, -WALL_THICKNESS / 2]}
            castShadow
          >
            <boxGeometry args={[layout.width + 0.1, 0.08, WALL_THICKNESS + 0.1]} />
            <Trim color={params.trimColor} />
          </mesh>
        </group>
      )}

      {/* stoop: stacked overlapping blocks reading as steps */}
      {layout.stoop &&
        Array.from({ length: layout.stoop.steps }, (_, i) => {
          const st = layout.stoop!;
          const h = st.rise * (i + 1);
          const d = st.run * (st.steps - i);
          return (
            <mesh
              key={i}
              position={[st.x + st.w / 2, h / 2, d / 2]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[st.w, h, d]} />
              <meshStandardMaterial color="#9a938a" roughness={0.9} />
            </mesh>
          );
        })}
    </group>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Note: `<Trim color={...} />` renders a `meshStandardMaterial` — a component returning a material is valid R3F (the material attaches to the parent mesh). If the linter objects to the switch without a default case, add `default: return null;`.

- [ ] **Step 3: Commit**

```bash
git add src/components/facade/FacadeMesh.tsx
git commit -m "feat(facade): FacadeMesh — wall, opening fills, ornament, stoop"
```

---

### Task 5: FacadeViewer + /facade page shell (visual checkpoint)

**Files:**
- Create: `src/components/facade/FacadeViewer.tsx`
- Create: `src/app/facade/page.tsx` (shell version — controls arrive in Task 6, prompt in Task 8)

**Interfaces:**
- Consumes: `FacadeMesh` (Task 4); `FacadeParams`, `LotContext`, `DEFAULT_FACADE`, `DEFAULT_LOT_CONTEXT` (Task 1); `computeLayout` (Task 3); `ViewSettings`, `DEFAULT_VIEW` from `@/lib/building/types` (existing).
- Produces: `default FacadeViewer({ params, context, view }: { params: FacadeParams; context: LotContext; view?: ViewSettings })` — Task 6/8 keep mounting it unchanged. The page's `useState` hooks (`params`, `setParams`, `context`, `setContext`, `view`, `setView`) are what Task 6 wires controls into.

- [ ] **Step 1: Create `src/components/facade/FacadeViewer.tsx`**

The sun-position function and fading-ground hook are copied verbatim from `src/components/demo/BuildingViewer.tsx` (they're 15-line pure helpers; copying keeps the main page untouched per the spec).

```tsx
"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, Grid } from "@react-three/drei";
import * as THREE from "three";
import FacadeMesh from "./FacadeMesh";
import type { FacadeParams, LotContext } from "@/lib/facade/types";
import type { ViewSettings } from "@/lib/building/types";
import { DEFAULT_VIEW } from "@/lib/building/types";

interface FacadeViewerProps {
  params: FacadeParams;
  context: LotContext;
  view?: ViewSettings;
}

/** Copied from BuildingViewer — sun azimuth/altitude → directional light pos. */
function sunPositionFromAngles(
  azimuthDeg: number,
  altitudeDeg: number,
): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  const r = 30;
  const x = r * Math.cos(alt) * Math.sin(az);
  const y = r * Math.sin(alt);
  const z = r * Math.cos(alt) * Math.cos(az);
  return [x, y, z];
}

/** Copied from BuildingViewer — radially fading ground plane. */
function useGroundGeometry() {
  return useMemo(() => {
    const geo = new THREE.PlaneGeometry(200, 200, 96, 96);
    const base = new THREE.Color("#a59e95");
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 4);
    const SOLID_HALF = 15;
    const FADE_END = 70;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const d = Math.max(Math.abs(x), Math.abs(y));
      let alpha: number;
      if (d <= SOLID_HALF) {
        alpha = 1;
      } else if (d >= FADE_END) {
        alpha = 0;
      } else {
        const t = (d - SOLID_HALF) / (FADE_END - SOLID_HALF);
        alpha = 1 - t * t * (3 - 2 * t);
      }
      colors[i * 4] = base.r;
      colors[i * 4 + 1] = base.g;
      colors[i * 4 + 2] = base.b;
      colors[i * 4 + 3] = alpha;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    return geo;
  }, []);
}

/** Grey party-wall neighbor volumes flanking the lot. */
function NeighborMasses({
  context,
  facadeWidth,
}: {
  context: LotContext;
  facadeWidth: number;
}) {
  if (!context.show) return null;
  const W = 8; // neighbor visible width
  const D = 9; // neighbor depth behind the street line
  return (
    <>
      <mesh
        position={[-facadeWidth / 2 - W / 2, context.leftNeighborHeight / 2, -D / 2 + 0.2]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[W, context.leftNeighborHeight, D]} />
        <meshStandardMaterial color="#6f6b64" roughness={0.95} />
      </mesh>
      <mesh
        position={[facadeWidth / 2 + W / 2, context.rightNeighborHeight / 2, -D / 2 + 0.2]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[W, context.rightNeighborHeight, D]} />
        <meshStandardMaterial color="#67635c" roughness={0.95} />
      </mesh>
    </>
  );
}

/** Exposes a capture function that renders a fresh frame then downloads a
 * PNG. Rendering immediately before toDataURL avoids needing
 * preserveDrawingBuffer (which costs performance every frame). */
function CaptureBridge({ bind }: { bind: (fn: () => void) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    bind(() => {
      gl.render(scene, camera);
      const url = gl.domElement.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "facade.png";
      a.click();
    });
  }, [gl, scene, camera, bind]);
  return null;
}

function SceneContents({
  params,
  context,
  view,
}: {
  params: FacadeParams;
  context: LotContext;
  view: ViewSettings;
}) {
  const groundGeo = useGroundGeometry();
  const sunPos = useMemo(
    () => sunPositionFromAngles(view.sunAzimuth, view.sunAltitude),
    [view.sunAzimuth, view.sunAltitude],
  );
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight
        position={sunPos}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={80}
        shadow-camera-near={0.1}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-bias={-0.0005}
      />
      <directionalLight position={[-8, 10, -6]} intensity={0.25} />
      <pointLight position={[0, 30, 0]} intensity={0.3} />

      <Environment
        files="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/furstenstein_1k.hdr"
        background={false}
      />

      <FacadeMesh params={params} />
      <NeighborMasses context={context} facadeWidth={params.width} />

      {/* Ground plane — polygonOffset pushes it back so the sidewalk, road
       * strip, and grid lines all win the depth test (same trick as the
       * main viewer). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow geometry={groundGeo}>
        <meshStandardMaterial
          vertexColors
          transparent
          roughness={0.95}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      {/* Sidewalk strip in front of the facade (z 0 → 2.5) */}
      <mesh position={[0, 0, 1.25]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 2.5]} />
        <meshStandardMaterial color="#8f8a80" roughness={0.9} />
      </mesh>
      {/* Road beyond the sidewalk (z 2.5 → 9) */}
      <mesh position={[0, 0, 5.75]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 6.5]} />
        <meshStandardMaterial color="#57544f" roughness={0.95} />
      </mesh>

      <Grid
        position={[0, 0, 0]}
        args={[60, 60]}
        cellSize={1}
        cellThickness={0.7}
        cellColor="#1f1d1b"
        sectionSize={5}
        sectionThickness={1.4}
        sectionColor="#0d0c0b"
        fadeDistance={70}
        fadeStrength={1.2}
        infiniteGrid
      />

      <ContactShadows
        position={[0, 0.005, 0]}
        opacity={0.45}
        scale={50}
        blur={2.5}
        far={20}
        resolution={1024}
      />

      {/* Orbit constrained to the front hemisphere — nothing exists behind
       * the facade. Azimuth 0 = camera on +z looking at the wall face. */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={[0, 4, 0]}
        minDistance={3}
        maxDistance={60}
        minAzimuthAngle={-Math.PI * 0.44}
        maxAzimuthAngle={Math.PI * 0.44}
        maxPolarAngle={Math.PI / 2.05}
        enablePan
        panSpeed={0.8}
        rotateSpeed={0.5}
        zoomSpeed={1.0}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </>
  );
}

export default function FacadeViewer({
  params,
  context,
  view = DEFAULT_VIEW,
}: FacadeViewerProps) {
  const captureRef = useRef<(() => void) | null>(null);
  const bindCapture = useCallback((fn: () => void) => {
    captureRef.current = fn;
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background:
          "linear-gradient(to bottom, #8ea4b8 0%, #a8b0b3 55%, #b8ad9c 100%)",
      }}
    >
      <Canvas
        shadows
        camera={{ position: [6, 5, 14], fov: 40, near: 0.1, far: 200 }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <SceneContents params={params} context={context} view={view} />
        </Suspense>
        <CaptureBridge bind={bindCapture} />
      </Canvas>

      <button
        type="button"
        onClick={() => captureRef.current?.()}
        className="absolute top-3 right-3 rounded-lg bg-black/55 backdrop-blur-md px-3 py-1.5 text-[11px] text-white/85 hover:bg-black/70 transition-colors"
      >
        Save image
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create the page shell** — `src/app/facade/page.tsx`

Controls panel is a placeholder in this task; Task 6 replaces the placeholder `<div>` with `<FacadeControls …/>` + `<BayGrid …/>`, Task 8 adds the prompt.

```tsx
"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { FacadeParams, LotContext } from "@/lib/facade/types";
import { DEFAULT_FACADE, DEFAULT_LOT_CONTEXT } from "@/lib/facade/types";
import { computeLayout } from "@/lib/facade/layout";
import type { ViewSettings } from "@/lib/building/types";
import { DEFAULT_VIEW } from "@/lib/building/types";

const FacadeViewer = dynamic(() => import("@/components/facade/FacadeViewer"), {
  ssr: false,
});

export default function FacadePage() {
  // Everything is live — no draft/committed split. Client-side geometry
  // rebuilds are trivially fast, so every slider tick renders immediately.
  const [params, setParams] = useState<FacadeParams>(DEFAULT_FACADE);
  const [context, setContext] = useState<LotContext>(DEFAULT_LOT_CONTEXT);
  const [view, setView] = useState<ViewSettings>(DEFAULT_VIEW);

  const layout = useMemo(() => computeLayout(params), [params]);

  return (
    <div className="h-screen flex flex-col bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex items-center justify-between px-4 h-12 border-b border-[var(--border)] bg-[var(--panel-bg)] shrink-0">
        <div className="flex items-center gap-2">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="4" y="3" width="16" height="18" />
            <line x1="4" y1="9" x2="20" y2="9" />
            <line x1="4" y1="15" x2="20" y2="15" />
          </svg>
          <span className="font-semibold text-sm tracking-tight">Facademaker</span>
          <a
            href="/"
            className="text-[11px] text-[var(--muted)] ml-1 hover:text-[var(--foreground)] transition-colors"
          >
            ← building editor
          </a>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--muted)] font-mono">
          <span>{params.storeys}F</span>
          <span>·</span>
          <span>{params.bays} bays</span>
          <span>·</span>
          <span>{params.width.toFixed(1)}m</span>
          <span>·</span>
          <span>{layout.totalHeight.toFixed(1)}m ↑</span>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <div className="flex-1 min-h-[40vh] md:min-h-0 relative">
          <FacadeViewer params={params} context={context} view={view} />
        </div>

        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--panel-bg)] overflow-y-auto">
          <div className="p-4 space-y-5">
            {/* Task 6 replaces this placeholder with FacadeControls */}
            <div className="text-[11px] text-[var(--muted)]">
              Controls coming in Task 6.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

Note: `setContext` and `setView` are intentionally unused until Task 6 — if ESLint flags them, prefix a disable comment for this task only and remove it in Task 6:
`// eslint-disable-next-line @typescript-eslint/no-unused-vars`

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: VISUAL CHECKPOINT — run the dev server and inspect /facade**

Run: `npm run dev` and open `http://localhost:3000/facade`.

Verify:
1. A 3-storey, 3-bay facade with a door (bottom-left bay), stoop steps, windows with sills, and a cornice.
2. Grey neighbor masses flank both sides; sidewalk + road strips in front.
3. Orbit cannot swing behind the wall (azimuth stops ~±80°) nor below ground.
4. "Save image" downloads a non-blank `facade.png`.
5. No console errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/facade/FacadeViewer.tsx src/app/facade/page.tsx
git commit -m "feat(facade): viewer with constrained orbit, context masses, /facade page shell"
```

---

### Task 6: FacadeControls + BayGrid, wired into the page

**Files:**
- Create: `src/components/facade/BayGrid.tsx`
- Create: `src/components/facade/FacadeControls.tsx`
- Modify: `src/app/facade/page.tsx` (replace the placeholder panel)

**Interfaces:**
- Consumes: `resolveGrid` (Task 2); `FacadeParams`, `OpeningKind`, `FACADE_PRESETS`, `FACADE_LIMITS`, `DOOR_SWATCHES`, `PresetId`, `LotContext` (Task 1); `WALL_SWATCHES`, `classicalStoreyHeights`, `ViewSettings` from `@/lib/building/types` (existing).
- Produces:
  - `default BayGrid({ params, onChange }: { params: FacadeParams; onChange: (p: FacadeParams) => void })`
  - `default FacadeControls({ params, onChange, context, onContextChange, view, onViewChange })` — types below. Task 8 leaves this untouched.

- [ ] **Step 1: Create `src/components/facade/BayGrid.tsx`**

Tapping a cell cycles its kind: window → blank → door → shopfront → garage → window. If the cycled value equals the cell's treatment-derived default, the override is *removed* (keeps `cellOverrides` sparse).

```tsx
"use client";

import type { FacadeParams, OpeningKind } from "@/lib/facade/types";
import { resolveGrid } from "@/lib/facade/layout";

const CYCLE: OpeningKind[] = ["window", "blank", "door", "shopfront", "garage"];
const GLYPH: Record<OpeningKind, string> = {
  window: "▢",
  blank: "·",
  door: "▯",
  shopfront: "▭",
  garage: "▤",
};

interface BayGridProps {
  params: FacadeParams;
  onChange: (p: FacadeParams) => void;
}

export default function BayGrid({ params, onChange }: BayGridProps) {
  const grid = resolveGrid(params);
  const defaults = resolveGrid({ ...params, cellOverrides: [] });

  const cycleCell = (storey: number, bay: number) => {
    const current = grid[storey][bay];
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    const rest = (params.cellOverrides ?? []).filter(
      (o) => !(o.storey === storey && o.bay === bay),
    );
    const cellOverrides =
      next === defaults[storey][bay]
        ? rest
        : [...rest, { storey, bay, kind: next }];
    onChange({ ...params, cellOverrides });
  };

  // Top storey renders first so the grid mirrors the facade.
  return (
    <div className="space-y-1">
      {[...grid].reverse().map((row, ri) => {
        const storey = grid.length - 1 - ri;
        return (
          <div key={storey} className="flex gap-1">
            {row.map((kind, bay) => {
              const overridden = (params.cellOverrides ?? []).some(
                (o) => o.storey === storey && o.bay === bay,
              );
              return (
                <button
                  key={bay}
                  type="button"
                  onClick={() => cycleCell(storey, bay)}
                  title={`Storey ${storey + 1}, bay ${bay + 1}: ${kind}`}
                  className={`flex-1 aspect-square rounded text-sm grid place-items-center transition-colors ${
                    overridden
                      ? "bg-[var(--accent)]/30 text-[var(--foreground)]"
                      : "bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {GLYPH[kind]}
                </button>
              );
            })}
          </div>
        );
      })}
      <div className="text-[9px] text-[var(--muted)]">
        tap to cycle: ▢ window · blank ▯ door ▭ shopfront ▤ garage
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/facade/FacadeControls.tsx`**

```tsx
"use client";

import type {
  FacadeParams,
  LotContext,
  PresetId,
  GroundTreatment,
} from "@/lib/facade/types";
import {
  DEFAULT_FACADE,
  FACADE_PRESETS,
  FACADE_LIMITS,
  DOOR_SWATCHES,
} from "@/lib/facade/types";
import type { ViewSettings } from "@/lib/building/types";
import { WALL_SWATCHES, classicalStoreyHeights } from "@/lib/building/types";
import BayGrid from "./BayGrid";

interface FacadeControlsProps {
  params: FacadeParams;
  onChange: (p: FacadeParams) => void;
  context: LotContext;
  onContextChange: (c: LotContext) => void;
  view: ViewSettings;
  onViewChange: (v: ViewSettings) => void;
}

function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-[var(--muted)]">{label}</span>
        <span className="text-[11px] font-mono text-[var(--foreground)]">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 rounded-full appearance-none bg-[var(--border)] cursor-pointer accent-[var(--accent)]"
      />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details open className="group">
      <summary className="cursor-pointer list-none flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
          {title}
        </span>
        <span className="text-[var(--muted)] text-[10px] group-open:rotate-90 transition-transform">
          ▸
        </span>
      </summary>
      <div className="space-y-2">{children}</div>
    </details>
  );
}

function Toggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1.5 rounded text-[11px] transition-colors ${
        on
          ? "bg-[var(--accent)] text-white"
          : "bg-[var(--border)] text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}

function Swatches({
  label,
  swatches,
  value,
  onPick,
}: {
  label: string;
  swatches: { id: string; label: string; hex: string }[];
  value: string;
  onPick: (hex: string) => void;
}) {
  return (
    <div>
      <span className="text-[10px] text-[var(--muted)] block mb-1">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {swatches.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.label}
            onClick={() => onPick(s.hex)}
            className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
              value.toLowerCase() === s.hex.toLowerCase()
                ? "border-[var(--accent)]"
                : "border-transparent"
            }`}
            style={{ backgroundColor: s.hex }}
          />
        ))}
      </div>
    </div>
  );
}

const TREATMENTS: { id: GroundTreatment; label: string }[] = [
  { id: "residential", label: "Residential" },
  { id: "shopfront", label: "Shopfront" },
  { id: "garage", label: "Garage" },
];

export default function FacadeControls({
  params,
  onChange,
  context,
  onContextChange,
  view,
  onViewChange,
}: FacadeControlsProps) {
  const update = (u: Partial<FacadeParams>) => onChange({ ...params, ...u });
  const L = FACADE_LIMITS;

  const applyPreset = (id: PresetId) => {
    onChange({
      ...DEFAULT_FACADE,
      ...FACADE_PRESETS[id].params,
      cellOverrides: [],
      preset: id,
    });
  };

  return (
    <div className="space-y-5">
      {/* Presets */}
      <div className="grid grid-cols-3 gap-1">
        {(Object.keys(FACADE_PRESETS) as PresetId[]).map((id) => (
          <Toggle
            key={id}
            label={FACADE_PRESETS[id].label}
            on={params.preset === id}
            onClick={() => applyPreset(id)}
          />
        ))}
      </div>

      <Section title="Proportions">
        <SliderRow
          label="Width"
          value={params.width}
          display={`${params.width.toFixed(1)}m`}
          min={L.width.min}
          max={L.width.max}
          step={0.5}
          onChange={(width) => update({ width, preset: undefined })}
        />
        <SliderRow
          label="Storeys"
          value={params.storeys}
          display={`${params.storeys}`}
          min={L.storeys.min}
          max={L.storeys.max}
          step={1}
          onChange={(n) =>
            update({
              storeys: n,
              storeyHeights: classicalStoreyHeights(n, params.storeyHeight),
              preset: undefined,
            })
          }
        />
        <SliderRow
          label="Storey height"
          value={params.storeyHeight}
          display={`${params.storeyHeight.toFixed(1)}m`}
          min={L.storeyHeight.min}
          max={L.storeyHeight.max}
          step={0.1}
          onChange={(h) =>
            update({
              storeyHeight: h,
              storeyHeights: classicalStoreyHeights(params.storeys, h),
              preset: undefined,
            })
          }
        />
      </Section>

      <Section title="Bays & Openings">
        <SliderRow
          label="Bays"
          value={params.bays}
          display={`${params.bays}`}
          min={L.bays.min}
          max={L.bays.max}
          step={1}
          onChange={(bays) => update({ bays, preset: undefined })}
        />
        <SliderRow
          label="Window width"
          value={params.windowWidthRatio}
          display={`${Math.round(params.windowWidthRatio * 100)}%`}
          min={L.windowWidthRatio.min}
          max={L.windowWidthRatio.max}
          step={0.05}
          onChange={(r) => update({ windowWidthRatio: r, preset: undefined })}
        />
        <SliderRow
          label="Window height"
          value={params.windowHeightRatio}
          display={`${Math.round(params.windowHeightRatio * 100)}%`}
          min={L.windowHeightRatio.min}
          max={L.windowHeightRatio.max}
          step={0.05}
          onChange={(r) => update({ windowHeightRatio: r, preset: undefined })}
        />
        <BayGrid params={params} onChange={onChange} />
      </Section>

      <Section title="Ground Floor">
        <div className="grid grid-cols-3 gap-1">
          {TREATMENTS.map((t) => (
            <Toggle
              key={t.id}
              label={t.label}
              on={params.groundFloor.treatment === t.id}
              onClick={() =>
                update({
                  groundFloor: { ...params.groundFloor, treatment: t.id },
                  preset: undefined,
                })
              }
            />
          ))}
        </div>
        <SliderRow
          label="Door bay"
          value={Math.min(params.groundFloor.doorBay, params.bays - 1)}
          display={`${Math.min(params.groundFloor.doorBay, params.bays - 1) + 1}`}
          min={0}
          max={params.bays - 1}
          step={1}
          onChange={(b) =>
            update({
              groundFloor: { ...params.groundFloor, doorBay: b },
              preset: undefined,
            })
          }
        />
        <Toggle
          label={params.groundFloor.stoop ? "Stoop: on" : "Stoop: off"}
          on={params.groundFloor.stoop}
          onClick={() =>
            update({
              groundFloor: {
                ...params.groundFloor,
                stoop: !params.groundFloor.stoop,
              },
              preset: undefined,
            })
          }
        />
      </Section>

      <Section title="Ornament & Materials">
        <div className="grid grid-cols-2 gap-1">
          {(["cornice", "parapet", "sills", "surrounds"] as const).map((k) => (
            <Toggle
              key={k}
              label={k}
              on={params.ornament[k]}
              onClick={() =>
                update({
                  ornament: { ...params.ornament, [k]: !params.ornament[k] },
                  preset: undefined,
                })
              }
            />
          ))}
        </div>
        <Swatches
          label="Wall"
          swatches={WALL_SWATCHES}
          value={params.wallColor}
          onPick={(hex) => update({ wallColor: hex })}
        />
        <Swatches
          label="Trim"
          swatches={WALL_SWATCHES}
          value={params.trimColor}
          onPick={(hex) => update({ trimColor: hex })}
        />
        <Swatches
          label="Door"
          swatches={DOOR_SWATCHES}
          value={params.doorColor}
          onPick={(hex) => update({ doorColor: hex })}
        />
      </Section>

      <Section title="Context & Sun">
        <Toggle
          label={context.show ? "Neighbors: shown" : "Neighbors: hidden"}
          on={context.show}
          onClick={() => onContextChange({ ...context, show: !context.show })}
        />
        <SliderRow
          label="Left neighbor"
          value={context.leftNeighborHeight}
          display={`${context.leftNeighborHeight.toFixed(0)}m`}
          min={L.neighborHeight.min}
          max={L.neighborHeight.max}
          step={1}
          onChange={(leftNeighborHeight) =>
            onContextChange({ ...context, leftNeighborHeight })
          }
        />
        <SliderRow
          label="Right neighbor"
          value={context.rightNeighborHeight}
          display={`${context.rightNeighborHeight.toFixed(0)}m`}
          min={L.neighborHeight.min}
          max={L.neighborHeight.max}
          step={1}
          onChange={(rightNeighborHeight) =>
            onContextChange({ ...context, rightNeighborHeight })
          }
        />
        <SliderRow
          label="Sun azimuth"
          value={view.sunAzimuth}
          display={`${Math.round(view.sunAzimuth)}°`}
          min={0}
          max={360}
          step={1}
          onChange={(sunAzimuth) => onViewChange({ ...view, sunAzimuth })}
        />
        <SliderRow
          label="Sun altitude"
          value={view.sunAltitude}
          display={`${Math.round(view.sunAltitude)}°`}
          min={5}
          max={85}
          step={1}
          onChange={(sunAltitude) => onViewChange({ ...view, sunAltitude })}
        />
      </Section>
    </div>
  );
}
```

Note: every structural edit clears `preset: undefined` so a preset chip only shows "active" while the params still match it. Color picks keep the preset (cosmetic).

- [ ] **Step 3: Wire into the page**

In `src/app/facade/page.tsx`, add the import and replace the Task-5 placeholder `<div>` inside the panel:

```tsx
import FacadeControls from "@/components/facade/FacadeControls";
```

```tsx
<FacadeControls
  params={params}
  onChange={setParams}
  context={context}
  onContextChange={setContext}
  view={view}
  onViewChange={setView}
/>
```

Remove any eslint-disable comment added in Task 5 (all setters are used now).

- [ ] **Step 4: Typecheck, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 5: VISUAL CHECKPOINT**

Run: `npm run dev`, open `http://localhost:3000/facade`. Verify:
1. Every slider updates the facade **live** (no Update button anywhere).
2. Preset chips restyle everything; tweaking a slider afterwards un-highlights the chip.
3. BayGrid mirrors the facade (ground row bottom); tapping a cell cycles kinds and the 3D updates; overridden cells get the accent tint; cycling back to the default clears the tint.
4. Treatment buttons change the ground row; door-bay slider moves the door; stoop toggles steps.
5. Ornament toggles add/remove cornice/parapet/sills/surrounds; swatches recolor wall/trim/door.
6. Neighbor sliders resize the grey masses; sun sliders move shadows.

- [ ] **Step 6: Commit**

```bash
git add src/components/facade/BayGrid.tsx src/components/facade/FacadeControls.tsx src/app/facade/page.tsx
git commit -m "feat(facade): live controls panel — presets, sliders, bay grid editor"
```

---

### Task 7: Local facade prompt parser

**Files:**
- Create: `src/lib/facade/prompt-parser.ts`
- Create: `src/lib/facade/prompt-parser.test.ts`

**Interfaces:**
- Consumes: `FacadeParams`, `GroundFloorConfig`, `OrnamentConfig`, `PresetId`, `FACADE_PRESETS`, `DOOR_SWATCHES`, `FACADE_LIMITS` (Task 1); `WALL_SWATCHES`, `classicalStoreyHeights` from `@/lib/building/types`.
- Produces (Task 8's page wiring consumes both):
  - `type FacadePromptUpdates` — `Partial<FacadeParams>` with *partial* nested `groundFloor`/`ornament`.
  - `parseFacadePromptLocal(prompt: string): FacadePromptUpdates`
  - `mergeFacadeParams(base: FacadeParams, updates: FacadePromptUpdates): FacadeParams`

- [ ] **Step 1: Write the failing tests** — `src/lib/facade/prompt-parser.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseFacadePromptLocal, mergeFacadeParams } from "./prompt-parser";
import { DEFAULT_FACADE } from "./types";

describe("parseFacadePromptLocal", () => {
  it("parses storeys and bays", () => {
    const u = parseFacadePromptLocal("4 storeys with 5 bays");
    expect(u.storeys).toBe(4);
    expect(u.bays).toBe(5);
  });

  it("clamps storeys and bays to limits", () => {
    const u = parseFacadePromptLocal("12 storeys, 15 bays");
    expect(u.storeys).toBe(6);
    expect(u.bays).toBe(9);
  });

  it("parses width", () => {
    expect(parseFacadePromptLocal("9m wide").width).toBe(9);
  });

  it("recognizes presets by name", () => {
    expect(parseFacadePromptLocal("a georgian terrace").preset).toBe("georgian");
    expect(parseFacadePromptLocal("victorian shopfront").preset).toBe(
      "victorian-shopfront",
    );
    expect(parseFacadePromptLocal("modern minimal").preset).toBe("modern");
  });

  it("parses ground-floor treatment keywords", () => {
    expect(parseFacadePromptLocal("with a shopfront").groundFloor?.treatment).toBe(
      "shopfront",
    );
    expect(parseFacadePromptLocal("garage door").groundFloor?.treatment).toBe(
      "garage",
    );
    expect(parseFacadePromptLocal("with a stoop").groundFloor?.stoop).toBe(true);
  });

  it("parses ornament keywords", () => {
    expect(parseFacadePromptLocal("add a cornice").ornament?.cornice).toBe(true);
    expect(parseFacadePromptLocal("with a parapet").ornament?.parapet).toBe(true);
  });

  it("parses wall and door colors", () => {
    expect(parseFacadePromptLocal("white walls").wallColor).toBe("#ece8e0");
    expect(parseFacadePromptLocal("navy door").doorColor).toBe("#2e3a4d");
  });

  it("returns empty updates for unrelated text", () => {
    expect(parseFacadePromptLocal("hello there")).toEqual({});
  });
});

describe("mergeFacadeParams", () => {
  it("deep-merges nested groundFloor and ornament", () => {
    const merged = mergeFacadeParams(DEFAULT_FACADE, {
      groundFloor: { treatment: "shopfront" },
      ornament: { parapet: true },
    });
    expect(merged.groundFloor.treatment).toBe("shopfront");
    expect(merged.groundFloor.doorBay).toBe(DEFAULT_FACADE.groundFloor.doorBay);
    expect(merged.ornament.parapet).toBe(true);
    expect(merged.ornament.cornice).toBe(DEFAULT_FACADE.ornament.cornice);
  });

  it("recomputes storeyHeights when storeys change without explicit heights", () => {
    const merged = mergeFacadeParams(DEFAULT_FACADE, { storeys: 5 });
    expect(merged.storeyHeights).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/facade/prompt-parser.test.ts`
Expected: FAIL — cannot resolve `./prompt-parser`.

- [ ] **Step 3: Create `src/lib/facade/prompt-parser.ts`**

```ts
import type {
  FacadeParams,
  GroundFloorConfig,
  OrnamentConfig,
  PresetId,
} from "./types";
import { FACADE_PRESETS, DOOR_SWATCHES, FACADE_LIMITS } from "./types";
import { WALL_SWATCHES, classicalStoreyHeights } from "@/lib/building/types";

/** Partial params with PARTIAL nested objects — a prompt like "add a stoop"
 * must not clobber the unmentioned treatment/doorBay. */
export type FacadePromptUpdates = Omit<
  Partial<FacadeParams>,
  "groundFloor" | "ornament"
> & {
  groundFloor?: Partial<GroundFloorConfig>;
  ornament?: Partial<OrnamentConfig>;
};

const clampInt = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(v)));

/** Keyword parser — instant feedback while /api/facade-prompt is in flight.
 * Same pattern as src/lib/building/prompt-parser.ts. */
export function parseFacadePromptLocal(prompt: string): FacadePromptUpdates {
  const lower = prompt.toLowerCase();
  const updates: FacadePromptUpdates = {};

  // Presets first — later keywords can still refine on top.
  const PRESET_KEYWORDS: [RegExp, PresetId][] = [
    [/\bgeorgian\b/, "georgian"],
    [/\bvictorian\b/, "victorian-shopfront"],
    [/\bmodern\b|\bminimal\b/, "modern"],
  ];
  for (const [re, id] of PRESET_KEYWORDS) {
    if (re.test(lower)) {
      Object.assign(updates, FACADE_PRESETS[id].params);
      updates.preset = id;
      updates.cellOverrides = [];
      break;
    }
  }

  const storeyMatch = lower.match(/(\d+)\s*-?\s*stor(?:ey|y|eys|ies)/);
  if (storeyMatch) {
    updates.storeys = clampInt(
      parseInt(storeyMatch[1]),
      FACADE_LIMITS.storeys.min,
      FACADE_LIMITS.storeys.max,
    );
  }

  const bayMatch = lower.match(/(\d+)\s*bays?/);
  if (bayMatch) {
    updates.bays = clampInt(
      parseInt(bayMatch[1]),
      FACADE_LIMITS.bays.min,
      FACADE_LIMITS.bays.max,
    );
  }

  const widthMatch = lower.match(/(\d+(?:\.\d+)?)\s*m(?:eters?)?\s*(?:wide|width)/);
  if (widthMatch) {
    updates.width = Math.min(
      FACADE_LIMITS.width.max,
      Math.max(FACADE_LIMITS.width.min, parseFloat(widthMatch[1])),
    );
  }

  // Ground floor
  const gf: Partial<GroundFloorConfig> = { ...updates.groundFloor };
  if (/shop\s?front|\bretail\b|\bshop\b|\bstore\b/.test(lower))
    gf.treatment = "shopfront";
  if (/\bgarage\b/.test(lower)) gf.treatment = "garage";
  if (/\bstoop\b|\bentry steps\b/.test(lower)) gf.stoop = true;
  if (Object.keys(gf).length > 0) updates.groundFloor = gf;

  // Ornament
  const orn: Partial<OrnamentConfig> = { ...updates.ornament };
  if (/\bcornice\b/.test(lower)) orn.cornice = true;
  if (/\bparapet\b/.test(lower)) orn.parapet = true;
  if (/\bsills?\b/.test(lower)) orn.sills = true;
  if (/\bsurrounds?\b/.test(lower)) orn.surrounds = true;
  if (Object.keys(orn).length > 0) updates.ornament = orn;

  // Colors: "<swatch> wall(s)" / "<swatch> door"
  for (const s of WALL_SWATCHES) {
    if (new RegExp(`\\b${s.label.toLowerCase()}\\b[^.]*\\bwalls?\\b`).test(lower)) {
      updates.wallColor = s.hex;
      break;
    }
  }
  for (const s of DOOR_SWATCHES) {
    if (new RegExp(`\\b${s.label.toLowerCase()}\\b[^.]*\\bdoor\\b`).test(lower)) {
      updates.doorColor = s.hex;
      break;
    }
  }

  return updates;
}

export function mergeFacadeParams(
  base: FacadeParams,
  updates: FacadePromptUpdates,
): FacadeParams {
  const merged: FacadeParams = {
    ...base,
    ...updates,
    groundFloor: { ...base.groundFloor, ...(updates.groundFloor ?? {}) },
    ornament: { ...base.ornament, ...(updates.ornament ?? {}) },
  };
  if (updates.storeys !== undefined && updates.storeyHeights === undefined) {
    merged.storeyHeights = classicalStoreyHeights(
      updates.storeys,
      merged.storeyHeight,
    );
  }
  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/prompt-parser.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/facade/prompt-parser.ts src/lib/facade/prompt-parser.test.ts
git commit -m "feat(facade): local keyword prompt parser + deep param merge"
```

---

### Task 8: AI prompt route + prompt UI wiring

**Files:**
- Create: `src/app/api/facade-prompt/route.ts`
- Modify: `src/components/demo/PromptInput.tsx` (add optional `placeholder` + `suggestions` props — backwards compatible)
- Modify: `src/app/facade/page.tsx` (prompt state + handlers + PromptInput placement)

**Interfaces:**
- Consumes: `parseFacadePromptLocal`, `mergeFacadeParams` (Task 7); `generateObject` from `ai`, `zod` (existing deps); existing `src/app/api/prompt/route.ts` as the pattern.
- Produces: `POST /api/facade-prompt` accepting `{ prompt: string, current?: Partial<FacadeSpec> }`, returning `{ spec: FacadeSpec, model: string }`. `FacadeSpec` is flat + fully-required (OpenAI structured output rejects optionals — verified constraint from the existing route).

- [ ] **Step 1: Create `src/app/api/facade-prompt/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";

export const runtime = "nodejs";

// Keep in sync with WALL_SWATCHES / DOOR_SWATCHES in the client libs.
const WALL_COLOR_IDS = [
  "earthy",
  "cream",
  "stone",
  "slate",
  "linen",
  "sage",
  "blush",
  "white",
] as const;
const DOOR_COLOR_IDS = [
  "racing-green",
  "oxblood",
  "navy",
  "black",
  "white",
] as const;

// Flat, fully-required spec: OpenAI structured output rejects .optional()
// (same constraint as /api/prompt). The system prompt tells the model to
// echo current values for unmentioned fields. Per-cell overrides are
// deliberately NOT in the AI surface — that's a direct-manipulation gesture.
const FacadeSpec = z.object({
  storeys: z.number().int().min(1).max(6),
  width: z.number().min(4).max(20),
  bays: z.number().int().min(1).max(9),
  treatment: z.enum(["residential", "shopfront", "garage"]),
  doorBay: z.number().int().min(1).max(9), // 1 = leftmost bay (1-based for the model)
  stoop: z.boolean(),
  cornice: z.boolean(),
  parapet: z.boolean(),
  sills: z.boolean(),
  surrounds: z.boolean(),
  windowSize: z.enum(["small", "medium", "large"]),
  wallColor: z.enum(WALL_COLOR_IDS),
  trimColor: z.enum(WALL_COLOR_IDS),
  doorColor: z.enum(DOOR_COLOR_IDS),
});
export type FacadeSpec = z.infer<typeof FacadeSpec>;

const RequestSchema = z.object({
  prompt: z.string().min(1),
  current: FacadeSpec.partial().optional(),
});

const MODEL = process.env.HOMEMAKER_AI_MODEL ?? "openai/gpt-5-nano";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Bad request", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { prompt, current } = parsed.data;

    const { object } = await generateObject({
      model: MODEL,
      schema: FacadeSpec,
      system: SYSTEM_PROMPT(current),
      prompt,
    });

    return NextResponse.json({ spec: object, model: MODEL });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/facade-prompt]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function SYSTEM_PROMPT(current: Partial<FacadeSpec> | undefined): string {
  const have = current ?? {};
  return [
    "You configure the SINGLE street-facing facade of an infill building",
    "(party walls both sides — only this one wall exists).",
    "The user describes a new facade or an edit to the current one.",
    "Return the COMPLETE new facade specification as JSON matching the schema.",
    "If the user does NOT mention a property, KEEP its current value.",
    "",
    "Current facade (defaults for unmentioned properties):",
    `- storeys: ${have.storeys ?? 3}, width: ${have.width ?? 7.5}m, bays: ${have.bays ?? 3}`,
    `- ground floor: ${have.treatment ?? "residential"}, door in bay ${have.doorBay ?? 1} (1 = leftmost), stoop: ${have.stoop ?? true}`,
    `- ornament: cornice ${have.cornice ?? true}, parapet ${have.parapet ?? false}, sills ${have.sills ?? true}, surrounds ${have.surrounds ?? false}`,
    `- windowSize: ${have.windowSize ?? "medium"}`,
    `- colors: wall ${have.wallColor ?? "earthy"}, trim ${have.trimColor ?? "white"}, door ${have.doorColor ?? "racing-green"}`,
    "",
    "Meanings:",
    '- treatment "residential": windows + front door. "shopfront": retail glazing across the ground floor. "garage": vehicle door instead of an entrance.',
    "- stoop: entry steps in front of the door (residential only).",
    "- windowSize small/medium/large controls window proportions within each bay.",
    "- doorBay is 1-based from the left and must not exceed bays.",
  ].join("\n");
}
```

- [ ] **Step 2: Add optional props to PromptInput**

In `src/components/demo/PromptInput.tsx` — backwards-compatible; the main page keeps its current behavior. Extend the interface:

```ts
interface PromptInputProps {
  onApply: (prompt: string) => void;
  isLoading: boolean;
  /** "floating" pill overlays the viewport (desktop). "inline" flows with
   * the controls panel — used at the top of the mobile menu so the Update
   * button at the bottom isn't covered by a fixed bottom-pill. */
  variant?: "floating" | "inline";
  /** Override the input placeholder (defaults to the building copy). */
  placeholder?: string;
  /** Override the suggestion chips (defaults to the building suggestions). */
  suggestions?: string[];
}
```

In the component signature add `placeholder, suggestions = SUGGESTIONS`, replace `SUGGESTIONS.map` with `suggestions.map`, and replace the hardcoded placeholder ternary with:

```tsx
placeholder={
  placeholder ??
  (isInline
    ? "Describe your building…"
    : "Describe your building — e.g. 3-storey fancy with slate roof")
}
```

- [ ] **Step 3: Wire the prompt into `src/app/facade/page.tsx`**

Add imports (extend the existing import lines where the module is already imported):

```tsx
import { useCallback, useMemo, useState } from "react";
import PromptInput from "@/components/demo/PromptInput";
import {
  parseFacadePromptLocal,
  mergeFacadeParams,
} from "@/lib/facade/prompt-parser";
import { DOOR_SWATCHES } from "@/lib/facade/types";
import { WALL_SWATCHES } from "@/lib/building/types";
```

Add above the component:

```tsx
// AI spec <-> FacadeParams plumbing (mirrors the main page's BuildingSpec flow).
interface FacadeSpec {
  storeys?: number;
  width?: number;
  bays?: number;
  treatment?: "residential" | "shopfront" | "garage";
  doorBay?: number; // 1-based over the wire
  stoop?: boolean;
  cornice?: boolean;
  parapet?: boolean;
  sills?: boolean;
  surrounds?: boolean;
  windowSize?: "small" | "medium" | "large";
  wallColor?: string;
  trimColor?: string;
  doorColor?: string;
}

const WINDOW_SIZE_RATIOS = {
  small: { windowWidthRatio: 0.35, windowHeightRatio: 0.45 },
  medium: { windowWidthRatio: 0.45, windowHeightRatio: 0.55 },
  large: { windowWidthRatio: 0.6, windowHeightRatio: 0.7 },
} as const;

const WALL_HEX = Object.fromEntries(WALL_SWATCHES.map((s) => [s.id, s.hex]));
const DOOR_HEX = Object.fromEntries(DOOR_SWATCHES.map((s) => [s.id, s.hex]));

function specToFacadeParams(spec: FacadeSpec, prev: FacadeParams): FacadeParams {
  let next = { ...prev };
  if (spec.storeys) next = mergeFacadeParams(next, { storeys: spec.storeys });
  if (spec.width) next.width = spec.width;
  if (spec.bays) next.bays = spec.bays;
  if (spec.treatment || spec.doorBay || spec.stoop !== undefined) {
    next.groundFloor = {
      treatment: spec.treatment ?? next.groundFloor.treatment,
      doorBay:
        spec.doorBay !== undefined
          ? Math.max(0, Math.min(next.bays - 1, spec.doorBay - 1))
          : next.groundFloor.doorBay,
      stoop: spec.stoop ?? next.groundFloor.stoop,
    };
  }
  next.ornament = {
    cornice: spec.cornice ?? next.ornament.cornice,
    parapet: spec.parapet ?? next.ornament.parapet,
    sills: spec.sills ?? next.ornament.sills,
    surrounds: spec.surrounds ?? next.ornament.surrounds,
  };
  if (spec.windowSize) Object.assign(next, WINDOW_SIZE_RATIOS[spec.windowSize]);
  if (spec.wallColor && WALL_HEX[spec.wallColor])
    next.wallColor = WALL_HEX[spec.wallColor];
  if (spec.trimColor && WALL_HEX[spec.trimColor])
    next.trimColor = WALL_HEX[spec.trimColor];
  if (spec.doorColor && DOOR_HEX[spec.doorColor])
    next.doorColor = DOOR_HEX[spec.doorColor];
  return next;
}

function nearestWindowSize(p: FacadeParams): "small" | "medium" | "large" {
  const entries = Object.entries(WINDOW_SIZE_RATIOS) as [
    "small" | "medium" | "large",
    { windowWidthRatio: number; windowHeightRatio: number },
  ][];
  let best: "small" | "medium" | "large" = "medium";
  let bestDist = Infinity;
  for (const [id, r] of entries) {
    const d =
      Math.abs(r.windowWidthRatio - p.windowWidthRatio) +
      Math.abs(r.windowHeightRatio - p.windowHeightRatio);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

function paramsToFacadeSpec(p: FacadeParams): FacadeSpec {
  const wallId = WALL_SWATCHES.find(
    (s) => s.hex.toLowerCase() === p.wallColor.toLowerCase(),
  )?.id;
  const trimId = WALL_SWATCHES.find(
    (s) => s.hex.toLowerCase() === p.trimColor.toLowerCase(),
  )?.id;
  const doorId = DOOR_SWATCHES.find(
    (s) => s.hex.toLowerCase() === p.doorColor.toLowerCase(),
  )?.id;
  return {
    storeys: p.storeys,
    width: p.width,
    bays: p.bays,
    treatment: p.groundFloor.treatment,
    doorBay: Math.min(p.groundFloor.doorBay, p.bays - 1) + 1,
    stoop: p.groundFloor.stoop,
    cornice: p.ornament.cornice,
    parapet: p.ornament.parapet,
    sills: p.ornament.sills,
    surrounds: p.ornament.surrounds,
    windowSize: nearestWindowSize(p),
    wallColor: wallId,
    trimColor: trimId,
    doorColor: doorId,
  };
}

const FACADE_SUGGESTIONS = [
  "3-storey georgian with a stoop",
  "victorian shopfront, 4 bays",
  "modern, 2 bays, parapet",
  "garage door, 2 storeys",
];
```

Inside the component add state + handler (same error-pill pattern as `src/app/page.tsx:244-256`):

```tsx
const [isAILoading, setIsAILoading] = useState(false);
const [aiStatus, setAiStatus] = useState<string | null>(null);

const handlePrompt = useCallback(
  async (prompt: string) => {
    // Instant local parse, then the AI refines.
    setParams((prev) => mergeFacadeParams(prev, parseFacadePromptLocal(prompt)));

    setIsAILoading(true);
    setAiStatus(null);
    try {
      const res = await fetch("/api/facade-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, current: paramsToFacadeSpec(params) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const { spec } = (await res.json()) as { spec: FacadeSpec };
      setParams((prev) => specToFacadeParams(spec, prev));
      setAiStatus("AI applied");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const clean = raw.replace(/\[[0-9;]*m/g, "").trim();
      const friendly = /Unauthenticated/i.test(clean)
        ? "AI unavailable: set AI_GATEWAY_API_KEY in Vercel env (local parse applied)"
        : `AI unavailable: ${clean.slice(0, 80)} (local parse applied)`;
      setAiStatus(friendly);
    } finally {
      setIsAILoading(false);
    }
  },
  [params],
);
```

Add the floating prompt overlay inside the viewer container div (desktop) and the inline variant at the top of the panel (mobile) — same placement pattern as `src/app/page.tsx:303-335`:

```tsx
{/* inside the viewer container, after <FacadeViewer .../> */}
<div className="hidden md:block">
  <PromptInput
    onApply={handlePrompt}
    isLoading={isAILoading}
    variant="floating"
    placeholder="Describe your facade — e.g. victorian shopfront, 4 bays"
    suggestions={FACADE_SUGGESTIONS}
  />
</div>
{aiStatus && (
  <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-black/55 backdrop-blur-md px-3 py-1 text-[10px] text-white/75">
    {aiStatus}
  </div>
)}
```

```tsx
{/* at the top of the controls panel, before <FacadeControls .../> */}
<div className="md:hidden">
  <PromptInput
    onApply={handlePrompt}
    isLoading={isAILoading}
    variant="inline"
    placeholder="Describe your facade…"
    suggestions={FACADE_SUGGESTIONS}
  />
  {aiStatus && (
    <div className="mt-1 text-[10px] text-[var(--muted)]">{aiStatus}</div>
  )}
</div>
```

- [ ] **Step 4: Typecheck, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 5: VISUAL CHECKPOINT**

Run: `npm run dev`, open `/facade`:
1. Type "victorian shopfront, 4 bays" — local parse applies instantly (shopfront ground row, 4 bays); if `AI_GATEWAY_API_KEY` is configured the AI result follows; otherwise the friendly status pill appears and the local parse stands.
2. Confirm the main `/` page prompt still shows its original building suggestions (backwards-compat check).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/facade-prompt/route.ts src/components/demo/PromptInput.tsx src/app/facade/page.tsx
git commit -m "feat(facade): AI prompt route + prompt UI with facade suggestions"
```

---

### Task 9: Full verification + docs

**Files:**
- Modify: `AGENTS.md` (stale claims + new file layout entries)

**Interfaces:**
- Consumes: everything.
- Produces: a verified, documented feature branch ready for review/merge.

- [ ] **Step 1: Run the full gate**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

Expected: all pass. `npm test` runs 29 tests (2 types + 17 layout + 10 parser).

- [ ] **Step 2: Update AGENTS.md**

Three edits:

1. Replace the line `**No test runner or test files exist.** Don't look for jest/vitest/playwright.` with:

```markdown
**Tests:** vitest covers the pure facade layout engine and prompt parser (`src/lib/facade/*.test.ts`) — run `npm test`. No e2e/playwright; everything else is verified visually.
```

2. Add a row to the Commands table:

```markdown
| Tests | `npm test` | vitest — src/lib/facade unit tests |
```

3. In the "Key file layout" code block, add under `src/`:

```
  app/
    facade/page.tsx   — Facade designer: single street-facing facade for infill lots
    api/
      facade-prompt/route.ts — POST: AI prompt parsing for the facade designer
  components/
    facade/
      FacadeViewer.tsx   — R3F canvas, front-hemisphere orbit, save-image
      FacadeMesh.tsx     — FacadeLayout → meshes (wall, openings, ornament)
      FacadeControls.tsx — presets + sliders + toggles panel
      BayGrid.tsx        — tappable per-cell opening editor
  lib/
    facade/
      types.ts         — FacadeParams, presets, defaults, LotContext
      layout.ts        — pure layout engine (params → rectangles, all clamps)
      prompt-parser.ts — local keyword parser + deep merge
```

Also add a short section after the "Demo app (`/demo`)" section:

```markdown
## Facade designer (`/facade`)

A single-wall parametric facade designer for infill urban lots (one street-facing
facade, party walls both sides). Pure client-side Three.js — the Python pipeline is
NOT involved; every edit is live (no Update button). Spec:
`docs/superpowers/specs/2026-07-06-facade-designer-design.md`.

- **Layout engine**: `src/lib/facade/layout.ts` is a pure function
  (FacadeParams → rectangles) holding ALL validity clamps; the mesh renders
  whatever it returns. Corner conditions (two facades) plug in at this seam later.
- **Grid model**: (storeys × bays) cells, treatment-derived defaults + sparse
  `cellOverrides` patches.
- **AI prompt**: `/api/facade-prompt` (flat fully-required zod spec — OpenAI
  structured output rejects optionals), plus an instant local keyword parser.
```

- [ ] **Step 3: Final visual pass**

`npm run dev`, then at `http://localhost:3000/facade` run through each preset, toggle each ornament, cycle a few bay cells, capture a Save-image PNG, and confirm `/` (the building editor) still works untouched.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: facade designer in AGENTS.md — test runner, file layout, /facade section"
```

- [ ] **Step 5: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to decide merge/PR/next steps with the user.

---

## Plan Self-Review Notes

- **Spec coverage**: data model → Task 1; grid rule → Task 2; layout + clamps → Task 3; mesh (wall/openings/ornament/stoop) → Task 4; viewer (constrained orbit, save-image, context masses, sidewalk) → Task 5; controls + bay grid + presets → Task 6; local parser → Task 7; AI route + PromptInput → Task 8; testing + docs → Tasks 1–9. Corner-conditions future-proofing is satisfied by the layout seam (spec: "the page state is conceptually `facades: [FacadeParams]`" — v1 holds a single `params` state; adding an array is a page-level refactor that touches nothing below it).
- **Known deviation from spec**: `PromptInput` gains two optional backwards-compatible props (`placeholder`, `suggestions`) instead of being reused byte-identical — the hardcoded building suggestion chips would be wrong on the facade page. Flagged in Global Constraints.
- **Type consistency**: `FacadeLayout`/`OpeningRect` field names checked across Tasks 3/4/5; `FacadePromptUpdates` across 7/8; `resolveGrid` signature across 2/6.
