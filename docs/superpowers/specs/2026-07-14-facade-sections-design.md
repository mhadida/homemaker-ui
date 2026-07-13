# Facade Sections — Design Spec (v5)

**Date:** 2026-07-14
**Status:** Implemented on `feature/facade-sections` (owner reviews with browser checkpoints)
**Depends on:** v4 corner buildings (`syncCorners` choke point, miters), v1 layout
engine (bay grid, all-clamps-in-layout philosophy).

## Purpose

User requirement (verbatim): *"i also want to be able to divide any one facade
into a number of sections. 1 bay 2 bay 3 bay buildigns etc. symmetrical or
asymmetrical toggle. bays can be offset perpendicular to street."*

A SECTION subdivides one lot's facade horizontally into vertical strips, each
spanning a whole number of consecutive bays, each with its own small
perpendicular relief offset (± toward/away from the street). Sections create
relief WITHIN a single building — projecting center-pieces, recessed entrance
bays — at the same visual scale as the existing per-lot `depthOffset`.

## Decisions

| Question | Decision |
|---|---|
| What is a section measured in? | **Whole bays.** A section spans N consecutive bays (`FacadeSection.bays`). The (storeys × bays) grid model — BayGrid, `cellOverrides`, `doorBay`, the AI surface — is untouched; bay indices never shift. Free-width (metre-measured) sections were rejected: they would fork the grid model into per-section grids. |
| Offset range | `SECTION_OFFSET_MAX = 0.15` m, signed (+ = street-proud). Matches the per-lot depthOffset scale, and guarantees the max relative step between neighbors (0.30 m) stays below `WALL_THICKNESS` (0.35 m), so adjacent wall slabs always overlap in depth — the geometry is closed with no extra stitching. |
| Where do clamps/normalization live? | **In the layout engine**, per repo philosophy (`doorBay` precedent: stale values are harmless because layout clamps). `resolveSections(params)` in `layout.ts` is the single sanitizer: stale partitions (after bay-count changes), over-long lists, out-of-range offsets, and the symmetry rule are all resolved there, deterministically. Stored `sections` may be stale; the render never is. |
| Absent sections | `params.sections` undefined/empty → one full-width flush section. Today's geometry byte-identical (single extrusion, offset 0, same cornice/parapet extents). |
| Bay-count changes (slider, unified-corner rhythm sync) | Stored partition re-fits **proportionally** at resolve time: quotas `bays_i·newTotal/oldTotal`, largest-remainder rounding, minimum 1 bay per section, section count capped at the bay count. Deterministic; no stored rewrite needed. |
| Lot width changes (slider, refit/node drag) | **Sections survive for free** — they are measured in bays, so their metre widths scale with `width/bays` automatically. Zero code; this is why the bay-partition model wins. |
| Symmetrical toggle | `params.sectionsSymmetrical: boolean`. Enforced at resolve time so flipping it is live: offsets of the right half mirror the left half exactly; bay counts mirror as closely as integer bays allow (left half wins; the middle section — odd counts — absorbs the remainder; even counts adjust the innermost pair, with any odd leftover bay going to the innermost right section). Sum is always preserved. The UI additionally writes canonical (already-symmetrized) arrays so stored state = rendered state after any panel edit (WYSIWYG; the pre-symmetric values are not archived). |
| Anti-coplanarity at boundaries | At a boundary between sections with different offsets, the **more recessed** section's wall strip extends `SECTION_LAP = 0.05` m under the prouder neighbor, so the two side faces at the boundary plane are never coplanar (same trick as the corner concave trim, inverted). 0.05 < the smallest opening-to-bay-edge margin (`SHOPFRONT_MULLION` = 0.06; all other kinds keep ≥ `MIN_PIER`/2 = 0.15), so a lap can never touch an opening. Equal-offset boundaries butt exactly (coincident internal faces are never visible). Outer facade edges are never lapped. |
| Do cornice/parapet step with the offsets? | **Yes — they step.** Each section renders its own cornice boxes / parapet / coping at that section's offset, spanning the section's strip (lap included). Reads as a real projecting bay whose molding returns around the step. Side projection of the cornice (the `projection` beyond the wall ends) applies **only at the two outer facade ends** — internal segment ends butt flush, otherwise same-offset neighbors' cornice boxes would overlap and z-fight. |
| Openings, sills, surrounds, stoop | Move with their section (rendered inside the section's z-offset group). Layout annotates sill entries and the stoop with their `bay` so the mesh can assign them blindly. Corner miter extensions (`ml`/`mr`) apply to the first/last section's strip only. |
| Sections × corners | Sections are **FACE, not shell** — per-frontage, never synced across a corner (same lossy-bay-indexing argument as `cellOverrides`; not mirrored even in unified mode). But a corner-side END section with nonzero offset would shear the miter joint open (the miter math assumes flush slabs), so `syncCorners` **flattens the corner-side end section's offset to 0** — data-level, the exact precedent of depthOffset zeroing (destructive, not restored on dissolve, never marks `customized`). When the lot is symmetric-sectioned, the stored FIRST section is zeroed (resolve mirrors it), so both end sections sit flush — the symmetric composition survives. |
| Generator/reroll | The street generator does **not** emit sections (generated lots have `sections` undefined). Sections are a hand-design gesture; reroll of an unpinned lot therefore clears them, and pinned (customized) lots keep them wholesale — both fall out of existing code with zero changes. |
| Section editing helpers | New pure module `src/lib/facade/sections.ts`: canonical-write helpers shared by the panel UI and the AI mapping — `withSectionCount` (even split, offsets preserved by index; count 1 clears `sections`), `withSectionBays` (steal-from-neighbor stepper), `withSectionOffset`, `withSectionsSymmetry` (toggle + canonicalize), `applySectionPattern`, `classifySectionPattern`. All operate on **resolved** sections and write back canonical arrays. |
| UI | Lot inspector gains a "Sections" group (after Bays & Openings): section-count slider (1..bays), Symmetrical toggle (count ≥ 2), and per-section rows — bay stepper (− n +) and offset slider (−15…+15 cm). Symmetric mode edits write the symmetrized array, so mirrored controls visibly move together. Every edit clears `preset` (convention). BayGrid unchanged. |
| AI prompt | Two flat fields added to `FacadeSpec` (arrays avoided, optionals impossible): `sections` (int 1–9, count) and `sectionPattern` (`"custom" | "flush" | "recessed-center" | "projected-center" | "alternating"`). `"custom"` is the echo/no-touch value — `paramsToFacadeSpec` classifies the current offsets and reports `"custom"` when they match no named pattern; `specToFacadeParams` applies count only when it differs and pattern only when it's named and differs. Local keyword parser gains "N sections", "recessed/projected center" and "symmetrical". |

## Data model

`src/lib/facade/types.ts`:

```ts
export interface FacadeSection {
  /** Consecutive bays this section spans (>= 1). Stale partitions are
   * refit proportionally by the layout engine, so any stored value is
   * harmless (doorBay precedent). */
  bays: number;
  /** Perpendicular relief along the facade normal, metres; + is
   * street-proud. Clamped to ±SECTION_OFFSET_MAX by the layout engine. */
  offset: number;
}

interface FacadeParams {
  // ... existing fields ...
  /** Optional horizontal partition of the facade into offset strips.
   * Absent/empty = one full-width flush section (byte-identical to v4). */
  sections?: FacadeSection[];
  /** Mirror section bays/offsets around the facade center (enforced at
   * resolve time — the toggle is live). */
  sectionsSymmetrical?: boolean;
}
```

`src/lib/facade/layout.ts`:

```ts
export const SECTION_OFFSET_MAX = 0.15; // m
export const SECTION_LAP = 0.05;        // m, anti-coplanar underlap

export interface ResolvedSection {
  startBay: number;  // first bay index (inclusive)
  bays: number;      // >= 1
  offset: number;    // clamped
}
/** THE sanitizer — sanitize, cap count at bays, proportional refit to
 * sum === bays, then symmetry enforcement. Total and deterministic. */
export function resolveSections(params: FacadeParams): ResolvedSection[];

export interface SectionStrip extends ResolvedSection {
  x0: number;  // wall strip left edge (lap included; first strip = -width/2)
  x1: number;  // wall strip right edge (lap included; last strip = +width/2)
}
interface FacadeLayout {
  // ... existing fields ...
  sections: SectionStrip[];              // length >= 1, covers full width
  sills: { x; y; w; bay: number }[];     // bay added — section assignment
  stoop: { ...; bay: number } | null;    // bay added — section assignment
}
```

### resolveSections algorithm (normative)

1. Empty/absent → `[{ startBay: 0, bays, offset: 0 }]`.
2. Sanitize each entry: `bays = max(1, round(s.bays))`, `offset = clamp(s.offset, ±SECTION_OFFSET_MAX)`.
3. Cap the section count at `params.bays` (truncate the tail).
4. If `Σbays ≠ params.bays`: proportional refit — quotas `bays_i · params.bays / Σ`,
   floor with a minimum of 1, then distribute the shortfall by largest fractional
   remainder (ties → lower index), or repeatedly decrement the largest section
   > 1 (ties → higher index) on overshoot. Sum lands exactly on `params.bays`.
5. If `sectionsSymmetrical` and count ≥ 2: right half takes the left half's
   offsets and bay counts (left wins). Odd count: the middle section absorbs
   `params.bays − 2·Σleft`, borrowing from the innermost left sections
   (decrement, +2 each) while it would fall below 1. Even count: the innermost
   pair absorbs `⌊rem/2⌋` each (cascading outward when a shrink would hit 0),
   and an odd leftover bay lands on the innermost RIGHT section (an even
   section count over an odd bay total has no exact palindrome).
6. `startBay` = running sum.

### Wall strips

Boundary `xb` between resolved sections i, i+1 sits on the bay line
`-width/2 + (startBay_{i+1})·bayWidth`. Strips:

- `offset_i < offset_{i+1} − ε` (i recessed): `x1_i = xb + SECTION_LAP`, `x0_{i+1} = xb`
- `offset_i > offset_{i+1} + ε` (i proud):    `x1_i = xb`, `x0_{i+1} = xb − SECTION_LAP`
- else (flush pair): both exactly `xb`

`ε = 1e-9`. First strip `x0 = −width/2`, last strip `x1 = +width/2` (miter
extensions are a mesh concern, applied to the outer strips only).

## Mesh (`FacadeMesh.tsx`)

One `<group position={[0, 0, sec.offset]}>` per `SectionStrip` containing:

- the strip's wall `ExtrudeGeometry` (outline `x0−(first?ml:0)` … `x1+(last?mr:0)`,
  holes = openings whose `bay` falls in the strip; all geometries disposed in
  one effect, same leak rule as v1),
- opening fills / sills / surrounds / stoop whose `bay` falls in the strip,
- the strip's cornice boxes and parapet + coping (side projection only at the
  outer facade ends).

A single flush strip reproduces v4 output byte-identically.

## Corners (`corners.ts`)

`flattenEndSection(params, lotSide)` (module-private): identity when
`sections` is absent/empty or the end offset is already 0; otherwise returns
new params with the stored end section's offset zeroed — stored index 0 for
`lotSide "left"`; for `"right"`, index `min(len, bays) − 1`, **or index 0 when
`sectionsSymmetrical`** (resolve mirrors stored[0] onto the right end).
Called inside `patchLot` for both corner sides on every sync, so it re-heals
after any later edit. Preserves `syncCorners` idempotence and identity-return.

## AI prompt

`FacadeSpec` gains (flat, fully-required — OpenAI structured output rejects
optionals):

```ts
sections: z.number().int().min(1).max(9),
sectionPattern: z.enum(["custom", "flush", "recessed-center",
                        "projected-center", "alternating"]),
```

- Echo: `paramsToFacadeSpec` reports the resolved count and
  `classifySectionPattern(params)` (`"custom"` when offsets match no named
  pattern; `"flush"` when count is 1 or all offsets ≈ 0).
- Apply: count applied via `withSectionCount` only when ≠ current count;
  pattern applied via `applySectionPattern` only when named and ≠ current.
  Patterns use ±0.12 m offsets; center patterns set
  `sectionsSymmetrical: true`, `alternating` sets it false, `flush` only
  zeroes offsets.
- Local parser: `"N sections"` → N equal-weight sections; `"recessed
  center"`/`"projected center"` → 3-section center pattern (count from the
  prompt when given); `"symmetrical"` → flag.

## Testing (vitest — pure modules only)

- `resolveSections`: absent → single flush strip; sanitize (round bays, clamp
  offsets); count cap; proportional refit (sum exact, min 1, determinism);
  symmetry — offsets mirror, odd-count middle absorption incl. all-1s floor,
  even-count innermost adjustment incl. odd-bays leftover, sum preserved.
- strips: boundaries on bay lines; lap on the recessed side only; flush pairs
  butt exactly; outer edges unlapped; every opening rect inside its own
  strip's `[x0, x1]`; layout invariants (existing helper) hold with sections.
- sills/stoop carry `bay`.
- byte-identity: `computeLayout` with `sections` undefined equals the v4
  output for every existing test (existing suite unchanged = the proof).
- `sections.ts` helpers: withSectionCount (even split, offset preservation,
  count-1 clears), withSectionBays (neighbor stealing, clamps, last-section
  borrows left), withSectionOffset (+ symmetric mirroring), pattern
  apply/classify round-trips.
- `corners.ts`: corner-side end-section offset zeroed on both sides;
  symmetric lot zeroes stored[0]; identity/idempotence preserved; non-corner
  lots' sections untouched.
- parser: "3 sections", "recessed center", "symmetrical".

UI (section rows, steppers, live symmetry toggle) and stepped
cornice/parapet geometry are verified visually in the browser.

## Not in scope (deferred)

- Generator-emitted sections (streetscape relief variety per lot) — the
  hooks exist (`gen` settings + `generateLot`), deliberate follow-up.
- Per-storey sections (setbacks/upper-floor recesses) — sections span full
  height in v5.
- Section-boundary visualization in BayGrid (column grouping tint).
- AI emission of arbitrary per-section offset arrays (only count + named
  patterns ship; `"custom"` passes through).
- Cornice returns wrapping the step reveal as separate molding pieces (the
  stepped boxes read correctly at ±15 cm).
