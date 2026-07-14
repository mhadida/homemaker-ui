# Marquee (rubber-band) multi-selection — design

**Date:** 2026-07-14
**Feature tag:** v14
**Status:** approved (both forks chosen), ready for implementation

## Goal

Drag a selection rectangle in the Plan pane to select a **unified, mixed** set
of entities — blocks, lots, and nodes at once — then **move**, **delete**, or
**bulk restyle/reroll** them. Built in one branch.

## Chosen forks

- **Unified selection** — one marquee grabs whatever overlaps (blocks + lots +
  nodes), mixed. Ops branch per entity type.
- **All at once** — full feature in one branch.

## The enclosure rule (disambiguates the unified model)

Given a rectangle `rect` in plan `[x,z]` coords:

- **Block** is selected iff **both endpoints** are inside `rect` (fully
  enclosed) → the block is treated as a whole (delete removes it, restyle hits
  all its lots, move translates it rigidly).
- **Lot** is selected iff its **center** is inside `rect` **and its block is
  NOT fully enclosed** (a fully-enclosed block subsumes its lots).
- **Node** is selected iff its **position** is inside `rect` **and it is not an
  endpoint of a fully-enclosed block** (subsumed likewise).

So a box over a whole street → whole-block ops; a box over part of it →
per-lot / per-node ops. No mode toggle needed.

## Pure module: `src/lib/facade/marquee.ts`

```ts
export interface Rect { x0: number; x1: number; z0: number; z1: number } // min/max normalized

export interface Marquee {
  blocks: string[];        // fully-enclosed block ids
  lots: string[];          // `${blockId}:${index}` (partial-block lots)
  nodes: [number, number][]; // enclosed nodes (partial-block)
}

export function normalizeRect(a: [number,number], b: [number,number]): Rect;
export function marqueeEmpty(m: Marquee): boolean;

/** Enclosure-rule hit test. Uses lotPlacements (lot centers), block line
 * endpoints, and deriveNodes (node positions). */
export function hitTest(blocks: FacadeBlock[], rect: Rect): Marquee;

/** Every block the selection affects: enclosed blocks ∪ blocks of selected
 * lots ∪ blocks touching selected nodes. Used for reroll + move. */
export function affectedBlockIds(m: Marquee, blocks: FacadeBlock[]): Set<string>;

/** Remove fully-enclosed blocks; deleteLot each partial-block lot (highest
 * index first, per block, so indices stay valid). Nodes are NOT deleted in
 * v1 (weld-merge deferred). Returns the new blocks array (caller syncCorners).
 * A block reduced to zero lots is dropped. */
export function deleteMarquee(blocks: FacadeBlock[], m: Marquee): FacadeBlock[];

/** Move: translate every fully-enclosed block rigidly by (dx,dz) (both
 * endpoints shift → no refit); additionally shift each selected loose node's
 * endpoint on its blocks and refit those blocks. Pure. */
export function translateMarquee(
  blocks: FacadeBlock[], m: Marquee, dx: number, dz: number,
): FacadeBlock[];
```

Node-delete (merging welded segments) is explicitly **deferred** — nodes in a
selection participate in move only. Documented in the panel.

## Interaction (FacadeViewer / PlanPane)

- **Select tool** — a toggle button next to Draw (mutually exclusive with draw
  mode). When active, left-drag in the plan pane draws a rectangle instead of
  panning (`MapControls enabled={!drawMode && !nodeDrag && !selectMode}` plus a
  drag surface, mirroring PenSurface).
- **MarqueeSurface** (new, plan pane only): pointerdown records the anchor,
  pointermove tracks the far corner + renders the rectangle (drei `<Line>`
  loop + faint fill plane), pointerup calls `onMarquee(a, b)` → page hit-tests.
  Escape / tool-off clears.
- **Highlight**: reuse `SelectionMarker` for enclosed blocks (all lots) and
  selected lots; a gold-ish node ring for selected nodes. Rendered from the
  marquee set (SceneContents gains a `marquee` prop).
- **Move**: dragging INSIDE an existing marquee (select tool active, pointer
  down on a selected entity / inside the bbox) translates the selection live
  via `translateMarquee` (same rigid-shift + syncCorners path). A drag that
  starts on empty space starts a NEW rectangle.

## Page state + ops (`page.tsx`)

- `const [marquee, setMarquee] = useState<Marquee | null>(null)`.
- Coexists with single `selected`: a plain click clears `marquee` and sets
  `selected`; a marquee sets `marquee` and clears `selected`.
- `handleMarquee(a,b)` → `hitTest(blocks, normalizeRect(a,b))`; empty → null.
- `handleMarqueeDelete()` → `setBlocks(syncCorners(deleteMarquee(blocks, m)))`,
  clear marquee + selection.
- `handleMarqueeMove(dx,dz)` → `setBlocks(syncCorners(translateMarquee(...)))`.
- `handleMarqueeRestyle(patch: Partial<FacadeParams>)` → apply patch to every
  selected lot (enclosed blocks: all lots; partial: selected lots), mark
  `customized`, `syncLineToLots` + `syncCorners`.
- `handleMarqueeReroll()` → `rerollBlock` each id in `affectedBlockIds`.

## Panel (FacadeControls)

When `marquee` is non-empty, render a **Selection** panel INSTEAD of the
lot/block/corner inspector:

- Header: "N blocks · M lots · K nodes selected".
- **Delete selection** button.
- **Reroll** button (affected blocks).
- Bulk-apply controls (apply to all selected lots): **wall color** + **trim
  color** swatch rows, **roof type** (flat/gable/hip), **roof color**
  (slate/red), **storeys** slider, and the **preset** chips (georgian /
  shopfront / modern) — the highest-leverage subset. Each writes via
  `handleMarqueeRestyle`.
- A note that node-delete is not yet supported.

## Byte-identical invariant

`marquee` defaults to `null`; when null, every existing path (single select,
draw, controls) is unchanged. The Select tool is off by default. No geometry
or generation changes when the feature is unused.

## Tests (`src/lib/facade/marquee.test.ts`)

- `hitTest`: fully-enclosed block → in `blocks`, its lots/nodes NOT double
  listed; partial block → only lots whose centers are inside; nodes inside a
  partial block → in `nodes`; empty rect → empty.
- `normalizeRect`: unordered corners → min/max.
- `affectedBlockIds`: union across the three sets.
- `deleteMarquee`: enclosed block removed; partial-block lots removed by
  `deleteLot` (indices valid after multi-remove); block emptied → dropped.
- `translateMarquee`: enclosed block endpoints shift by (dx,dz), length
  unchanged; a loose node's endpoint shifts.
