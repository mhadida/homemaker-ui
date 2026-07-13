# Facade Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Divide any one facade into sections — vertical strips of whole bays,
each with its own small perpendicular relief offset — with a symmetrical /
asymmetrical toggle. Cornice/parapet step with the offsets; corner-side end
sections stay flush so miters keep closing; AI prompt gets count + named
patterns.

**Architecture:** `FacadeParams` gains a sparse `sections?: FacadeSection[]` +
`sectionsSymmetrical?: boolean`. `resolveSections` in the layout engine is the
single sanitizer (stale partitions refit proportionally, symmetry enforced at
resolve time so the toggle is live). `computeLayout` returns `SectionStrip[]`
(x-extents incl. anti-coplanar lap) that `FacadeMesh` renders blindly as one
z-offset group per strip. New pure module `sections.ts` holds canonical-write
edit helpers shared by the panel and the AI mapping. `syncCorners` flattens
corner-side end-section offsets (depthOffset precedent).

**Tech Stack:** Next.js 16 App Router, React 19 Strict Mode, three + @react-three/fiber 9 + drei 10, vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-facade-sections-design.md`

## Global Constraints

- **Byte-identity:** `params.sections` absent/empty → one full-width flush
  strip and geometry identical to v4 (existing 130 tests unchanged and green
  is the proof; no existing test may be edited).
- **All clamps in layout:** stored sections may be stale (bay-count changes,
  AI writes); `resolveSections` is total and deterministic — sanitize
  (non-finite → 1 bay / 0 offset), cap count at `bays`, proportional
  largest-remainder refit to `Σ == bays` with min 1, then symmetry.
- `SECTION_OFFSET_MAX = 0.15` (max relative step 0.30 < WALL_THICKNESS 0.35 —
  slabs always overlap). `SECTION_LAP = 0.05` (< SHOPFRONT_MULLION 0.06, the
  smallest opening-to-bay-edge margin — a lap can never touch an opening).
- Sections are FACE, not shell: never synced across corners in either mode
  (cellOverrides precedent). Only the corner-side end section's offset is
  zeroed by sync (symmetric lots zero stored[0] — resolve mirrors it).
- Generator/reroll untouched: generated lots carry no sections.
- No `Math.random` in `src/lib/facade/`; Strict Mode purity (all new lib
  functions pure; helpers return new objects, never mutate params).
- R3F geometry disposal: every ExtrudeGeometry created for section strips is
  disposed on change (v4 leak rule).
- Gates after every task: `npx tsc --noEmit` clean; `npm run lint` exactly 3
  pre-existing warnings (src/lib/building/prompt-parser.ts ×2,
  src/lib/python-server.ts ×1); `npm test` all green (130 baseline + this
  plan's additions). Local `npm run build` fails for a pre-existing
  environment reason — do not chase it.
- Never touch `public/default.glb` or `python/vendor/homemaker-addon`. No
  colored directional border accents in UI; dark theme CSS vars only.

## File map

| File | Change |
|---|---|
| `src/lib/facade/types.ts` | `FacadeSection`; `FacadeParams.sections?`/`sectionsSymmetrical?` (T1) |
| `src/lib/facade/layout.ts` | `SECTION_OFFSET_MAX`, `SECTION_LAP`, `resolveSections`, `SectionStrip`, `FacadeLayout.sections`, sill/stoop `bay` (T1) |
| `src/lib/facade/layout.test.ts` | new `sections` describes (T1) |
| `src/lib/facade/sections.ts` | **New** — canonical edit helpers + patterns (T2) |
| `src/lib/facade/sections.test.ts` | **New** (T2) |
| `src/components/facade/FacadeMesh.tsx` | per-strip groups, wall geo per strip, CorniceSegment/parapet segments (T3) |
| `src/lib/facade/corners.ts` | `flattenEndSection` inside `patchLot` (T4) |
| `src/lib/facade/corners.test.ts` | flattening tests (T4) |
| `src/components/facade/FacadeControls.tsx` | "Sections" group in the lot inspector (T5) |
| `src/app/api/facade-prompt/route.ts` | `sections` + `sectionPattern` spec fields (T6) |
| `src/app/facade/page.tsx` | FacadeSpec mapping both directions (T6) |
| `src/lib/facade/prompt-parser.ts` | local keywords: count / center patterns / symmetry (T6) |
| `src/lib/facade/prompt-parser.test.ts` | parser additions (T6) |
| `AGENTS.md` | facade section bullet (T7) |

---

### Task 1: layout engine — `resolveSections` + `SectionStrip`

**Files:** `src/lib/facade/types.ts`, `src/lib/facade/layout.ts`,
`src/lib/facade/layout.test.ts`

- [ ] **Step 1: failing tests** — append to `layout.test.ts`:

```ts
import { resolveSections, SECTION_LAP, SECTION_OFFSET_MAX } from "./layout";

describe("resolveSections", () => {
  it("absent sections resolve to one full-width flush section", () => {
    expect(resolveSections(p({ bays: 4 }))).toEqual([
      { startBay: 0, bays: 4, offset: 0 },
    ]);
    expect(resolveSections(p({ bays: 4, sections: [] }))).toEqual([
      { startBay: 0, bays: 4, offset: 0 },
    ]);
  });

  it("keeps an exact partition and clamps offsets", () => {
    const r = resolveSections(
      p({
        bays: 3,
        sections: [
          { bays: 1, offset: 0.4 },
          { bays: 2, offset: -0.4 },
        ],
      }),
    );
    expect(r).toEqual([
      { startBay: 0, bays: 1, offset: SECTION_OFFSET_MAX },
      { startBay: 1, bays: 2, offset: -SECTION_OFFSET_MAX },
    ]);
  });

  it("refits a stale partition proportionally (sum exact, min 1)", () => {
    // stored for 6 bays, lot now has 3
    const r = resolveSections(
      p({
        bays: 3,
        sections: [
          { bays: 2, offset: 0.1 },
          { bays: 2, offset: -0.1 },
          { bays: 2, offset: 0.05 },
        ],
      }),
    );
    expect(r.map((s) => s.bays)).toEqual([1, 1, 1]);
    expect(r.map((s) => s.offset)).toEqual([0.1, -0.1, 0.05]);
    // stored for 2 bays, lot now has 5
    const grown = resolveSections(
      p({
        bays: 5,
        sections: [
          { bays: 1, offset: 0 },
          { bays: 1, offset: -0.1 },
        ],
      }),
    );
    expect(grown.map((s) => s.bays)).toEqual([3, 2]); // ties -> lower index
    expect(grown.reduce((a, s) => a + s.bays, 0)).toBe(5);
  });

  it("caps the section count at the bay count", () => {
    const r = resolveSections(
      p({
        bays: 2,
        sections: [
          { bays: 1, offset: 0.1 },
          { bays: 1, offset: -0.1 },
          { bays: 1, offset: 0.15 },
        ],
      }),
    );
    expect(r).toHaveLength(2);
    expect(r.map((s) => s.offset)).toEqual([0.1, -0.1]);
  });

  it("sanitizes non-finite garbage", () => {
    const r = resolveSections(
      p({
        bays: 4,
        sections: [
          { bays: NaN, offset: NaN },
          { bays: Infinity, offset: 0.1 },
        ],
      }),
    );
    expect(r.reduce((a, s) => a + s.bays, 0)).toBe(4);
    for (const s of r) {
      expect(Number.isFinite(s.bays)).toBe(true);
      expect(s.bays).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(s.offset)).toBe(true);
    }
  });

  it("symmetry mirrors offsets and bay counts (odd count: middle absorbs)", () => {
    const r = resolveSections(
      p({
        bays: 7,
        sectionsSymmetrical: true,
        sections: [
          { bays: 2, offset: 0.1 },
          { bays: 4, offset: -0.05 },
          { bays: 1, offset: 0.15 },
        ],
      }),
    );
    expect(r.map((s) => s.bays)).toEqual([2, 3, 2]);
    expect(r.map((s) => s.offset)).toEqual([0.1, -0.05, 0.1]);
  });

  it("symmetry: middle borrows from inner-left when it would vanish", () => {
    const r = resolveSections(
      p({
        bays: 5,
        sectionsSymmetrical: true,
        sections: [
          { bays: 3, offset: 0 },
          { bays: 1, offset: -0.1 },
          { bays: 1, offset: 0 },
        ],
      }),
    );
    // left [3] -> mid = 5-6 = -1 -> borrow: left [2], mid 1
    expect(r.map((s) => s.bays)).toEqual([2, 1, 2]);
  });

  it("symmetry: even count adjusts the innermost pair; odd leftover bay goes innermost-right", () => {
    const even = resolveSections(
      p({
        bays: 6,
        sectionsSymmetrical: true,
        sections: [
          { bays: 1, offset: 0.1 },
          { bays: 3, offset: 0 },
          { bays: 1, offset: 0 },
          { bays: 1, offset: 0 },
        ],
      }),
    );
    expect(even.map((s) => s.bays)).toEqual([1, 2, 2, 1]);
    expect(even.map((s) => s.offset)).toEqual([0.1, 0, 0, 0.1]);
    const odd = resolveSections(
      p({
        bays: 5,
        sectionsSymmetrical: true,
        sections: [
          { bays: 2, offset: 0 },
          { bays: 3, offset: -0.1 },
        ],
      }),
    );
    expect(odd.map((s) => s.bays)).toEqual([2, 3]); // innermost right absorbs
    expect(odd.map((s) => s.offset)).toEqual([0, 0]);
  });
});

describe("computeLayout sections", () => {
  it("no sections: single flush strip spanning the wall", () => {
    const layout = computeLayout(DEFAULT_FACADE);
    expect(layout.sections).toEqual([
      {
        startBay: 0,
        bays: DEFAULT_FACADE.bays,
        offset: 0,
        x0: -DEFAULT_FACADE.width / 2,
        x1: DEFAULT_FACADE.width / 2,
      },
    ]);
  });

  it("strip boundaries land on bay lines; recessed side laps under the prouder", () => {
    const layout = computeLayout(
      p({
        width: 9,
        bays: 3,
        sections: [
          { bays: 1, offset: 0 },
          { bays: 1, offset: -0.1 },
          { bays: 1, offset: 0 },
        ],
      }),
    );
    const [a, b, c] = layout.sections;
    expect(a.x0).toBeCloseTo(-4.5, 9);
    expect(a.x1).toBeCloseTo(-1.5, 9); // proud: no lap
    expect(b.x0).toBeCloseTo(-1.5 - SECTION_LAP, 9); // recessed laps left
    expect(b.x1).toBeCloseTo(1.5 + SECTION_LAP, 9); // and right
    expect(c.x0).toBeCloseTo(1.5, 9);
    expect(c.x1).toBeCloseTo(4.5, 9); // outer edge never lapped
  });

  it("flush neighbors butt exactly (no lap)", () => {
    const layout = computeLayout(
      p({
        width: 6,
        bays: 2,
        sections: [
          { bays: 1, offset: 0.1 },
          { bays: 1, offset: 0.1 },
        ],
      }),
    );
    expect(layout.sections[0].x1).toBeCloseTo(0, 9);
    expect(layout.sections[1].x0).toBeCloseTo(0, 9);
  });

  it("every opening lies inside its own strip", () => {
    const params = p({
      width: 12,
      bays: 4,
      groundFloor: { treatment: "shopfront", doorBay: 1, stoop: false },
      sections: [
        { bays: 1, offset: 0.12 },
        { bays: 2, offset: -0.12 },
        { bays: 1, offset: 0 },
      ],
    });
    const layout = invariants(params);
    for (const o of layout.openings) {
      const s = layout.sections.find(
        (x) => o.bay >= x.startBay && o.bay < x.startBay + x.bays,
      )!;
      expect(o.x).toBeGreaterThanOrEqual(s.x0 - 1e-9);
      expect(o.x + o.w).toBeLessThanOrEqual(s.x1 + 1e-9);
    }
  });

  it("sills and stoop carry their bay", () => {
    const layout = computeLayout(
      p({ groundFloor: { treatment: "residential", doorBay: 1, stoop: true } }),
    );
    for (const s of layout.sills) expect(typeof s.bay).toBe("number");
    expect(layout.stoop!.bay).toBe(1);
    const windows = layout.openings.filter((o) => o.kind === "window");
    expect(layout.sills.map((s) => s.bay)).toEqual(windows.map((o) => o.bay));
  });

  it("sectioned layouts keep all existing invariants", () => {
    invariants(
      p({
        width: 5,
        bays: 9,
        sectionsSymmetrical: true,
        sections: [
          { bays: 3, offset: 0.15 },
          { bays: 3, offset: -0.15 },
          { bays: 3, offset: 0.15 },
        ],
      }),
    );
  });
});
```

- [ ] **Step 2: types** — in `types.ts` after `CellOverride`:

```ts
export interface FacadeSection {
  /** Consecutive bays this section spans (>= 1). Stale partitions (after a
   * bay-count change) are refit proportionally by the layout engine, so any
   * stored value is harmless (doorBay precedent). */
  bays: number;
  /** Perpendicular relief along the facade normal, metres; + is
   * street-proud. Clamped to ±SECTION_OFFSET_MAX by the layout engine. */
  offset: number;
}
```

and in `FacadeParams` (after `cellOverrides`):

```ts
  /** Optional horizontal partition into offset strips. Absent/empty = one
   * full-width flush section (pre-sections behavior byte-identical). */
  sections?: FacadeSection[];
  /** Mirror section bays/offsets around the facade center. Enforced at
   * resolve time, so toggling is live. */
  sectionsSymmetrical?: boolean;
```

- [ ] **Step 3: layout** — in `layout.ts`, constants next to the others:

```ts
export const SECTION_OFFSET_MAX = 0.15; // max perpendicular relief (m)
export const SECTION_LAP = 0.05; // anti-coplanar underlap at offset steps (m)
```

`resolveSections` above `computeLayout` (complete):

```ts
export interface ResolvedSection {
  /** First bay index (inclusive). */
  startBay: number;
  bays: number;
  offset: number;
}

/** THE section sanitizer (all clamps live in this file): sanitize entries,
 * cap the count at the bay count, refit stale partitions proportionally so
 * the sum is exactly `bays` (min 1 each), then enforce symmetry. Total and
 * deterministic — the mesh renders whatever this returns. */
export function resolveSections(params: FacadeParams): ResolvedSection[] {
  const total = params.bays;
  const raw = params.sections ?? [];
  if (raw.length === 0) return [{ startBay: 0, bays: total, offset: 0 }];

  const count = Math.min(raw.length, total);
  const bays = raw
    .slice(0, count)
    .map((s) => (Number.isFinite(s.bays) ? Math.max(1, Math.round(s.bays)) : 1));
  const offsets = raw
    .slice(0, count)
    .map((s) =>
      Number.isFinite(s.offset)
        ? clamp(s.offset, -SECTION_OFFSET_MAX, SECTION_OFFSET_MAX)
        : 0,
    );

  // Proportional refit (largest remainder, min 1). count <= total, so a
  // minimum of 1 bay per section is always feasible.
  const sum = bays.reduce((a, b) => a + b, 0);
  if (sum !== total) {
    const quotas = bays.map((b) => (b * total) / sum);
    const fitted = quotas.map((q) => Math.max(1, Math.floor(q)));
    let acc = fitted.reduce((a, b) => a + b, 0);
    if (acc < total) {
      const order = quotas
        .map((q, i) => ({ i, frac: q - Math.floor(q) }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
      for (let k = 0; acc < total; k = (k + 1) % order.length) {
        fitted[order[k].i] += 1;
        acc += 1;
      }
    } else {
      while (acc > total) {
        let d = -1;
        for (let i = 0; i < fitted.length; i++) {
          if (fitted[i] > 1 && (d < 0 || fitted[i] >= fitted[d])) d = i;
        }
        fitted[d] -= 1;
        acc -= 1;
      }
    }
    for (let i = 0; i < count; i++) bays[i] = fitted[i];
  }

  // Symmetry: right half mirrors the left (left wins). The middle (odd
  // count) absorbs the remainder, borrowing innermost-left when short; even
  // counts adjust the innermost pair, any odd leftover bay landing on the
  // innermost RIGHT section (no exact palindrome exists then).
  if (params.sectionsSymmetrical && count >= 2) {
    const half = Math.floor(count / 2);
    for (let i = 0; i < half; i++) offsets[count - 1 - i] = offsets[i];
    const left = bays.slice(0, half);
    if (count % 2 === 1) {
      let mid = total - 2 * left.reduce((a, b) => a + b, 0);
      while (mid < 1) {
        let d = half - 1;
        while (left[d] <= 1) d--;
        left[d] -= 1;
        mid += 2;
      }
      bays.splice(0, count, ...left, mid, ...[...left].reverse());
    } else {
      const rem = total - 2 * left.reduce((a, b) => a + b, 0);
      let add = Math.trunc(rem / 2);
      const leftover = rem - 2 * add;
      for (let i = half - 1; add !== 0 && i >= 0; i--) {
        if (add > 0) {
          left[i] += add;
          add = 0;
        } else {
          const take = Math.min(left[i] - 1, -add);
          left[i] -= take;
          add += take;
        }
      }
      const right = [...left].reverse();
      if (leftover > 0) right[0] += leftover;
      else if (leftover < 0) {
        let d = 0;
        while (right[d] <= 1) d++;
        right[d] -= 1;
      }
      bays.splice(0, count, ...left, ...right);
    }
  }

  const out: ResolvedSection[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    out.push({ startBay: start, bays: bays[i], offset: offsets[i] });
    start += bays[i];
  }
  return out;
}

export interface SectionStrip extends ResolvedSection {
  /** Wall-strip x-extents, lap included. First strip x0 = -width/2, last
   * strip x1 = +width/2 (corner miters are a mesh concern). */
  x0: number;
  x1: number;
}
```

`FacadeLayout` gains `sections: SectionStrip[]`, sill entries gain
`bay: number`, stoop gains `bay: number`. In `computeLayout`:

```ts
  const resolvedSections = resolveSections(params);
  const sections: SectionStrip[] = resolvedSections.map((s) => ({
    ...s,
    x0: -width / 2 + s.startBay * bayWidth,
    x1: -width / 2 + (s.startBay + s.bays) * bayWidth,
  }));
  sections[0].x0 = -width / 2;
  sections[sections.length - 1].x1 = width / 2;
  for (let i = 0; i + 1 < sections.length; i++) {
    const a = sections[i];
    const b = sections[i + 1];
    if (a.offset < b.offset - 1e-9) a.x1 += SECTION_LAP;
    else if (a.offset > b.offset + 1e-9) b.x0 -= SECTION_LAP;
  }
```

sills: `windows.map((o) => ({ x: o.x - 0.06, y: o.y - 0.07, w: o.w + 0.12, bay: o.bay }))`;
stoop object gains `bay: door.bay`; return gains `sections`.

- [ ] **Step 4:** gates. Commit `feat(facade): section model + resolveSections + layout strips`.

---

### Task 2: `sections.ts` — canonical edit helpers + patterns

**Files:** create `src/lib/facade/sections.ts`, `src/lib/facade/sections.test.ts`

Semantics (spec): helpers read RESOLVED sections and write back canonical
arrays (stored = rendered). `withSectionCount(…, 1)` clears `sections`.
Bay steppers are asymmetric-mode only (symmetric partitions come from count +
canonical mirroring) — `withSectionBays` returns `params` unchanged when
`sectionsSymmetrical`. Patterns use ±0.12; center patterns need ≥ 3 sections
(a smaller count is bumped to 3, capped by bays; if bays < 3 → flush).

- [ ] **Step 1: failing tests** — `sections.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  withSectionCount,
  withSectionOffset,
  withSectionBays,
  withSectionsSymmetry,
  applySectionPattern,
  classifySectionPattern,
} from "./sections";
import { resolveSections } from "./layout";
import { DEFAULT_FACADE, type FacadeParams } from "./types";

const p = (o: Partial<FacadeParams>): FacadeParams => ({
  ...DEFAULT_FACADE,
  ...o,
});

describe("withSectionCount", () => {
  it("splits bays evenly, extra to the left", () => {
    const next = withSectionCount(p({ bays: 5 }), 3);
    expect(next.sections!.map((s) => s.bays)).toEqual([2, 2, 1]);
    expect(next.sections!.every((s) => s.offset === 0)).toBe(true);
  });

  it("preserves offsets by index when the count changes", () => {
    const base = withSectionOffset(withSectionCount(p({ bays: 4 }), 4), 1, -0.1);
    const next = withSectionCount(base, 2);
    expect(next.sections!.map((s) => s.offset)).toEqual([0, -0.1]);
  });

  it("count 1 clears sections", () => {
    const next = withSectionCount(withSectionCount(p({ bays: 3 }), 3), 1);
    expect(next.sections).toBeUndefined();
  });

  it("count clamps to the bay count", () => {
    const next = withSectionCount(p({ bays: 2 }), 7);
    expect(next.sections).toHaveLength(2);
  });
});

describe("withSectionOffset", () => {
  it("sets and clamps one section's offset", () => {
    const base = withSectionCount(p({ bays: 3 }), 3);
    const next = withSectionOffset(base, 1, 0.4);
    expect(next.sections!.map((s) => s.offset)).toEqual([0, 0.15, 0]);
  });

  it("mirrors the edit in symmetric mode (either half)", () => {
    const base = withSectionsSymmetry(withSectionCount(p({ bays: 3 }), 3), true);
    const next = withSectionOffset(base, 2, 0.1);
    expect(next.sections!.map((s) => s.offset)).toEqual([0.1, 0, 0.1]);
  });

  it("out-of-range index is a no-op", () => {
    const base = withSectionCount(p({ bays: 3 }), 3);
    expect(withSectionOffset(base, 9, 0.1)).toBe(base);
  });
});

describe("withSectionBays", () => {
  it("steals a bay from the right neighbor", () => {
    const base = withSectionCount(p({ bays: 6 }), 3); // [2,2,2]
    const next = withSectionBays(base, 0, 1);
    expect(next.sections!.map((s) => s.bays)).toEqual([3, 1, 2]);
  });

  it("shrinking returns the bay to the right neighbor", () => {
    const base = withSectionCount(p({ bays: 6 }), 3);
    const next = withSectionBays(base, 0, -1);
    expect(next.sections!.map((s) => s.bays)).toEqual([1, 3, 2]);
  });

  it("the last section borrows from the left", () => {
    const base = withSectionCount(p({ bays: 6 }), 3);
    const next = withSectionBays(base, 2, 1);
    expect(next.sections!.map((s) => s.bays)).toEqual([2, 1, 3]);
  });

  it("never shrinks any section below 1 bay", () => {
    const base = withSectionCount(p({ bays: 3 }), 3); // [1,1,1]
    expect(withSectionBays(base, 0, 1)).toBe(base);
    expect(withSectionBays(base, 0, -1)).toBe(base);
  });

  it("is a no-op in symmetric mode", () => {
    const base = withSectionsSymmetry(withSectionCount(p({ bays: 6 }), 3), true);
    expect(withSectionBays(base, 0, 1)).toBe(base);
  });
});

describe("withSectionsSymmetry", () => {
  it("turning symmetry on canonicalizes the stored array", () => {
    let base = withSectionCount(p({ bays: 5 }), 3); // [2,2,1]
    base = withSectionOffset(base, 0, 0.1);
    const next = withSectionsSymmetry(base, true);
    expect(next.sectionsSymmetrical).toBe(true);
    expect(next.sections!.map((s) => s.bays)).toEqual([2, 1, 2]);
    expect(next.sections!.map((s) => s.offset)).toEqual([0.1, 0, 0.1]);
    // stored equals resolved (WYSIWYG)
    expect(resolveSections(next).map((s) => s.bays)).toEqual([2, 1, 2]);
  });

  it("turning symmetry off keeps the mirrored state and frees edits", () => {
    const sym = withSectionsSymmetry(withSectionCount(p({ bays: 4 }), 2), true);
    const next = withSectionsSymmetry(sym, false);
    expect(next.sectionsSymmetrical).toBe(false);
    expect(next.sections!.map((s) => s.bays)).toEqual([2, 2]);
  });
});

describe("section patterns", () => {
  it("applies recessed-center (center band recessed, symmetric)", () => {
    const next = applySectionPattern(p({ bays: 6 }), 3, "recessed-center");
    expect(next.sections!.map((s) => s.offset)).toEqual([0, -0.12, 0]);
    expect(next.sectionsSymmetrical).toBe(true);
  });

  it("projected-center bumps a too-small count to 3", () => {
    const next = applySectionPattern(p({ bays: 6 }), 1, "projected-center");
    expect(next.sections).toHaveLength(3);
    expect(next.sections![1].offset).toBeCloseTo(0.12, 9);
  });

  it("center patterns on a 2-bay facade fall back to flush", () => {
    const next = applySectionPattern(p({ bays: 2 }), 3, "recessed-center");
    expect(classifySectionPattern(next)).toBe("flush");
  });

  it("alternating recesses odd sections and clears symmetry", () => {
    const next = applySectionPattern(p({ bays: 8 }), 4, "alternating");
    expect(next.sections!.map((s) => s.offset)).toEqual([0, -0.12, 0, -0.12]);
    expect(next.sectionsSymmetrical).toBe(false);
  });

  it("flush zeroes offsets and keeps the partition", () => {
    let base = applySectionPattern(p({ bays: 6 }), 3, "recessed-center");
    base = applySectionPattern(base, 3, "flush");
    expect(base.sections!.map((s) => s.offset)).toEqual([0, 0, 0]);
    expect(base.sections!.map((s) => s.bays)).toEqual([2, 2, 2]);
  });

  it("classify round-trips every named pattern and reports custom otherwise", () => {
    const base = p({ bays: 6 });
    expect(classifySectionPattern(base)).toBe("flush");
    for (const pat of ["recessed-center", "projected-center", "alternating"] as const) {
      expect(classifySectionPattern(applySectionPattern(base, 4, pat))).toBe(pat);
    }
    expect(
      classifySectionPattern(withSectionOffset(withSectionCount(base, 4), 0, 0.07)),
    ).toBe("custom");
  });
});
```

- [ ] **Step 2: implement** `sections.ts` (complete):

```ts
import type { FacadeParams, FacadeSection } from "./types";
import { resolveSections, SECTION_OFFSET_MAX } from "./layout";

/** AI-facing named relief patterns. "custom" is the echo/no-touch value. */
export type SectionPattern =
  | "custom"
  | "flush"
  | "recessed-center"
  | "projected-center"
  | "alternating";

/** Relief used by named patterns (m). Deliberately inside ±SECTION_OFFSET_MAX. */
export const SECTION_PATTERN_OFFSET = 0.12;

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** Even partition of `total` bays into `count` sections, extra bays leftward. */
export function evenPartition(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const rem = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Canonical write-back: store exactly what resolveSections renders, so the
 * panel is WYSIWYG (symmetry enforcement included). */
function canonical(params: FacadeParams): FacadeParams {
  return {
    ...params,
    sections: resolveSections(params).map((s) => ({
      bays: s.bays,
      offset: s.offset,
    })),
  };
}

const asStored = (s: { bays: number; offset: number }): FacadeSection => ({
  bays: s.bays,
  offset: s.offset,
});

/** Set the section count: even split, offsets carried over by index (new
 * sections flush). Count <= 1 clears `sections` (byte-identical default). */
export function withSectionCount(
  params: FacadeParams,
  count: number,
): FacadeParams {
  const n = clamp(Math.round(count), 1, params.bays);
  if (n <= 1) return { ...params, sections: undefined };
  const current = resolveSections(params);
  const sections = evenPartition(params.bays, n).map((bays, i) => ({
    bays,
    offset: current[i]?.offset ?? 0,
  }));
  return canonical({ ...params, sections });
}

/** Set one section's offset. In symmetric mode the mirror section follows
 * (editing either half works). Out-of-range index is a no-op. */
export function withSectionOffset(
  params: FacadeParams,
  index: number,
  offset: number,
): FacadeParams {
  const secs = resolveSections(params).map(asStored);
  if (index < 0 || index >= secs.length) return params;
  const o = clamp(offset, -SECTION_OFFSET_MAX, SECTION_OFFSET_MAX);
  secs[index] = { ...secs[index], offset: o };
  if (params.sectionsSymmetrical) {
    const j = secs.length - 1 - index;
    secs[j] = { ...secs[j], offset: o };
  }
  return canonical({ ...params, sections: secs });
}

/** Grow (+1) or shrink (−1) a section by one bay against its right neighbor
 * (the last section borrows from the left). Clamped so no section drops
 * below 1 bay. Asymmetric mode only — symmetric partitions come from the
 * count + canonical mirroring. */
export function withSectionBays(
  params: FacadeParams,
  index: number,
  delta: 1 | -1,
): FacadeParams {
  if (params.sectionsSymmetrical) return params;
  const secs = resolveSections(params).map(asStored);
  const n = secs.length;
  if (n < 2 || index < 0 || index >= n) return params;
  const neighbor = index < n - 1 ? index + 1 : index - 1;
  const src = delta > 0 ? neighbor : index;
  const dst = delta > 0 ? index : neighbor;
  if (secs[src].bays <= 1) return params;
  secs[src] = { ...secs[src], bays: secs[src].bays - 1 };
  secs[dst] = { ...secs[dst], bays: secs[dst].bays + 1 };
  return canonical({ ...params, sections: secs });
}

/** Toggle the symmetry flag. Turning it ON canonicalizes the stored array to
 * the mirrored form (WYSIWYG — the pre-symmetric values are not archived). */
export function withSectionsSymmetry(
  params: FacadeParams,
  on: boolean,
): FacadeParams {
  const next = { ...params, sectionsSymmetrical: on };
  return next.sections && next.sections.length > 0 ? canonical(next) : next;
}

/** Build a named relief pattern at `count` sections. Center patterns need at
 * least 3 sections (count is bumped; a facade under 3 bays falls back to
 * flush). Alternating clears symmetry; center patterns set it. */
export function applySectionPattern(
  params: FacadeParams,
  count: number,
  pattern: Exclude<SectionPattern, "custom">,
): FacadeParams {
  let n = clamp(Math.round(count), 1, params.bays);
  const center = pattern === "recessed-center" || pattern === "projected-center";
  if (center) n = clamp(Math.max(n, 3), 1, params.bays);
  if (n <= 1 || (center && n < 3)) {
    return { ...params, sections: undefined };
  }
  const mid1 = Math.floor((n - 1) / 2);
  const mid2 = Math.ceil((n - 1) / 2);
  const offsetFor = (i: number): number => {
    if (pattern === "flush") return 0;
    if (pattern === "alternating")
      return i % 2 === 1 ? -SECTION_PATTERN_OFFSET : 0;
    const inCenter = i >= mid1 && i <= mid2;
    if (!inCenter) return 0;
    return pattern === "recessed-center"
      ? -SECTION_PATTERN_OFFSET
      : SECTION_PATTERN_OFFSET;
  };
  const sections = evenPartition(params.bays, n).map((bays, i) => ({
    bays,
    offset: offsetFor(i),
  }));
  const sectionsSymmetrical = center
    ? true
    : pattern === "alternating"
      ? false
      : params.sectionsSymmetrical;
  return canonical({ ...params, sections, sectionsSymmetrical });
}

const EPS = 0.005;

/** Classify the current relief for the AI echo. "custom" = no named match. */
export function classifySectionPattern(params: FacadeParams): SectionPattern {
  const secs = resolveSections(params);
  const n = secs.length;
  const offs = secs.map((s) => s.offset);
  if (n === 1 || offs.every((o) => Math.abs(o) < EPS)) return "flush";
  if (n >= 3) {
    const mid1 = Math.floor((n - 1) / 2);
    const mid2 = Math.ceil((n - 1) / 2);
    const ends = offs.filter((_, i) => i < mid1 || i > mid2);
    const center = offs.slice(mid1, mid2 + 1);
    const endsFlat = ends.every((o) => Math.abs(o - ends[0]) < EPS);
    const centerFlat = center.every((o) => Math.abs(o - center[0]) < EPS);
    if (endsFlat && centerFlat && ends.length > 0) {
      if (center[0] < ends[0] - EPS) return "recessed-center";
      if (center[0] > ends[0] + EPS) return "projected-center";
    }
  }
  if (n >= 2) {
    const evenO = offs[0];
    const oddO = offs[1];
    const alternates = offs.every(
      (o, i) => Math.abs(o - (i % 2 === 0 ? evenO : oddO)) < EPS,
    );
    if (alternates && oddO < evenO - EPS) return "alternating";
  }
  return "custom";
}
```

- [ ] **Step 3:** gates. Commit `feat(facade): section edit helpers + named relief patterns`.

---

### Task 3: `FacadeMesh` — per-strip rendering

**Files:** `src/components/facade/FacadeMesh.tsx`

No unit tests (component); verified by gates + browser. Rules:

- `buildWallGeometry(layout, strip, extendL, extendR)`: outline
  `strip.x0 − extendL … strip.x1 + extendR`, holes = openings with
  `o.bay ∈ [strip.startBay, strip.startBay + strip.bays)`. Same extrude +
  `translate(0, 0, -WALL_THICKNESS)`.
- One geometry per strip in a single `useMemo` (key `[layout, ml, mr]`);
  dispose ALL in one cleanup effect.
- Render one `<group key={i} position={[0, 0, strip.offset]}>` per strip
  containing: the wall mesh; opening fills, sills, surrounds, stoop filtered
  by bay; the strip's cornice and parapet segments.
- `CorniceSegment({ layout, trimColor, x0, x1, projectLeft, projectRight })`
  replaces `Cornice`: per step box, side projection `b.p` applies only where
  `projectLeft`/`projectRight` (outer facade ends);
  `width = (x1 − x0) + pl + pr`, `centerX = (x0 − pl + x1 + pr) / 2`, z math
  unchanged. First strip passes `x0 = strip.x0 − ml`, last `x1 = strip.x1 + mr`;
  internal ends butt flush (no side projection — same-offset neighbors would
  z-fight otherwise).
- Parapet body per strip: `width = x1 − x0`, `centerX = (x0 + x1)/2` (with
  ml/mr folded into x0/x1 at the outer strips). Coping: side extension 0.05
  only at `projectLeft`/`projectRight` ends, depth `WALL_THICKNESS + 0.1`
  unchanged.
- Single flush strip must reproduce v4 numbers exactly:
  `x0 − ml = −w/2 − ml`, `x1 + mr = w/2 + mr` → widths/centers identical to
  the old `(mr − ml)/2` formulation.

- [ ] Implement; run gates; screenshot-free (owner checks visually). Commit
  `feat(facade): render section strips — offset wall groups, stepped cornice/parapet`.

---

### Task 4: corners — flatten corner-side end sections

**Files:** `src/lib/facade/corners.ts`, `src/lib/facade/corners.test.ts`

- [ ] **Step 1: failing tests** — append to `corners.test.ts` (reuse its
  `mkBlock` helper; give lots sections via `params` spread):

```ts
describe("syncCorners section flattening", () => {
  const withSections = (
    b: FacadeBlock,
    lotIndex: number,
    sections: { bays: number; offset: number }[],
    symmetrical = false,
  ): FacadeBlock => ({
    ...b,
    lots: b.lots.map((l, i) =>
      i === lotIndex
        ? {
            ...l,
            params: {
              ...l.params,
              bays: 3,
              sections,
              sectionsSymmetrical: symmetrical,
            },
          }
        : l,
    ),
  });

  it("zeroes the corner-side end section's offset on both sides", () => {
    let A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
    let B = mkBlock("B", [10, 0], [10, 10], [5, 5]);
    // A's corner lot is index 1, corner at its RIGHT end
    A = withSections(A, 1, [
      { bays: 1, offset: 0.1 },
      { bays: 1, offset: 0 },
      { bays: 1, offset: -0.1 },
    ]);
    // B's corner lot is index 0, corner at its LEFT end
    B = withSections(B, 0, [
      { bays: 1, offset: 0.12 },
      { bays: 2, offset: 0 },
    ]);
    const out = syncCorners([A, B], new Map(), 150);
    const aSecs = out[0].lots[1].params.sections!;
    expect(aSecs.map((s) => s.offset)).toEqual([0.1, 0, 0]); // right end zeroed
    const bSecs = out[1].lots[0].params.sections!;
    expect(bSecs.map((s) => s.offset)).toEqual([0, 0]); // left end zeroed
  });

  it("symmetric corner lot zeroes stored[0] (resolve mirrors it to the far end)", () => {
    let A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
    const B = mkBlock("B", [10, 0], [10, 10], [5, 5]);
    A = withSections(
      A,
      1,
      [
        { bays: 1, offset: 0.1 },
        { bays: 1, offset: -0.1 },
        { bays: 1, offset: 0.1 },
      ],
      true,
    );
    const out = syncCorners([A, B], new Map(), 150);
    const secs = out[0].lots[1].params.sections!;
    expect(secs[0].offset).toBe(0);
    expect(secs[1].offset).toBe(-0.1); // middle relief survives
  });

  it("is idempotent and returns identity when end sections are already flush", () => {
    let A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
    const B = mkBlock("B", [10, 0], [10, 10], [5, 5]);
    A = withSections(A, 1, [
      { bays: 2, offset: 0 },
      { bays: 1, offset: 0 },
    ]);
    const once = syncCorners([A, B], new Map(), 150);
    const twice = syncCorners(once, new Map(), 150);
    expect(twice).toBe(once);
  });

  it("non-corner lots keep their sections untouched", () => {
    let A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
    const B = mkBlock("B", [10, 0], [10, 10], [5, 5]);
    A = withSections(A, 0, [
      { bays: 1, offset: 0.15 },
      { bays: 2, offset: -0.15 },
    ]);
    const before = A.lots[0].params.sections;
    const out = syncCorners([A, B], new Map(), 150);
    expect(out[0].lots[0].params.sections).toBe(before);
  });
});
```

(Adjust imports at the top of the test file if `syncCorners` isn't already
imported there.)

- [ ] **Step 2: implement** in `corners.ts` — module-private helper +
  `patchLot` rework:

```ts
/** A corner-side END section with nonzero offset would shear the miter
 * joint open (miters assume flush slabs), so sync flattens it — the exact
 * depthOffset precedent: destructive, not restored on dissolve, never marks
 * `customized`. Sections stay per-frontage otherwise (FACE, not shell).
 * For symmetric lots the stored FIRST section is zeroed — resolveSections
 * mirrors stored[0] onto the far end, so both ends sit flush and the
 * symmetric composition survives. Identity return when already flush. */
function flattenEndSection(
  params: FacadeParams,
  lotSide: "left" | "right",
): FacadeParams {
  const secs = params.sections;
  if (!secs || secs.length === 0) return params;
  const count = Math.min(secs.length, params.bays);
  const idx =
    lotSide === "left" || params.sectionsSymmetrical ? 0 : count - 1;
  if (!secs[idx] || secs[idx].offset === 0) return params;
  return {
    ...params,
    sections: secs.map((s, i) => (i === idx ? { ...s, offset: 0 } : s)),
  };
}
```

`patchLot` becomes (same call sites, `side` already carries `lotSide`):

```ts
  const patchLot = (
    side: CornerSide,
    params: FacadeParams | null,
    zeroDepth: boolean,
  ) => {
    const block = get(side.blockId);
    const lot = block.lots[side.lotIndex];
    const merged = flattenEndSection(params ?? lot.params, side.lotSide);
    const paramsChanged = merged !== lot.params;
    const needsDepth = zeroDepth && (lot.depthOffset ?? 0) !== 0;
    if (!paramsChanged && !needsDepth) return;
    const lots = block.lots.map((l, i) =>
      i === side.lotIndex
        ? { ...l, params: merged, ...(needsDepth ? { depthOffset: 0 } : {}) }
        : l,
    );
    work.set(side.blockId, { ...block, lots });
  };
```

- [ ] **Step 3:** gates (all corner tests incl. existing idempotence must
  stay green). Commit `feat(facade): corners flatten end-section offsets so miters stay closed`.

---

### Task 5: controls — "Sections" group in the lot inspector

**Files:** `src/components/facade/FacadeControls.tsx`

- [ ] Add imports: `resolveSections`, `SECTION_OFFSET_MAX` from
  `@/lib/facade/layout`; `withSectionCount`, `withSectionOffset`,
  `withSectionBays`, `withSectionsSymmetry` from `@/lib/facade/sections`.
- [ ] Insert a new `<Section title="Sections">` between "Bays & Openings"
  and "Ground Floor" (lot view only):

```tsx
      <Section title="Sections">
        <SliderRow
          label="Sections"
          value={sections.length}
          display={`${sections.length}`}
          min={1}
          max={params.bays}
          step={1}
          onChange={(n) =>
            onChange({ ...withSectionCount(params, n), preset: undefined })
          }
        />
        {sections.length >= 2 && (
          <>
            <Toggle
              label={params.sectionsSymmetrical ? "Symmetrical: on" : "Symmetrical: off"}
              on={!!params.sectionsSymmetrical}
              onClick={() =>
                onChange({
                  ...withSectionsSymmetry(params, !params.sectionsSymmetrical),
                  preset: undefined,
                })
              }
            />
            {sections.map((s, i) => (
              <div key={i} className="rounded bg-[var(--border)]/40 p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[var(--muted)]">
                    S{i + 1} · {s.bays} bay{s.bays > 1 ? "s" : ""}
                  </span>
                  {!params.sectionsSymmetrical && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label={`Shrink section ${i + 1}`}
                        onClick={() =>
                          onChange({
                            ...withSectionBays(params, i, -1),
                            preset: undefined,
                          })
                        }
                        className="w-5 h-5 rounded bg-[var(--border)] text-zinc-400 hover:text-zinc-200 text-[11px] leading-none"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        aria-label={`Grow section ${i + 1}`}
                        onClick={() =>
                          onChange({
                            ...withSectionBays(params, i, 1),
                            preset: undefined,
                          })
                        }
                        className="w-5 h-5 rounded bg-[var(--border)] text-zinc-400 hover:text-zinc-200 text-[11px] leading-none"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
                <SliderRow
                  label="Offset"
                  value={s.offset}
                  display={`${s.offset > 0 ? "+" : ""}${Math.round(s.offset * 100)}cm`}
                  min={-SECTION_OFFSET_MAX}
                  max={SECTION_OFFSET_MAX}
                  step={0.01}
                  onChange={(o) =>
                    onChange({
                      ...withSectionOffset(params, i, o),
                      preset: undefined,
                    })
                  }
                />
              </div>
            ))}
          </>
        )}
      </Section>
```

with `const sections = resolveSections(params);` next to the existing
`const L = FACADE_LIMITS;`. Note: bay steppers are hidden in symmetric mode
(spec decision — symmetric partitions come from count + mirroring); no-op
edits (`withSectionBays` at min) simply re-store identical params.

- [ ] Gates. Commit `feat(facade): sections panel — count, symmetry toggle, per-section bays/offset`.

---

### Task 6: AI prompt — spec fields, mapping, local parser

**Files:** `src/app/api/facade-prompt/route.ts`, `src/app/facade/page.tsx`,
`src/lib/facade/prompt-parser.ts`, `src/lib/facade/prompt-parser.test.ts`

- [ ] **Step 1: failing parser tests** — append to `prompt-parser.test.ts`:

```ts
describe("sections keywords", () => {
  it("parses a section count as equal-weight sections", () => {
    const u = parseFacadePromptLocal("3 sections");
    expect(u.sections).toHaveLength(3);
    expect(u.sections!.every((s) => s.offset === 0)).toBe(true);
  });

  it("recessed center emits a symmetric center pattern (default 3)", () => {
    const u = parseFacadePromptLocal("recessed centre");
    expect(u.sections!.map((s) => s.offset < 0)).toEqual([false, true, false]);
    expect(u.sectionsSymmetrical).toBe(true);
  });

  it("projecting center with an explicit count", () => {
    const u = parseFacadePromptLocal("5 sections with a projecting center");
    expect(u.sections).toHaveLength(5);
    expect(u.sections![2].offset).toBeGreaterThan(0);
  });

  it("symmetrical / asymmetrical set the flag", () => {
    expect(parseFacadePromptLocal("symmetrical facade").sectionsSymmetrical).toBe(true);
    expect(parseFacadePromptLocal("asymmetrical facade").sectionsSymmetrical).toBe(false);
  });
});
```

- [ ] **Step 2: parser** — in `parseFacadePromptLocal` (after the window
  glazing block; import `SECTION_PATTERN_OFFSET` from `./sections`):

```ts
  // Sections: count and/or a named center pattern. Equal-weight entries —
  // resolveSections refits them to the actual bay count proportionally.
  const sectionMatch = lower.match(/(\d+)\s*sections?/);
  const recessedCenter = /recess(?:ed)?\s+cent(?:er|re)|cent(?:er|re)\s+recess/.test(lower);
  const projectedCenter = /project(?:ed|ing)?\s+cent(?:er|re)|cent(?:er|re)\s+project/.test(lower);
  if (sectionMatch || recessedCenter || projectedCenter) {
    const n = Math.max(
      sectionMatch ? clampInt(parseInt(sectionMatch[1]), 1, 9) : 1,
      recessedCenter || projectedCenter ? 3 : 1,
    );
    const mid1 = Math.floor((n - 1) / 2);
    const mid2 = Math.ceil((n - 1) / 2);
    updates.sections = Array.from({ length: n }, (_, i) => ({
      bays: 1,
      offset:
        i >= mid1 && i <= mid2 && (recessedCenter || projectedCenter)
          ? recessedCenter
            ? -SECTION_PATTERN_OFFSET
            : SECTION_PATTERN_OFFSET
          : 0,
    }));
    if (recessedCenter || projectedCenter) updates.sectionsSymmetrical = true;
  }
  if (/\basymmetric(?:al)?\b/.test(lower)) updates.sectionsSymmetrical = false;
  else if (/\bsymmetric(?:al)?\b/.test(lower)) updates.sectionsSymmetrical = true;
```

(`mergeFacadeParams` needs no change — `sections` and `sectionsSymmetrical`
are top-level replace-merges.)

- [ ] **Step 3: route** — add to the `FacadeSpec` zod object:

```ts
  // Sections: vertical strips of whole bays with small forward/back relief.
  sections: z.number().int().min(1).max(9),
  sectionPattern: z.enum([
    "custom",
    "flush",
    "recessed-center",
    "projected-center",
    "alternating",
  ]),
```

System prompt: add to the "Current facade" block
`` `- sections: ${have.sections ?? 1}, sectionPattern: ${have.sectionPattern ?? "flush"}` ``
and to "Meanings":

```
"- sections: the facade divides into that many vertical strips of whole bays; sectionPattern names the relief (recessed-center / projected-center / alternating; flush = no relief; custom = user-sculpted — echo it unless the user asks about sections or relief).",
```

- [ ] **Step 4: page mapping** — `FacadeSpec` interface gains
  `sections?: number; sectionPattern?: SectionPattern`. Imports:
  `resolveSections` from `@/lib/facade/layout`; `withSectionCount`,
  `applySectionPattern`, `classifySectionPattern`, `type SectionPattern`
  from `@/lib/facade/sections`.

  `paramsToFacadeSpec` adds:

```ts
    sections: resolveSections(p).length,
    sectionPattern: classifySectionPattern(p),
```

  `specToFacadeParams`, after the ornament block (bays already applied):

```ts
  // Sections: count applies only when it differs; a NAMED pattern applies
  // when it differs or the count changed. "custom" is the echo value and
  // never touches the user's sculpted offsets.
  const curCount = resolveSections(next).length;
  const curPattern = classifySectionPattern(next);
  const wantCount = spec.sections ?? curCount;
  const wantPattern = spec.sectionPattern ?? "custom";
  if (
    wantPattern !== "custom" &&
    (wantPattern !== curPattern || wantCount !== curCount)
  ) {
    next = applySectionPattern(next, wantCount, wantPattern);
  } else if (wantCount !== curCount) {
    next = withSectionCount(next, wantCount);
  }
```

  Add one suggestion chip: `"3 sections, projecting centre"` (replace none —
  append to `FACADE_SUGGESTIONS`).

- [ ] **Step 5:** gates. Commit `feat(facade): sections in the AI prompt — count + named relief patterns`.

---

### Task 7: docs + self-review

- [ ] `AGENTS.md`: facade-designer section gains a `- **Sections**: …` bullet
  (bay-partitioned strips, offsets, symmetry, `sections.ts` in the file
  layout, tests line mentions sections).
- [ ] Fresh-eyes self-review of the whole branch diff against the spec and
  the repo failure modes: Strict Mode purity (no mutation of props/params),
  determinism (no Math.random), identity-return idempotence (`syncCorners`,
  helpers' no-op paths), geometry disposal, byte-identity of the
  no-sections path, dark-theme-only styling, no colored edge accents.
- [ ] Full gates one last time. Commit fixes + docs:
  `docs: AGENTS.md sections; self-review fixes`.
