import type { Vec2 } from "./types";
import { streetRibbon } from "./geometry";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";

/** Canal cross-section constants (metres). */
export const CANAL_QUAY = 0.5;        // quay-wall thickness
export const CANAL_SIDEWALK = 3;      // walkable band each bank
export const CANAL_WATER_DEPTH = 1.2; // min water depth below the lowest bank
export const BRIDGE_DECK_WIDTH = 3;   // footbridge breadth (along the canal)
export const BRIDGE_RISE = 1.5;       // arch apex above bank grade

export type Vec3 = [number, number, number];

/** The three offset ribbons of a canal: water edge (½W), quay foot (½W+quay),
 * bank / building line (½W+quay+sidewalk). Each is a mitered streetRibbon. */
export function canalOffsets(centreline: Vec2[], width: number) {
  return {
    water: streetRibbon(centreline, width),
    quayFoot: streetRibbon(centreline, width + 2 * CANAL_QUAY),
    bank: streetRibbon(centreline, width + 2 * CANAL_QUAY + 2 * CANAL_SIDEWALK),
  };
}

/** The single level water-surface Y: WATER_DEPTH below the lowest bank-edge
 * ground point, so the level pool never floods. Flat ground → grade − depth. */
export function canalWaterY(centreline: Vec2[], width: number, ground: Ground): number {
  const { bank } = canalOffsets(centreline, width);
  let minG = Infinity;
  for (const p of [...bank.left, ...bank.right]) {
    const g = groundHeightAt(p[0], p[1], ground);
    if (g < minG) minG = g;
  }
  return minG - CANAL_WATER_DEPTH;
}
