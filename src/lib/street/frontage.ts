import type { StreetNetwork, Vec2 } from "./types";
import { effectiveWidth } from "./types";
import { streetRibbon } from "./geometry";
import { deriveIntersections } from "./intersections";

export const PAVEMENT_GAP = 1.5; // m from carriageway edge to the building line
export const FRONTAGE_MIN = 6;   // m — a shorter (junction-crowded) edge yields no building

export interface Frontage {
  streetId: string;
  segment: number;
  side: "left" | "right";
  a: Vec2;
  b: Vec2;
  facingFlipped: boolean;
}

const near = (p: Vec2, q: Vec2, eps = 1e-4) =>
  Math.abs(p[0] - q[0]) < eps && Math.abs(p[1] - q[1]) < eps;

/** Both frontage edges of every DRAWN street segment. The offset uses
 * streetRibbon on the RAW drawn points (mitered joints → adjacent segments'
 * frontages share a bend vertex, so the corner system welds them). Each end is
 * trimmed back by `setback` when its street vertex is a derived junction (SP-2b),
 * and frontages under FRONTAGE_MIN are dropped. Pure. */
export function streetFrontages(net: StreetNetwork, setback: number): Frontage[] {
  const jns = deriveIntersections(net).map((i) => i.pos);
  const isJn = (p: Vec2) => jns.some((j) => near(p, j));
  const out: Frontage[] = [];
  for (const s of net.streets) {
    if (s.points.length < 2) continue;
    const width = effectiveWidth(s) + 2 * PAVEMENT_GAP;
    const { left, right } = streetRibbon(s.points, width); // one offset point per drawn vertex
    for (let i = 0; i < s.points.length - 1; i++) {
      const trimA = isJn(s.points[i]) ? setback : 0;
      const trimB = isJn(s.points[i + 1]) ? setback : 0;
      for (const side of ["left", "right"] as const) {
        const edge = side === "left" ? left : right;
        const a0 = edge[i], b0 = edge[i + 1];
        const dx = b0[0] - a0[0], dz = b0[1] - a0[1];
        const L = Math.hypot(dx, dz);
        if (L < 1e-6) continue;
        const ux = dx / L, uz = dz / L;
        const a: Vec2 = [a0[0] + ux * trimA, a0[1] + uz * trimA];
        const b: Vec2 = [b0[0] - ux * trimB, b0[1] - uz * trimB];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < FRONTAGE_MIN) continue;
        // A block faces its line's LEFT. The left ribbon edge sits on the +normal
        // side of the centreline, so its inward (toward-centre) face is its RIGHT
        // → flipped. The right edge is the mirror → not flipped.
        out.push({ streetId: s.id, segment: i, side, a, b, facingFlipped: side === "left" });
      }
    }
  }
  return out;
}
