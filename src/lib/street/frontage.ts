import type { StreetNetwork, Vec2 } from "./types";
import { effectiveWidth } from "./types";
import { streetRibbon, closestPointOnSegment } from "./geometry";
import { deriveIntersections } from "./intersections";

export const PAVEMENT_GAP = 1.5; // m from carriageway edge to the building line
export const FRONTAGE_MIN = 6;   // m — a shorter (junction-crowded) edge yields no building

export interface Frontage {
  streetId: string;
  segment: number;
  /** Sub-interval index of this segment (a mid-span junction splits a segment
   * into parts) — keeps each derived block's key unique. */
  part: number;
  side: "left" | "right";
  a: Vec2;
  b: Vec2;
  facingFlipped: boolean;
}

/** Both frontage edges of every DRAWN street segment. The offset uses
 * streetRibbon on the RAW drawn points (mitered joints → adjacent segments'
 * frontages share a bend vertex, so the corner system welds them). Every
 * derived junction (SP-2b) that lies ON a segment — whether at its vertex
 * (shared-node / T-branch end) or mid-span (X crossing / T-through) — splits
 * the frontage with a `setback` gap on each side, so buildings never invade a
 * crossing. Frontages under FRONTAGE_MIN are dropped. Pure. */
export function streetFrontages(net: StreetNetwork, setback: number): Frontage[] {
  const jns = deriveIntersections(net).map((i) => i.pos);
  const out: Frontage[] = [];
  for (const s of net.streets) {
    if (s.points.length < 2) continue;
    const width = effectiveWidth(s) + 2 * PAVEMENT_GAP;
    const { left, right } = streetRibbon(s.points, width); // one offset point per drawn vertex
    for (let i = 0; i < s.points.length - 1; i++) {
      const p0 = s.points[i], p1 = s.points[i + 1];
      const segLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (segLen < 1e-6) continue;
      const setT = setback / segLen; // setback in this segment's [0,1] param

      // Junction cut params: any junction lying on this centreline segment.
      const cuts = jns
        .map((j) => closestPointOnSegment(j, p0, p1))
        .filter((r) => r.dist < 1e-3 && r.t > -1e-6 && r.t < 1 + 1e-6)
        .map((r) => Math.max(0, Math.min(1, r.t)))
        .sort((x, y) => x - y);

      // Allowed sub-intervals of [0,1], gapping ±setT around every cut.
      const intervals: [number, number][] = [];
      let lo = 0;
      for (const c of cuts) {
        const hi = c - setT;
        if (hi > lo + 1e-9) intervals.push([lo, hi]);
        lo = Math.max(lo, c + setT);
      }
      if (1 > lo + 1e-9) intervals.push([lo, 1]);

      intervals.forEach(([t0, t1], part) => {
        if ((t1 - t0) * segLen < FRONTAGE_MIN) return;
        for (const side of ["left", "right"] as const) {
          const edge = side === "left" ? left : right;
          const ea = edge[i], eb = edge[i + 1];
          const at = (t: number): Vec2 => [ea[0] + (eb[0] - ea[0]) * t, ea[1] + (eb[1] - ea[1]) * t];
          // A block faces its line's LEFT. The left ribbon edge sits on the
          // +normal side of the centreline, so its inward (toward-centre) face
          // is its RIGHT → flipped. The right edge is the mirror → not flipped.
          out.push({
            streetId: s.id,
            segment: i,
            part,
            side,
            a: at(t0),
            b: at(t1),
            facingFlipped: side === "left",
          });
        }
      });
    }
  }
  return out;
}
