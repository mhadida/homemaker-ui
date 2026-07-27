/** Real parcel geometry (M4): reduce an arbitrary imported footprint polygon
 * to the four numbers the block engine needs — frontage line, facing, width
 * and depth.
 *
 * Pure: no three, no React, no network, and NOTHING from `@/lib/facade`, so
 * the dependency runs `facade -> geo` and never both ways. In particular the
 * massing-depth clamps live in `facade/layout.ts` and are applied by
 * `facade/promote.ts`, not here.
 *
 * Spec: docs/superpowers/specs/2026-07-26-promote-footprint-design.md */

import type { StreetNetwork } from "@/lib/street/types";
import { nearestPointOnStreets } from "@/lib/street/geometry";

export type Vec2 = [number, number];

/** A maximal run of consecutive, near-collinear polygon edges. Real
 * footprints have a median of 7 vertices and their longest single edge is
 * only ~31% of the perimeter, so a frontage is a CHAIN of short edges — never
 * one edge. */
export interface Chain {
  /** First vertex of the run. */
  a: Vec2;
  /** The vertex AFTER the run's last edge. */
  b: Vec2;
  /** Source edge indices, in ring order. */
  idx: number[];
}

/** Consecutive edges whose directions differ by less than this merge into one
 * chain. 20 degrees keeps a gently-curved canal frontage together while still
 * breaking at a real corner. */
export const CHAIN_TOLERANCE_DEG = 20;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (v: Vec2): number => Math.hypot(v[0], v[1]);
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];

function unit(v: Vec2): Vec2 {
  const l = len(v);
  return l > 1e-9 ? [v[0] / l, v[1] / l] : [0, 0];
}

/** Shoelace area. Positive when the ring winds counter-clockwise in the
 * (x, z) plane; the sign is the ONLY reliable way to know which side of an
 * edge is outside, because real OSM ways wind both ways. */
export function signedArea(outline: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x0, z0] = outline[i];
    const [x1, z1] = outline[(i + 1) % outline.length];
    s += x0 * z1 - x1 * z0;
  }
  return s / 2;
}

/** Plot area in square metres, winding-independent. */
export function parcelArea(outline: Vec2[]): number {
  return Math.abs(signedArea(outline));
}

/** Group the ring's edges into maximal near-collinear runs. */
export function edgeChains(
  outline: Vec2[],
  toleranceDeg: number = CHAIN_TOLERANCE_DEG,
): Chain[] {
  const n = outline.length;
  if (n < 3) return [];
  const cosT = Math.cos((toleranceDeg * Math.PI) / 180);
  const dirs: Vec2[] = [];
  for (let i = 0; i < n; i++) dirs.push(unit(sub(outline[(i + 1) % n], outline[i])));

  // Start scanning at a REAL corner, so a run that happens to straddle index
  // 0 is not split there arbitrarily.
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (dot(dirs[i], dirs[(i - 1 + n) % n]) < cosT) {
      start = i;
      break;
    }
  }
  // A ring with no corner at all (a polygon approximating a circle — real
  // footprints run to 162 vertices) has no break to start from. Emitting one
  // wrap-around chain there would produce a ZERO-LENGTH frontage, so fall
  // back to one chain per edge.
  if (start < 0) {
    return outline.map((p, i) => ({ a: p, b: outline[(i + 1) % n], idx: [i] }));
  }

  const groups: number[][] = [];
  let cur: number[] = [start];
  for (let k = 1; k < n; k++) {
    const i = (start + k) % n;
    const prev = (i - 1 + n) % n;
    if (dot(dirs[i], dirs[prev]) >= cosT) cur.push(i);
    else {
      groups.push(cur);
      cur = [i];
    }
  }
  groups.push(cur);

  return groups.map((idx) => ({
    a: outline[idx[0]],
    b: outline[(idx[idx.length - 1] + 1) % n],
    idx,
  }));
}

/** Where a promoted building's facade sits on its parcel. */
export interface FrontageFit {
  /** The block line, with the winning chain's endpoints VERBATIM. */
  line: { a: Vec2; b: Vec2 };
  /** Facing, in `blockFrame`'s own terms. */
  flipped: boolean;
  /** RAW extent behind the frontage in metres, deliberately UNCLAMPED —
   * `facade/promote.ts` applies MASSING_DEPTH_MIN/MAX so the clamp lives in
   * exactly one place and this module keeps no facade dependency. */
  depth: number;
}

/** A frontage shorter than this cannot carry a facade. Only 0.2% of real
 * fixture buildings fall below it. */
export const MIN_FRONTAGE = 2;

/** How hard street proximity outweighs raw chain length. */
const STREET_PULL = 0.35;
/** How far outside the chain midpoint we measure the street distance.
 * Probing OUTWARD rather than at the midpoint is what stops the chain on the
 * far side of a narrow plot from scoring as well as the near one. */
const PROBE_OUT = 0.5;
/** Score multiplier for a chain whose outward normal does not point at the
 * street at all. Nonzero so a winner always exists (a plot ringed by streets,
 * or one whose nearest street runs straight through it, still resolves), but
 * low enough that facing dominates length.
 *
 * Without this term, length alone decides: on a 6 m x 25 m canal house the
 * 25 m PARTY WALL outscores the 6 m canal frontage, and the facade lands on
 * the side of the building. Distance cannot fix that on its own, because a
 * long edge running away from the street is still close to it at one end. */
const OFF_STREET_FLOOR = 0.25;

/** Pick the street-facing frontage chain and fit the block line, facing and
 * depth. `network` null or empty makes every chain score `length / 1`, so the
 * longest wins through the SAME expression — the no-streets case is not a
 * separate branch. Returns null for a polygon that cannot carry a facade. */
export function fitFrontage(
  outline: Vec2[],
  network: StreetNetwork | null,
): FrontageFit | null {
  if (outline.length < 3) return null;
  const sa = signedArea(outline);
  if (Math.abs(sa) < 1e-6) return null;
  const ccw = sa > 0;

  let best:
    | { score: number; a: Vec2; b: Vec2; nOut: Vec2; length: number }
    | null = null;

  for (const c of edgeChains(outline)) {
    const d = sub(c.b, c.a);
    const length = len(d);
    // Too short to carry a facade => not a CANDIDATE, rather than a reason to
    // reject the whole plot. A stepped frontage often has its best-facing run
    // in a 1.5 m step; rejecting there would refuse a perfectly promotable
    // building that has a longer usable chain right beside it.
    if (length < MIN_FRONTAGE) continue;
    const u: Vec2 = [d[0] / length, d[1] / length];
    // For a positive (CCW) signed area the interior lies to the LEFT of each
    // directed edge, so the outward normal is the right-hand one.
    const nOut: Vec2 = ccw ? [u[1], -u[0]] : [-u[1], u[0]];
    const mid: Vec2 = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2];
    const probe: Vec2 = [
      mid[0] + nOut[0] * PROBE_OUT,
      mid[1] + nOut[1] * PROBE_OUT,
    ];
    // No network, no street in range, or a street running straight through
    // the probe: there is no facing information, so every chain is treated as
    // facing and the longest simply wins.
    const proj = network ? nearestPointOnStreets(probe, network) : null;
    const toStreet: Vec2 | null = proj ? sub(proj.point, probe) : null;
    const toStreetLen = toStreet ? len(toStreet) : 0;
    const facing =
      toStreet && toStreetLen > 1e-9
        ? OFF_STREET_FLOOR +
          (1 - OFF_STREET_FLOOR) *
            Math.max(0, dot(nOut, [toStreet[0] / toStreetLen, toStreet[1] / toStreetLen]))
        : 1;
    const dist = proj?.dist ?? 0;
    const score = (length * facing) / (1 + STREET_PULL * dist);
    if (!best || score > best.score) {
      best = { score, a: c.a, b: c.b, nOut, length };
    }
  }
  // Null only when EVERY chain was below MIN_FRONTAGE — a genuinely tiny
  // footprint (a shed, a canopy), not a stepped one.
  if (!best) return null;

  const u: Vec2 = [
    (best.b[0] - best.a[0]) / best.length,
    (best.b[1] - best.a[1]) / best.length,
  ];
  // The normal blockFrame derives when `flipped` is false.
  const nUnflipped: Vec2 = [-u[1], u[0]];
  const flipped = dot(nUnflipped, best.nOut) < 0;

  let depth = 0;
  for (const v of outline) {
    depth = Math.max(depth, -dot(sub(v, best.a), best.nOut));
  }

  return {
    line: { a: [best.a[0], best.a[1]], b: [best.b[0], best.b[1]] },
    flipped,
    depth,
  };
}
