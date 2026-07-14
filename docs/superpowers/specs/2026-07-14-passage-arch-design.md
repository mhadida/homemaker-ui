# Pass-through carriage arch — design

**Date:** 2026-07-14
**Feature tag:** v16
**Status:** approved (pierced-mass see-through), ready for implementation

## Goal

A ground-floor treatment **"passage"** — a tall segmental/round carriage arch
at the door bay, an alternative to the garage door — that is a **real
pass-through**: the void runs front-to-back through the whole building mass, so
you see daylight through the arch to behind (the "inner courtyard" side).

Chosen scope (from the design fork): **pierced mass** — split the per-lot
massing box into two piers + a lintel around a rectangular tunnel void; the
facade shows an arched opening. Modeling the enclosed courtyard is deferred.

## Mechanics (grounded in the code)

- The facade wall is an `ExtrudeGeometry` whose `shape.holes` are punched from
  `layout.openings` (`FacadeMesh.buildStripGeometry`). So a passage opening
  makes the WALL see-through for free — we only additionally pierce the mass.
- The massing is one wall-colored box per section strip
  (`FacadeMesh`, ~line 486). The passage sits in the strip containing the door
  bay; we split that strip's box into piers + lintel around the tunnel.

## Pure layout (`src/lib/facade/layout.ts`)

- `OpeningRect.arched?: boolean` — passage openings render an arched (round-
  headed) wall hole instead of a rectangle.
- New constants: `PASSAGE_WIDTH_MAX = 3.2`, `PASSAGE_HEAD_GAP = 0.25`
  (wall above the arch crown within the ground storey), `PASSAGE_MIN_SIDE =
  1.4` (min straight jamb below the springline).
- `resolveGrid`: at the door bay, `treatment === "passage"` → kind `"passage"`.
- Opening geometry for `"passage"`: `w = min(PASSAGE_WIDTH_MAX, maxW)`;
  `h = min(sh − PASSAGE_HEAD_GAP, …)` (tall — nearly the full ground storey);
  arch radius `r = min(w/2, h − PASSAGE_MIN_SIDE)` (round head, jambs never
  shorter than PASSAGE_MIN_SIDE); `x = bayCenter − w/2`, `y = floorY`,
  `arched = true`. Skip (fall through to no opening) if `w` or `h` too small.
- `PassagePlan { x0, x1, top }` + `FacadeLayout.passage: PassagePlan | null`.
  `computeLayout` sets it from the passage opening: `x0 = o.x`,
  `x1 = o.x + o.w`, `top = o.y + o.h` (the tunnel clears the arch crown).
  null when no passage.

## Mesh (`src/components/facade/FacadeMesh.tsx`)

- `buildStripGeometry`: for an `arched` opening, build a round-headed hole
  (`Path`: up the jambs to the springline `y + h − r`, then
  `absarc(cx, springline, r, 0, π)` over the top).
- Massing split: when `layout.passage` falls within the current strip's band
  `[bandX0, bandX1]`, render **left pier** (`bandX0…x0`), **right pier**
  (`x1…bandX1`), and a **lintel** (`x0…x1`, from `passage.top` to `wallTop`)
  instead of one box — all at the strip's depth. A thin dark **tunnel floor**
  (cobbles) runs the depth so the passage reads as a floor, not a hole.
- `PassageFill`: a stone **keystone** at the crown + **impost** blocks at the
  springline (trim-colored), for carriage-arch character. The arched wall
  hole + piers provide the reveal.
- Switch: `case "passage": return <PassageFill … />`.

## Controls + prompt

- `FacadeControls`: add **Passage** to the ground-treatment toggle
  (residential / shopfront / garage / passage).
- `prompt-parser`: keywords `passage`, `tunnel`, `carriage arch`,
  `porte cochere`, `pass-through` → `groundFloor.treatment = "passage"`.

## Generation

Unchanged — passage stays a deliberate (manual/prompt) choice, so seed
determinism and existing tests are untouched.

## Byte-identical invariant

`treatment` never defaults to passage; `arched`/`passage` are absent for every
existing lot (`arched` undefined → rectangular hole; `layout.passage` null →
single massing box). No existing scene changes.

## Tests (`src/lib/facade/layout.test.ts`)

- passage treatment → the door bay's ground cell is kind `"passage"`, `arched`
  true, and `layout.passage` is non-null with `x0/x1` matching the opening and
  `top === o.y + o.h`.
- non-passage treatments → `layout.passage` is null and no opening is `arched`
  (byte-identical guard).
- the arch radius clamps so jambs ≥ PASSAGE_MIN_SIDE on a short storey.
