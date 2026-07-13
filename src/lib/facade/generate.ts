import type { FacadeParams, WindowStyleId } from "./types";
import { DEFAULT_FACADE, FACADE_PRESETS, DOOR_SWATCHES } from "./types";
import { WALL_SWATCHES, classicalStoreyHeights } from "@/lib/building/types";
import type { BlockGenSettings, FacadeBlock, LotState } from "./blocks";
import { blockFrame } from "./blocks";

/** Deterministic PRNG (mulberry32) — same seed, same street. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randIn = (rand: () => number, min: number, max: number) =>
  min + rand() * (max - min);
const randInt = (rand: () => number, min: number, max: number) =>
  Math.min(max, Math.floor(randIn(rand, min, max + 1)));
const pick = <T,>(rand: () => number, arr: T[]): T =>
  arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];
const jitter = (rand: () => number, amount: number) =>
  (rand() * 2 - 1) * amount;
const clampRange = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** Split `length` into lot widths. All lots within [min,max] except: the
 * last lot may land in (max, 2·min) when the tail can't be split further
 * (only possible when max < 2·min), and a segment shorter than min becomes
 * a single full-length lot. Sum is always exactly `length`. */
export function subdivide(
  length: number,
  min: number,
  max: number,
  rand: () => number,
): number[] {
  if (length <= min) return [length];
  const widths: number[] = [];
  let remaining = length;
  while (remaining > max && remaining >= min * 2) {
    const w = randIn(rand, min, Math.min(max, remaining - min));
    widths.push(w);
    remaining -= w;
  }
  widths.push(remaining);
  return widths;
}

/** One lot's FacadeParams: preset character from the pool, then jittered by
 * `variation`. Generated lots carry no active preset chip. */
export function generateLot(
  width: number,
  gen: BlockGenSettings,
  rand: () => number,
): FacadeParams {
  const presetId = gen.presets.length > 0 ? pick(rand, gen.presets) : undefined;
  const base: FacadeParams = {
    ...DEFAULT_FACADE,
    ...(presetId ? FACADE_PRESETS[presetId].params : {}),
    cellOverrides: [],
    preset: undefined,
  };
  const v = gen.variation;
  const storeys = randInt(rand, gen.storeys.min, gen.storeys.max);
  const storeyHeight = +clampRange(
    base.storeyHeight + jitter(rand, 0.2 * v),
    2.4,
    4.0,
  ).toFixed(2);
  const bays = clampRange(Math.round(width / randIn(rand, 2.2, 3.0)), 1, 6);
  // The shopfrontShare roll is the SOLE authority over retail: a false roll
  // must never yield a shopfront, even when the picked preset's base
  // treatment is "shopfront" (victorian-shopfront) — fall back to
  // residential instead.
  const shopfront = rand() < gen.shopfrontShare;
  const treatment = shopfront
    ? ("shopfront" as const)
    : base.groundFloor.treatment === "shopfront"
      ? ("residential" as const)
      : base.groundFloor.treatment;
  return {
    ...base,
    width,
    storeys,
    storeyHeight,
    storeyHeights: classicalStoreyHeights(storeys, storeyHeight),
    bays,
    windowWidthRatio: clampRange(
      base.windowWidthRatio + jitter(rand, 0.1 * v),
      0.2,
      0.8,
    ),
    windowHeightRatio: clampRange(
      base.windowHeightRatio + jitter(rand, 0.1 * v),
      0.3,
      0.8,
    ),
    groundFloor: {
      treatment,
      doorBay: randInt(rand, 0, bays - 1),
      stoop: treatment === "residential" ? rand() < 0.5 : false,
    },
    ornament: {
      cornice:
        rand() < v * 0.5 ? !base.ornament.cornice : base.ornament.cornice,
      parapet:
        rand() < v * 0.5 ? !base.ornament.parapet : base.ornament.parapet,
      sills: base.ornament.sills,
      surrounds:
        rand() < v * 0.5 ? !base.ornament.surrounds : base.ornament.surrounds,
    },
    wallColor: rand() < v ? pick(rand, WALL_SWATCHES).hex : base.wallColor,
    trimColor:
      rand() < v * 0.5 ? pick(rand, WALL_SWATCHES).hex : base.trimColor,
    doorColor: rand() < v ? pick(rand, DOOR_SWATCHES).hex : base.doorColor,
    windowStyle:
      rand() < v * 0.3
        ? pick(rand, ["georgian", "sash", "victorian", "none"] as WindowStyleId[])
        : base.windowStyle,
    // Drawn LAST so it never perturbs any earlier draw's determinism.
    massingDepth: +randIn(rand, 6, 12).toFixed(1),
  };
}

/** Per-lot independent seed streams so lot i's character doesn't shift when
 * an earlier lot's generation consumes a different number of samples. */
const lotSeed = (seed: number, i: number) => (seed + (i + 1) * 7919) >>> 0;

/** Separate stream from generateLot's draws so the offset never perturbs
 * lot character determinism. */
const offsetFor = (seed: number, i: number, jitter: number) =>
  (mulberry32((lotSeed(seed, i) + 777) >>> 0)() - 0.5) * jitter;

export function generateBlock(
  line: FacadeBlock["line"],
  flipped: boolean,
  gen: BlockGenSettings,
  seed: number,
): LotState[] {
  const { length } = blockFrame({ line, flipped });
  const widths = subdivide(length, gen.lotWidth.min, gen.lotWidth.max, mulberry32(seed));
  return widths.map((w, i) => ({
    params: generateLot(w, gen, mulberry32(lotSeed(seed, i))),
    customized: false,
    depthOffset: offsetFor(seed, i, gen.depthJitter),
  }));
}

/** New seed regenerates ONLY unpinned lots; widths and pinned lots persist. */
export function rerollBlock(block: FacadeBlock, seed: number): FacadeBlock {
  return {
    ...block,
    seed,
    lots: block.lots.map((lot, i) =>
      lot.customized
        ? lot
        : {
            params: generateLot(
              lot.params.width,
              block.gen,
              mulberry32(lotSeed(seed, i)),
            ),
            customized: false,
            depthOffset: offsetFor(seed, i, block.gen.depthJitter),
          },
    ),
  };
}

const REFIT_EPS = 1e-6;

/** Re-fit a block's lots after its line changed (node drag / weld ripple).
 * `block` already carries the NEW line; `movedEnd` names the raw endpoint
 * that moved. The unpinned lot nearest the moved end absorbs the delta:
 * below lotWidth.min it is removed (remainder folds onward), and at
 * lotWidth.max + lotWidth.min it splits — a seed-drawn new lot appears at
 * the moved side and becomes the next absorber, which is exactly what
 * frame-by-frame dragging produces, so final widths are drag-path
 * independent. Pinned lots are never resized or removed. Returns null when
 * the move cannot be satisfied (caller rejects it). Pure — never mutates. */
export function refit(
  block: FacadeBlock,
  movedEnd: "a" | "b",
): FacadeBlock | null {
  const { min, max } = block.gen.lotWidth;
  const T = max + min; // split threshold: first width divisible into two legal lots
  const target = blockFrame(block).length;
  if (target < REFIT_EPS) return null;
  // Process lots ordered fixed end → moved end. The frame origin sits at
  // line.a unless flipped, so lots[last] is nearest line.b when unflipped.
  const movedAtTail = (movedEnd === "b") !== block.flipped;
  const arr = movedAtTail ? [...block.lots] : [...block.lots].reverse();

  for (let guard = 0; guard <= block.lots.length; guard++) {
    const sum = arr.reduce((s, l) => s + l.params.width, 0);
    const delta = target - sum;
    if (Math.abs(delta) < REFIT_EPS) {
      const lots = movedAtTail ? arr : arr.reverse();
      return { ...block, lots };
    }
    let i = arr.length - 1;
    while (i >= 0 && arr[i].customized) i--;
    if (i < 0) return null; // every lot pinned — nothing may resize
    let aw = arr[i].params.width + delta;
    if (aw < min - REFIT_EPS) {
      if (arr.length === 1) return null; // a block never drops its last lot
      arr.splice(i, 1); // remove; the loop folds the remainder onward
      continue;
    }
    // Grow (or shrink within limits). Split while the absorber can make
    // two legal lots; each split freezes the current absorber at T - nw
    // and hands the remaining growth to the new lot.
    const drawn: { nw: number; r: () => number; idx: number }[] = [];
    let count = arr.length;
    while (aw >= T) {
      const r = mulberry32(lotSeed(block.seed, count));
      const nw = min + r() * (max - min);
      drawn.push({ nw, r, idx: count });
      aw = nw + (aw - T);
      count++;
    }
    const absorberW = drawn.length === 0 ? aw : T - drawn[0].nw;
    arr[i] = {
      ...arr[i],
      params: { ...arr[i].params, width: absorberW },
    };
    const newLots: LotState[] = drawn.map(({ nw, r, idx }, k) => ({
      // Character comes from the seed-drawn width; the final width is the
      // frozen split remainder (or the leftover growth for the newest lot).
      params: {
        ...generateLot(nw, block.gen, r),
        width: k === drawn.length - 1 ? aw : T - drawn[k + 1].nw,
      },
      customized: false,
      depthOffset: offsetFor(block.seed, idx, block.gen.depthJitter),
    }));
    arr.splice(i + 1, 0, ...newLots);
    const lots = movedAtTail ? arr : arr.reverse();
    return { ...block, lots };
  }
  return null;
}

/** Remove one lot; the street keeps its length — the freed width is
 * absorbed by the unpinned lot nearest the removal site via refit
 * (movedEnd = the raw endpoint nearer the deleted lot, so lots at the far
 * side keep their positions). Absorption can split (>= max+min): a
 * seed-drawn "new" building may replace the deleted one. Returns null when
 * nothing can absorb, or for single-lot blocks (callers delete the block
 * instead). A pinned lot may itself be deleted — pinning protects against
 * resizing, not explicit deletion. Pure. */
export function deleteLot(
  block: FacadeBlock,
  lotIndex: number,
): FacadeBlock | null {
  if (block.lots.length <= 1) return null;
  if (lotIndex < 0 || lotIndex >= block.lots.length) return null;
  const lots = block.lots.filter((_, i) => i !== lotIndex);
  const nearOrigin = lotIndex < block.lots.length / 2;
  // Frame origin sits at line.a unless flipped (see blockFrame): absorbing
  // at the origin side needs movedEnd "a" when unflipped, "b" when flipped.
  const movedEnd: "a" | "b" = nearOrigin === !block.flipped ? "a" : "b";
  return refit({ ...block, lots }, movedEnd);
}
