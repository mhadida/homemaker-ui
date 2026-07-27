/** Open blocks: a frontage too short for a real terrace becomes open urban
 * space — a plaza, a park, or (most often) a single building — instead of a
 * squished row. Everything here is DERIVED from the block's seed + geometry, so
 * there is no new stored state: Save/Load is unchanged and a reroll re-picks.
 * Pure and color-free (palettes live in the components). Spec:
 * docs/superpowers/specs/2026-07-23-open-blocks-plaza-park-design.md */

import { mulberry32 } from "./generate";
import { blockFrame, type FacadeBlock } from "./blocks";

type Vec2 = [number, number];

export type PlazaMonument = "fountain" | "obelisk" | null;

export type OpenFill =
  | { kind: "plaza"; monument: PlazaMonument }
  | { kind: "park" };

// Outcome weights for a below-threshold block. `null` (a single building via
// the normal path) is the common case; plaza and park split the rest.
const P_BUILDING = 0.55;
const P_PLAZA = 0.25; // park = 1 − P_BUILDING − P_PLAZA = 0.20

// Independent seed offsets so the fill kind, the monument and the planting draw
// from uncorrelated streams of the same PRNG.
const MONUMENT_SALT = 0x9e3779b9;
const PLANTING_SALT = 0x85ebca6b;

/** The open-space fill for a block of this frontage length, or `null` to render
 * normally. `null` covers BOTH a full terrace (length ≥ 2·min) and the weighted
 * "single building" outcome below it — `subdivide` already yields a single lot
 * under ~10 m, so a single building simply IS the normal path. Deterministic in
 * `seed`. */
export function openFillFor(
  length: number,
  seed: number,
  lotWidthMin: number,
): OpenFill | null {
  if (length >= 2 * lotWidthMin) return null;
  const r = mulberry32(seed >>> 0)();
  if (r < P_BUILDING) return null;
  if (r < P_BUILDING + P_PLAZA) return { kind: "plaza", monument: pickMonument(seed) };
  return { kind: "park" };
}

function pickMonument(seed: number): PlazaMonument {
  const r = mulberry32((seed ^ MONUMENT_SALT) >>> 0)();
  if (r < 0.5) return "fountain";
  if (r < 0.7) return "obelisk";
  return null;
}

/** The block's ground rectangle: the frontage line extruded back by `depth`
 * along −normal (street is +normal, massing is −normal). Corners in order
 * front-left, front-right, back-right, back-left. */
export function blockFootprint(
  frame: { origin: Vec2; dir: Vec2; normal: Vec2; length: number },
  depth: number,
): Vec2[] {
  const { origin: o, dir: d, normal: n, length: L } = frame;
  const fr: Vec2 = [o[0] + d[0] * L, o[1] + d[1] * L];
  const back = (p: Vec2): Vec2 => [p[0] - n[0] * depth, p[1] - n[1] * depth];
  return [[o[0], o[1]], fr, back(fr), back([o[0], o[1]])];
}

export interface Planting {
  pos: Vec2;
  height: number;
  radius: number;
}

const CANOPY_R = 1.4;
const TREE_SPACING = 3; // target metres between trees
const EDGE_INSET = 1.2; // keep canopies off the footprint edge

/** Deterministic jittered-grid tree scatter inside the footprint, inset by
 * EDGE_INSET so canopies clear the edge. Tree count grows with area; empty when
 * the inset rectangle collapses (a footprint smaller than the inset margins).
 * Works in the rectangle's own (u along frontage, v into depth) frame so it is
 * correct for any rotation. */
export function parkPlanting(footprint: Vec2[], seed: number): Planting[] {
  const o = footprint[0];
  const fr = footprint[1];
  const bl = footprint[3];
  const lenU = Math.hypot(fr[0] - o[0], fr[1] - o[1]);
  const lenV = Math.hypot(bl[0] - o[0], bl[1] - o[1]);
  if (lenU < 1e-6 || lenV < 1e-6) return [];
  const uu: Vec2 = [(fr[0] - o[0]) / lenU, (fr[1] - o[1]) / lenU];
  const vv: Vec2 = [(bl[0] - o[0]) / lenV, (bl[1] - o[1]) / lenV];

  const u0 = EDGE_INSET;
  const u1 = lenU - EDGE_INSET;
  const v0 = EDGE_INSET;
  const v1 = lenV - EDGE_INSET;
  if (u1 <= u0 || v1 <= v0) return [];

  const rand = mulberry32((seed ^ PLANTING_SALT) >>> 0);
  const nu = Math.max(1, Math.round((u1 - u0) / TREE_SPACING));
  const nv = Math.max(1, Math.round((v1 - v0) / TREE_SPACING));
  const cellU = (u1 - u0) / nu;
  const cellV = (v1 - v0) / nv;
  const out: Planting[] = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      // jitter within the cell, bounded so the canopy centre stays inside it
      const ju = (rand() - 0.5) * Math.max(0, cellU - CANOPY_R);
      const jv = (rand() - 0.5) * Math.max(0, cellV - CANOPY_R);
      const u = Math.min(u1, Math.max(u0, u0 + (i + 0.5) * cellU + ju));
      const v = Math.min(v1, Math.max(v0, v0 + (j + 0.5) * cellV + jv));
      out.push({
        pos: [o[0] + uu[0] * u + vv[0] * v, o[1] + uu[1] * u + vv[1] * v],
        height: 3 + rand() * 2.5,
        radius: CANOPY_R * (0.7 + rand() * 0.5),
      });
    }
  }
  return out;
}

/** True when a block renders as open space (plaza/park) rather than buildings —
 * used to skip it in the building render paths and in corner detection. */
export function isOpenSpace(block: FacadeBlock): boolean {
  return (
    openFillFor(blockFrame(block).length, block.seed, block.gen.lotWidth.min) !==
    null
  );
}
