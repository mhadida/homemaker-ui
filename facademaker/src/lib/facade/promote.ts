/** Promotion (M4): turn the cadastral parcel containing an imported building
 * into an ordinary editable FacadeBlock. Reality contributes the PLOT —
 * frontage line, facing, width and depth; the generator contributes storeys,
 * style, roof and colour.
 *
 * The rectangular-box facade engine is untouched: the real polygon rides along
 * on `block.parcel` and is drawn on the ground as the lot boundary, with the
 * box fitted inside it. No three, no React. Everything here is pure EXCEPT
 * `promoteParcel`, which allocates a block id — render-time callers want
 * `parcelPreview`.
 *
 * Spec: docs/superpowers/specs/2026-07-26-promote-footprint-design.md */

import type { Vec2 } from "@/lib/geo/parcel";
import { fitFrontage } from "@/lib/geo/parcel";
import type { StreetNetwork } from "@/lib/street/types";
import type { BlockGenSettings, FacadeBlock } from "./blocks";
import { applyParcelDepth, blockFrame, nextBlockId } from "./blocks";
import { generateBlock, generateLot, mulberry32 } from "./generate";
import { MASSING_DEPTH_MAX, MASSING_DEPTH_MIN } from "./layout";

/** The single place the parcel depth clamp is applied. `fitFrontage` returns
 * the raw extent so `lib/geo` keeps no facade dependency. */
const clampDepth = (d: number): number =>
  Math.max(MASSING_DEPTH_MIN, Math.min(MASSING_DEPTH_MAX, d));

export interface PromotableParcel {
  id: string;
  outline: Vec2[];
  /** Existing OSM building replaced by the editable result. */
  contextBuildingId?: string;
}

/** The plot geometry a promotion would use: frontage width and clamped depth,
 * or null when the parcel cannot carry a facade.
 *
 * Genuinely pure — unlike `promoteParcel`, which allocates a block id and so
 * must not be called during render. The UI previews through THIS, and
 * `promoteParcel` builds on it, so the panel and the result cannot diverge and
 * the depth clamp still lives in one place. */
export function parcelPreview(
  parcel: PromotableParcel,
  network: StreetNetwork | null,
): { line: { a: [number, number]; b: [number, number] }; flipped: boolean; width: number; depth: number } | null {
  const fit = fitFrontage(parcel.outline, network);
  if (!fit) return null;
  const line = {
    a: [fit.line.a[0], fit.line.a[1]] as [number, number],
    b: [fit.line.b[0], fit.line.b[1]] as [number, number],
  };
  return {
    line,
    flipped: fit.flipped,
    width: blockFrame({ line, flipped: fit.flipped }).length,
    depth: clampDepth(fit.depth),
  };
}

/** Real footprint -> a ready-to-render block with ONE generated lot.
 * `network` may be null: with no streets the longest edge chain wins, and the
 * existing `f` / Flip side control corrects a bad guess. Returns null when the
 * parcel cannot carry a facade (see `fitFrontage`).
 *
 * NOT pure — it allocates a block id, so it must not be called during render.
 * Use `parcelPreview` to show what promotion would produce. */
export function promoteParcel(
  parcel: PromotableParcel,
  network: StreetNetwork | null,
  gen: BlockGenSettings,
  seed: number,
): FacadeBlock | null {
  const fit = parcelPreview(parcel, network);
  if (!fit) return null;
  const { line, width, depth } = fit;

  return {
    id: nextBlockId(),
    line,
    flipped: fit.flipped,
    gen: structuredClone(gen),
    seed,
    lots: [
      {
        params: {
          ...generateLot(width, gen, mulberry32(seed >>> 0)),
          width,
          // Plot geometry, NOT generated character: generateLot draws 6-12 m,
          // while real plot depth runs from p05 3.0 m to p95 33.6 m, so a
          // generated depth would sit inside its own parcel only by luck.
          massingDepth: depth,
        },
        customized: false,
        // The generator's +/- depthJitter would shove the building off its
        // own plot.
        depthOffset: 0,
      },
    ],
    parcel: {
      source: parcel.id,
      // Copied, not aliased: the fetched BRK array is shared with the parcel
      // overlay and must not become mutable block state.
      outline: parcel.outline.map((p) => [p[0], p[1]] as [number, number]),
      depth,
      ...(parcel.contextBuildingId
        ? { contextBuildingId: parcel.contextBuildingId }
        : {}),
    },
  };
}

/** One lot -> a terrace, via the existing generateBlock. Returns null when the
 * block is already subdivided or its frontage cannot yield two legal lots.
 * The parcel (and its depth) rides through unchanged. Pure. */
export function subdivideBlock(
  block: FacadeBlock,
  seed: number,
): FacadeBlock | null {
  if (block.lots.length !== 1) return null;
  if (blockFrame(block).length < 2 * block.gen.lotWidth.min) return null;
  const lots = generateBlock(block.line, block.flipped, block.gen, seed);
  if (lots.length < 2) return null;
  return applyParcelDepth({ ...block, seed, lots });
}

/** A terrace -> one lot spanning the whole frontage. Returns null when the
 * block is already a single lot, or when ANY lot is hand-edited: merging
 * collapses N lots into 1, so it would silently discard that work. Pure. */
export function mergeBlock(
  block: FacadeBlock,
  seed: number,
): FacadeBlock | null {
  if (block.lots.length <= 1) return null;
  if (block.lots.some((l) => l.customized)) return null;
  const width = blockFrame(block).length;
  return applyParcelDepth({
    ...block,
    seed,
    lots: [
      {
        params: {
          ...generateLot(width, block.gen, mulberry32(seed >>> 0)),
          width,
        },
        customized: false,
        depthOffset: 0,
      },
    ],
  });
}
