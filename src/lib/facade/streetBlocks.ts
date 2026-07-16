import type { StreetNetwork } from "../street/types";
import { streetFrontages, type Frontage } from "../street/frontage";
import { generateBlock, refit } from "./generate";
import { syncCorners } from "./corners";
import type { CornerChoice } from "./corners";
import type { BlockGenSettings, FacadeBlock } from "./blocks";

const frontageKey = (f: { streetId: string; segment: number; part: number; side: string }) =>
  `${f.streetId}#${f.segment}#${f.part}#${f.side}`;
const blockKey = (b: FacadeBlock) =>
  b.source
    ? `${b.source.streetId}#${b.source.segment}#${b.source.part}#${b.source.side}`
    : null;

// Deterministic per-frontage seed so redraws are stable.
function frontageSeed(f: Frontage): number {
  let h = 2166136261;
  for (const ch of frontageKey(f)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export interface SyncOpts {
  gen: BlockGenSettings;
  setback: number;
  maxCornerAngle: number;
  cornerChoices: Map<string, CornerChoice>;
}

/** Reconcile the derived frontage blocks against `existing`, preserving hand
 * edits: hand-drawn (source-less) blocks pass through untouched; a frontage
 * that still exists keeps its block id + gen + seed and REFITS its line
 * (pinned lots survive); new frontages generate; gone frontages drop. Funnels
 * through syncCorners so bends weld into corner buildings. Pure. */
export function syncStreetBlocks(
  net: StreetNetwork,
  existing: FacadeBlock[],
  opts: SyncOpts,
): FacadeBlock[] {
  const frontages = streetFrontages(net, opts.setback);
  const byKey = new Map(
    existing.filter((b) => b.source).map((b) => [blockKey(b)!, b]),
  );
  const hand = existing.filter((b) => !b.source);

  const derived: FacadeBlock[] = frontages.map((f) => {
    const line = { a: [f.a[0], f.a[1]] as [number, number], b: [f.b[0], f.b[1]] as [number, number] };
    const prev = byKey.get(frontageKey(f));
    if (prev) {
      // keep id/gen/seed/lots; update line; refit to the new length (pins survive)
      const relined: FacadeBlock = { ...prev, line, flipped: f.facingFlipped };
      return refit(relined, "b") ?? relined;
    }
    const seed = frontageSeed(f);
    return {
      id: `street:${frontageKey(f)}`,
      line,
      flipped: f.facingFlipped,
      gen: opts.gen,
      seed,
      lots: generateBlock(line, f.facingFlipped, opts.gen, seed),
      source: { streetId: f.streetId, segment: f.segment, part: f.part, side: f.side },
    };
  });

  return syncCorners([...hand, ...derived], opts.cornerChoices, opts.maxCornerAngle);
}
