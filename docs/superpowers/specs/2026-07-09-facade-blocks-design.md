# Plan-Drawn Facade Blocks — Design Spec (v2 sub-project C)

**Date:** 2026-07-09
**Status:** Approved by user (brainstorming session)
**Depends on:** sub-project B (the plan pane is the drawing surface; the
perpendicular-elevation rule is exercised by angled blocks). Sub-project A's
door/transom rule applies automatically to generated lots.

## Purpose

Click-drag lines in the plan pane; each line becomes a block of generated
facades with randomized properties — turning the single-lot editor into a
small streetscape tool. Any generated facade remains fully editable with the
existing controls.

## Decisions

| Question | Decision |
|---|---|
| Relationship to v1 editor | One world: the page state holds N blocks; the current single facade is just the starting block. Clicking any facade selects it; the existing panel edits the selection. |
| Randomization control | Ranges + seed + reroll per block, deterministic (same line + settings + seed → same street) |
| Drawing gesture | One drag = one straight segment; facades on ONE side with a flip control; endpoint snapping (~1 m) chains segments visually |
| Streets | Emerge by drawing two parallel lines facing each other (no automatic both-sides) |
| Hand edits vs reroll | Hand-editing a lot pins it (`customized: true`); reroll only regenerates unpinned lots; "reset lot" unpins |

## Data model

```ts
interface FacadeBlock {
  id: string;
  line: { a: [number, number]; b: [number, number] };  // plan coords, meters
  flipped: boolean;              // which side of the line gets facades
  gen: BlockGenSettings;
  seed: number;
  lots: LotState[];              // in order along the line
}

interface LotState {
  params: FacadeParams;          // the v1 type, unchanged
  customized: boolean;
}

interface BlockGenSettings {
  lotWidth: { min: number; max: number };   // default 5–9 m
  storeys: { min: number; max: number };    // default 2–4
  presets: PresetId[];                       // allowed pool
  shopfrontShare: number;                    // 0–1 chance of retail ground per lot
  variation: number;                         // 0–1 jitter on ratios/colors/ornament
}

// page state: { blocks: FacadeBlock[]; selected: { blockId: string; lotIndex: number } | null }
```

Each lot is a full citizen of the v1 system: a `FacadeParams` positioned and
rotated along the block line, party walls flush with neighbors. The v1 grey
neighbor masses (`LotContext`) show only while the world has just the single
starting block; real neighbors replace fake ones once a second block exists.

## Generator (`src/lib/facade/generate.ts` — pure, seeded, tested)

`generateBlock(line, flipped, gen, seed): LotState[]`
- Subdivide the segment into lots with widths drawn from
  `[lotWidth.min, lotWidth.max]`; the last lot clamps to fill the remainder.
- Per lot: pick a preset from the pool → jitter storeys/bays/window ratios/
  colors/ornament by `variation` → roll ground treatment against
  `shopfrontShare` → assemble `FacadeParams`.
- Seeded PRNG (no `Math.random`); reroll = new seed; only lots with
  `customized === false` regenerate.

## Drawing & selection

- **Draw mode**: toggle in the plan pane corner. Active: click-drag rubber-band
  line; on release the block generates immediately with default settings and a
  fresh seed. Inactive: plan pans/zooms as in B.
- **Click a facade** (any pane, raycast): selects the lot → panel becomes the
  lot inspector (today's controls, editing `lots[i].params`; edits set
  `customized`). The AI prompt targets the selected lot.
- **Click a block's line in plan** (or second click on its facade): selects the
  block → panel becomes the block inspector: gen-range sliders, preset pool,
  shopfront share, variation, seed + Reroll, Flip side, Delete block
  (with confirm).
- Selected lot highlighted subtly; selected block's line accented in plan.

## Panes with multiple blocks

- Perspective and plan fit the whole world (plan camera auto-fits all blocks).
- Both elevation panes track the SELECTED block: cameras aim along that
  block's facade normal (B's perpendicular rule), overview fitted to the whole
  block strip, detail free-zoomed. No selection → first block.
- Per-block sidewalk strip along its line; one shared ground plane; roads
  emerge between facing blocks.

## Testing (vitest)

Generator: determinism (same inputs → identical output), lot widths within
range and summing to segment length, `customized` pinning through reroll,
flip geometry (facades land on the correct side), preset pool respected,
shopfrontShare 0 and 1 extremes. Drawing/selection verified visually.

## Not in scope (deferred)

Corner buildings at junctions; curved lines; persistence of drawn worlds
(refresh loses the street — if that stings in use, localStorage is a small
follow-up); IFC/BIM export of streets.
