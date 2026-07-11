# Pen-Tool Streets with Draggable Nodes — Design Spec (v3 sub-project)

**Date:** 2026-07-10
**Status:** Approved by user (brainstorming session)
**Depends on:** sub-project C (blocks, generator, plan-pane drawing). Replaces
C's one-drag-one-segment gesture.

## Purpose

Turn the plan pane's drawing tool into a pen tool: click to chain nodes into
a polyline (or closed loop) where every segment is a generated facade block,
then drag any node — including shared vertices between blocks — to reshape
the street while the buildings re-fit.

## Decisions

| Question | Decision |
|---|---|
| Re-fit when a block's length changes | Stretch the unpinned lot nearest the moved end; once it reaches `lotWidth.max + lotWidth.min` a new lot (seed-drawn width) splits off at the moved end, below `lotWidth.min` it is removed. Existing lots never reshuffle. |
| Lot-width edit on a welded endpoint | The endpoint still moves (today's `syncLineToLots` result), routed through `moveNode` — welded neighbors re-fit exactly as if the shared node were dragged. One mechanism; v1 single-block behavior unchanged; loops need no special case. |
| When nodes are draggable | Always, in the plan pane, outside an active pen path. Handles are always visible; grabbing one suspends plan panning. During an active path, clicks mean place/snap/close instead. |
| Data model | Coincidence welding: `FacadeBlock.line` keeps raw coordinates; a "node" is derived from endpoints with identical coordinates. No schema change. |

## Data model: coincidence welding

`FacadeBlock` is unchanged. A **node** is a derived entity: the set of block
endpoints whose coordinates are exactly equal (bit-identical floats).

The invariant that makes this safe: **welded endpoints always hold copied,
never independently recomputed, coordinate values.** `snapPoint` already
copies coordinates; the pen tool reuses the previous segment's endpoint
object values; `moveNode` writes the same new pair to every coincident
endpoint. The one place arithmetic produces a fresh endpoint
(`syncLineToLots`) routes through `moveNode`, which propagates that computed
value to all welded endpoints. Exact float equality therefore never drifts.

New pure module `src/lib/facade/nodes.ts`:

```ts
interface WorldNode {
  pos: [number, number];
  /** Which block endpoints sit here. */
  refs: { blockId: string; end: "a" | "b" }[];
}

deriveNodes(blocks: FacadeBlock[]): WorldNode[]
// Move every endpoint at `from` to `to`, then re-fit every attached block.
// Returns null if any attached block cannot satisfy the move (see clamping)
// — and also when NO endpoint sits at `from` (moving a nonexistent node is
// a failed move; this makes stale-frame drag events harmless no-ops).
moveNode(blocks: FacadeBlock[], from: [number, number], to: [number, number]): FacadeBlock[] | null
```

## Pen drawing (replaces the drag gesture)

- The existing ✏ toggle arms the pen. **Click** places a node, snapped to
  any existing endpoint within 1 m (`snapPoint`).
- From the second click on, each click commits a segment: a block generates
  immediately (`generateBlock`, fresh seed, `structuredClone(DEFAULT_GEN)`),
  exactly like today's release-commit, and is selected at block level. The
  clicked node becomes the start of the next segment.
- A rubber-band preview runs from the last node to the (snapped) cursor.
- Consecutive segments share exact endpoint coordinates — welded by
  construction.
- **Escape** ends the path; everything already placed stays. Toggling ✏ off
  ends the path too.
- Clicking within snap radius of the path's **first node** commits the
  closing segment and ends the path. A loop is just N ordinary welded
  blocks; no interior/courtyard concept.
- Clicks closer than `MIN_BLOCK_LENGTH` (3 m) to the last node are ignored,
  including the closing click.
- Facades face left-of-travel per segment (existing default); per-block
  Flip still available (Flip swaps endpoints in the frame only — coordinates
  are untouched, so welds are unaffected).

## Nodes & dragging

- Small handles render at every derived node in the plan pane, always
  visible outside an active pen path; hover highlights.
- Pointer-down on a handle starts a drag: plan `MapControls` are disabled
  for its duration; all coincident endpoints move together **live** (state
  updates every frame so blocks re-fit as you drag).
- While dragging, the node snaps to other nodes (1 m radius, excluding
  nodes of blocks attached to the dragged node); releasing on one welds
  them — free behavior under coincidence welding.
- No unweld/detach gesture (deferred).

## The one re-fit rule (`refit`)

When an endpoint of a block moves:

- New length = distance between the block's endpoints. Direction may change
  too — facades rotate with the block (same as today's angled blocks).
- **The lot nearest the moved node absorbs the length delta.** Lots at the
  fixed end keep their widths and positions.
- When the absorbing lot reaches `gen.lotWidth.max + gen.lotWidth.min` — the
  first width divisible into two legal lots — a **new lot** splits off at
  the moved end. Its width is drawn from `[min, max]` via the block's seed
  stream offset by lot count (deterministic; existing lots never reshuffle;
  independent of the absorber's width, so final widths don't depend on the
  drag path). The absorber keeps the remainder (≥ `min`); the new lot
  becomes the next absorber. Repeat while growth demands it.
  *Why not split exactly at `max`:* the overflow piece would start below
  `min`, and the below-min removal rule would instantly delete it — an
  add/remove oscillation. The `max + min` threshold means an absorbing lot
  can render stretched up to just under `max + min` before splitting; that
  transitional stretch is accepted.
- If the absorbing lot would fall below `gen.lotWidth.min`, it is removed
  and the remainder folds into the next unpinned lot toward the fixed end.
- **Pinned lots (`customized: true`) are never resized or removed.** The
  absorber is the unpinned lot nearest the moved node.
- **Clamping:** a move that cannot be satisfied (every lot pinned, or the
  only remaining unpinned lot cannot absorb without violating limits and no
  lot can be added/removed to compensate) is rejected for that frame — the
  node sticks and the drag continues from the stuck position.
- `depthOffset` rides along per lot, untouched.

## Width-edit ripple

`syncLineToLots` currently moves the block's effective end when lot widths
change. That endpoint change now routes through `moveNode(oldEnd, newEnd)`:
welded neighbors re-fit via `refit`, exactly as if the shared node were
dragged. Neighbor blocks may change angle slightly — geometrically honest,
identical to a node drag. Free (unwelded) endpoints behave byte-identically
to today.

## Code layout

- **Create** `src/lib/facade/nodes.ts` — `deriveNodes`, `moveNode` (pure).
- **Modify** `src/lib/facade/generate.ts` — add
  `refit(block: FacadeBlock, movedEnd: "a" | "b"): FacadeBlock | null`
  (`movedEnd` names the raw line endpoint that moved; needs the seed
  streams for new lots; null = cannot satisfy, caller rejects the move).
- **Modify** `src/components/facade/FacadeViewer.tsx` — DrawSurface becomes
  PenSurface (click-chaining, rubber band, Escape/close-loop) +
  NodeHandles (render + drag).
- **Modify** `src/app/facade/page.tsx` — `onMoveNode` handler; commit
  handler adapts to per-click segments; width edits route through
  `moveNode`.
- **Untouched:** `blocks.ts` types, layout engine, elevation cameras,
  selection model, `FacadeMesh`, `SceneContents`.

## Testing (vitest — pure modules only)

- `deriveNodes`: coincident endpoints cluster into one node; distinct ones
  don't; refs carry blockId + end.
- `moveNode`: moves every welded endpoint; returns re-fitted blocks; returns
  null (rejects) when an attached block cannot absorb.
- `refit`: determinism (same moves → same street); absorb-at-moved-end
  (fixed-end lots byte-identical); split at `lotWidth.max` generates from
  the seed stream without reshuffling existing lots; removal below
  `lotWidth.min` folds remainder onward; pinned lots inviolate; clamping
  cases.
- Width-edit ripple: editing a lot width in block 1 re-fits welded block 2;
  free-endpoint blocks match today's behavior exactly.
- Loop closure: last segment welds to the first node.
- Pen gesture, rubber band, handle feel: verified visually in the browser.

## Addendum (2026-07-11): Delete key deletes the selection

User request during implementation. Delete or Backspace deletes what is
selected (decision: "follows selection"):

- **Lot level**: the lot is removed; the street keeps its length — the
  freed width is absorbed by the unpinned lot nearest the removal site via
  the existing `refit` machinery (`deleteLot(block, lotIndex)` in
  `generate.ts`, pure; `movedEnd` = the raw endpoint nearer the deleted
  lot, so lots at the far side keep their positions). Absorption can split
  (≥ max+min) — a seed-drawn "new" building may replace the deleted one.
  If nothing can absorb (all remaining lots pinned), the deletion is
  rejected (no-op). A pinned lot may itself be deleted — pinning protects
  against resizing, not explicit deletion.
- **Block level, or deleting a block's last lot**: the whole block is
  deleted immediately (same semantics as the existing Delete block button,
  but without the two-step confirm — keyboard deletion is direct).
- Ignored while typing (input/textarea/select/contenteditable focus).

## Not in scope (deferred)

Unwelding/detaching a node; inserting a node mid-segment; corner buildings
at junctions (still deferred from C); curved segments; persistence.
