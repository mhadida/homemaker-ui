# Corner Buildings — Design Spec (v4)

**Date:** 2026-07-13
**Status:** Approved by user (brainstorming session; "you're driving")
**Depends on:** v3 pen-tool streets (welded nodes, `refit`, nullable
selection). Corners build directly on derived welds.

## Purpose

Two street segments meeting at a welded node currently butt as separate
buildings. A corner building merges the two end lots into ONE building
wrapping the corner: shared shell (storeys, colors, ornament — cornice and
parapet run continuously around the corner), with the two frontages either
mirroring each other ("unified") or designed independently ("2 facades",
e.g. shop on the avenue, entrance on the side street).

## Decisions

| Question | Decision |
|---|---|
| Which junctions merge | Every welded node joining exactly TWO blocks whose turn angle ≤ the global max. Sharp turns merge too (user note: "sharp turns merge too") — the default max is permissive (150°), so kinks, right angles, and sharp corners all merge out of the box. 3+-way junctions never merge (deferred). |
| Tunable | One global `maxCornerAngle` dial (0–180°, default 150°), shown in the corner inspector. Turn = 180° − interior angle: 0° is straight-through, 90° a right angle. |
| Sharing model | **Shell shared, faces free.** Always shared in both modes: storeys, storeyHeight(s), wallColor, trimColor, ornament (cornice/parapet/sills/surrounds), windowStyle. Unified mode additionally mirrors the face: window ratios, ground treatment, bay rhythm. 2-facades mode leaves faces independent. |
| Controls | Corner node is selectable: clicking a merged corner's node opens a corner inspector (mode toggle, primary picker, global angle dial). Shell edits from either lot's panel sync across the pair. |
| Data model | Corners are DERIVED (like nodes); only decisions are stored, in a sparse map keyed by stable pair identity. |

## Data model: derived corners + sparse decisions

New pure module `src/lib/facade/corners.ts`:

```ts
export interface Corner {
  /** Sorted pair key — stable across drags, dies with block deletion. */
  key: string;                       // `${blockIdA}:${endA}|${blockIdB}:${endB}` (sorted)
  node: [number, number];
  a: { blockId: string; end: "a" | "b"; lotIndex: number };  // lot touching the node
  b: { blockId: string; end: "a" | "b"; lotIndex: number };
  /** Turn at the node in degrees: 0 = straight, 90 = right angle. */
  turn: number;
  /** True when the streets' facade sides make the corner convex (outer). */
  convex: boolean;
}

export interface CornerChoice {
  mode: "unified" | "two-facades";
  /** Which side is the design source in unified mode. */
  primary: "a" | "b";
}

export const DEFAULT_MAX_CORNER_ANGLE = 150;

detectCorners(blocks: FacadeBlock[], maxTurnDeg: number): Corner[]
// Shell fields copied by sync (single source of truth for "the shell"):
SHELL_FIELDS: readonly (keyof FacadeParams)[]
// = storeys, storeyHeight, storeyHeights, wallColor, trimColor, ornament, windowStyle
syncCorners(
  blocks: FacadeBlock[],
  choices: Map<string, CornerChoice>,
  maxTurnDeg: number,
  editedBlockId?: string,            // shell flows FROM this side; else from primary
): FacadeBlock[]
cornerChoice(choices: Map<string, CornerChoice>, corner: Corner): CornerChoice
// default: { mode: "two-facades", primary: wider frontage }
miterFor(corner: Corner, blocks: FacadeBlock[]): { a: MiterEnd; b: MiterEnd }
// MiterEnd = { end: "left" | "right"; extend: number } per lot, clamped
```

Page state gains `cornerChoices: Map<string, CornerChoice>` (sparse — only
corners the user actually configured) and `maxCornerAngle: number`.
`Selection.level` gains `"corner"` with `cornerKey`.

### Detection

For each derived node (from `deriveNodes`) with refs from exactly two
distinct blocks: turn = angle between the incoming direction of one block
and the outgoing direction of the other (both oriented THROUGH the node,
endpoint-aware and flip-aware via `blockFrame`). Corner when
`turn <= maxTurnDeg`. The end lots are `lotIndex 0` (frame origin at the
node) or `lots.length - 1` (frame end at the node).

**Continuous-frontage requirement (review finding, 2026-07-13):** the two
facades must lie on the SAME side when walking through the node (one
block's node-end at its frame origin, the other's at its frame end —
opposite `atOrigin` parity). When one street is flipped relative to the
chain, the frontages face away from each other diagonally: that junction
is not a corner building and never merges. This also makes convexity
well-defined — without the guard, the convex/concave sign is an artifact
of block-id sort order for mixed-parity junctions.

### Shell sync (one choke point)

Every `setBlocks` mutation path in the page (setParams, handleMoveNode,
handleCommitLine, handleReroll, handleGenChange side effects, Delete-key,
prompt) funnels its result through
`syncCorners(next, cornerChoices, maxCornerAngle, editedBlockId?)`:

- For each detected corner, copy `SHELL_FIELDS` from the source side (the
  edited block when given, else the choice's primary) to the partner's end
  lot. Copies preserve the partner's `width` and everything not in the
  shell. The partner lot is NOT marked `customized` by sync (sync is
  derived state, not a hand edit); the source side's pinning is untouched.
- In `unified` mode additionally copy: `windowWidthRatio`,
  `windowHeightRatio`, `groundFloor` (doorBay clamped to the partner's
  bays), and bay RHYTHM: `partner.bays = clamp(round(partnerWidth /
  (sourceWidth / sourceBays)), 1, 9)` — same beat, different width.
  `cellOverrides` are NOT mirrored (bay-indexed, lossy across widths);
  they remain per-frontage.
- Sync is idempotent (running it twice changes nothing) and cheap
  (corners are few; fields are scalars).

### Geometry: the corner meets

Today the two end walls stop at the party-wall plane, leaving a wedge gap
(convex) or interpenetration (concave). With a corner active:

- Each frontage's wall extends/trims so the two wall SLABS meet at the
  bisector plane of the corner. Implementation: per-lot end extension
  `extend = clamp(tan(turnRad / 2) * WALL_THICKNESS, 0, 3 * WALL_THICKNESS)`
  applied to the wall shape's mitered end (convex: extend outward to close
  the wedge; concave: negative — trim — so slabs don't z-fight). Computed in
  `miterFor`, consumed by `FacadeMesh` via a new optional `miter` prop
  (`{ left?: number; right?: number }` metres of wall extension at each
  side; ornament bands — cornice boxes, parapet, its coping — extend by the
  same amount so molding lines run visually continuous around the corner).
- The extension carries NO openings (openings live in the layout engine,
  which is untouched; the mitered sliver is plain wall).
- The party-wall edge stripe/edge at the corner side is suppressed.
- Both lots' `depthOffset` is forced to 0 at a merged corner by sync (a
  shear between the two frontages of one building would read as a crack);
  non-corner lots keep their offsets.

### Selection & UI

- Clicking a merged corner's node handle (a plain click, not a drag —
  reuse the existing 300 ms post-drag suppression) selects the corner:
  `{ level: "corner", cornerKey }`. Corner-merged node handles render
  tinted (accent gold `#d4a017` vs the normal grey) so merged corners are
  visible in plan.
- Corner inspector (panel): Unified ↔ 2-facades toggle; primary picker
  ("Street A / Street B" with the block ids' frontage widths shown);
  global `Max corner angle` slider (0–180°, live — corners appear/dissolve
  immediately); a caption listing what the shell shares.
- Lot panels keep working as today; shell edits on either corner lot
  propagate via sync. Face edits in 2-facades mode stay per-side; in
  unified mode face edits on the primary propagate, and face edits on the
  secondary are allowed but overwritten by the next sync from primary
  (the inspector caption says "faces mirror Street A").
- Breadcrumb shows `Corner` alongside Lot/Block when a corner is selected.

### Generation & reroll

`generateBlock`/`rerollBlock` outputs pass through the same `syncCorners`
choke point (primary side wins when no edited side is given), so drawing a
new street against an existing one immediately shares shells at the new
corner, and rerolling one block re-syncs its partners.

## Testing (vitest — pure modules only)

- `detectCorners`: two-block weld inside/outside the angle threshold
  (boundary exact); flipped blocks; both winding directions; 3-way
  junction excluded; free endpoints excluded; lotIndex correctness for
  node-at-origin vs node-at-end; key stability under endpoint drag
  (same blocks/ends → same key).
- `syncCorners`: shell fields copied, face fields untouched (two-facades);
  unified mirrors ratios/groundFloor/bay rhythm with clamps; editedBlockId
  direction; primary direction when absent; idempotence; pinned lots'
  `customized` flags preserved; depthOffset zeroed only at corner lots;
  non-corner lots byte-identical.
- `miterFor`: convex extends / concave trims; clamp at extreme angles;
  zero at 0° turn.
- UI (inspector, tinted handles, click-vs-drag) and wall geometry verified
  in the browser.

## Not in scope (deferred)

3+-way junctions; corner-specific openings (corner-wrapped door, turret);
per-corner angle overrides; unwelding; persistence.
