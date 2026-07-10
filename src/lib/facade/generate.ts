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
  };
}

/** Per-lot independent seed streams so lot i's character doesn't shift when
 * an earlier lot's generation consumes a different number of samples. */
const lotSeed = (seed: number, i: number) => (seed + (i + 1) * 7919) >>> 0;

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
          },
    ),
  };
}
