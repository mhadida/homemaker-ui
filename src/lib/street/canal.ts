import type { Vec2 } from "./types";
import { streetRibbon } from "./geometry";

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
