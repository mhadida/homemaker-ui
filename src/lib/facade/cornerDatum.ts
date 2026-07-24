/** Shared corner datums. Every welded corner's two corner lots level to ONE
 * height — the primary (wider) side's floor datum — so the frontage can't tear
 * on a slope: without this each wing levels to its own ground height and the
 * walls/roofs meet at different heights at the shared node (self-intersecting).
 * Applies to EVERY corner, unified or two-facades. Flat ground → every datum is
 * 0 → BlockGroup's `override ?? own` yields the same value (byte-identical).
 * Pure. */

import { computeLayout } from "./layout";
import { lotPlacements, type FacadeBlock } from "./blocks";
import { levelingFor, type Ground } from "./terrain";
import { cornerChoice, type Corner, type CornerChoice } from "./corners";

/** Map of `${blockId}:${lotIndex}` → the shared floor datum for that corner
 * lot. Both wings of each corner map to the primary side's datum. */
export function cornerDatumOverrides(
  corners: Corner[],
  cornerChoices: ReadonlyMap<string, CornerChoice>,
  blocks: FacadeBlock[],
  ground: Ground,
): Map<string, number> {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const out = new Map<string, number>();
  for (const c of corners) {
    const choice = cornerChoice(cornerChoices, c, blocks);
    const pSide = c[choice.primary];
    const pBlock = byId.get(pSide.blockId);
    if (!pBlock) continue;
    const pLot = pBlock.lots[pSide.lotIndex];
    const D = computeLayout(pLot.params).massingDepth;
    const pl = lotPlacements(pBlock)[pSide.lotIndex];
    const { datum } = levelingFor(
      pl.position[0],
      pl.position[2],
      pLot.params.width,
      D,
      pl.rotationY,
      ground,
    );
    out.set(`${c.a.blockId}:${c.a.lotIndex}`, datum);
    out.set(`${c.b.blockId}:${c.b.lotIndex}`, datum);
  }
  return out;
}
