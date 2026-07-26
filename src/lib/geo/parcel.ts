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
