# Door Head Alignment + Transom — Design Spec (v2 sub-project A)

**Date:** 2026-07-09
**Status:** Approved by user (brainstorming session)
**Depends on:** facade designer v1 (merged). Independent of sub-projects B and C.

## Purpose

Ground-floor doors currently cap at 2.3 m regardless of context, while window
heads on a tall ground storey sit visibly higher — the door reads short. The
door opening should stretch so its head aligns with the storey's window heads,
and when the opening gets tall, the extra height becomes a glazed transom
above a fixed-height door leaf.

## Decisions

| Question | Decision |
|---|---|
| Leaf/transom split | Fixed leaf + transom fills the rest (not ratio-based, not transom-always) |
| Leaf height | `DOOR_LEAF_HEIGHT = 2.1` m constant |
| Transom threshold | Transom exists iff opening height ≥ leaf + `TRANSOM_MIN = 0.3` m (i.e. ≥ 2.4 m); below that the leaf stretches to fill the opening, no sliver transoms |
| Shrinking | Never — alignment only grows the door relative to the current rule |
| Data shape | One wall opening (one hole); door `OpeningRect` gains optional `transomH?: number` |

## Layout engine (`src/lib/facade/layout.ts`)

All geometry in the pure layer; the mesh renders what it's given.

- **Alignment target** for a `door` cell:
  - Row has `window` cells → the same storey's window head:
    `floorY + SILL_HEIGHT + windowH`, where `windowH` uses the exact clamp
    formula windows use in that storey.
  - Shopfront ground row (no windows) → shopfront glazing head:
    `floorY + storeyHeight − SHOPFRONT_FASCIA`.
  - Neither (e.g. all-blank row) → keep the current rule.
- **Never-shrink rule**: door height =
  `max(current rule: min(2.3, sh − DOOR_HEAD_GAP − stoopRise), alignedHead − doorY)`,
  then capped by the existing head-gap clamp. Doors never get shorter than
  they are today.
- **Transom emission**: if final opening height ≥ `DOOR_LEAF_HEIGHT + TRANSOM_MIN`,
  set `transomH = height − DOOR_LEAF_HEIGHT` on the opening. The leaf occupies
  the bottom `DOOR_LEAF_HEIGHT`.
- **Stoop interaction**: door bottom (and therefore the leaf) measures from the
  raised threshold as today; the alignment target is unchanged by the stoop.
- Applies to `door` kind cells anywhere they occur. `garage` unchanged.

## Mesh (`src/components/facade/FacadeMesh.tsx`)

`DoorFill` renders, when `transomH` is present:
- door leaf panel (existing panel + knob) in the bottom `DOOR_LEAF_HEIGHT`,
- a horizontal frame bar between leaf and transom (trim color, like window
  frame members),
- glazed transom above (same glass material treatment as windows).

Without `transomH`, the current rendering fills the (possibly taller) opening.

## Testing (vitest, extends `src/lib/facade/layout.test.ts`)

- Tall ground floor (e.g. 3.4 m, windows at default ratios): door head equals
  window head; `transomH` present and equals opening − 2.1.
- Opening just below 2.4 m: no `transomH`; leaf fills the opening.
- Shopfront row: door head equals `sh − SHOPFRONT_FASCIA`.
- Squat storey with low window heads: door keeps the current rule (never
  shrinks).
- Stoop + transom together: leaf from raised threshold, invariants hold.
- All existing invariants (containment, non-overlap) still pass.

## Not in scope

Garage transoms; corner buildings; any UI change (no new controls — the rule
is automatic).
