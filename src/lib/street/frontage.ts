import type { StreetNetwork, Vec2 } from "./types";
import { effectiveWidth } from "./types";
import { streetRibbon, closestPointOnSegment } from "./geometry";

export const PAVEMENT_GAP = 1.5; // m from carriageway edge to the building line
export const FRONTAGE_MIN = 6;   // m — a shorter (junction-crowded) edge yields no building

export interface Frontage {
  streetId: string;
  segment: number;
  /** Sub-interval index of this offset-edge segment (offset-edge crossings
   * split a segment into parts) — keeps each derived block's key unique. */
  part: number;
  side: "left" | "right";
  a: Vec2;
  b: Vec2;
  facingFlipped: boolean;
}

interface StreetInfo {
  id: string;
  half: number; // effectiveWidth/2 + gap — the offset-edge distance
  pts: Vec2[];
  left: Vec2[];
  right: Vec2[];
}

/** Snap an interior corner point to a weld grid so the two crossing streets'
 * frontages that meet there get a BYTE-IDENTICAL shared endpoint → syncCorners
 * welds them into one mitered L-corner building. */
const weld = (v: Vec2): Vec2 => [
  Math.round(v[0] / 1e-3) * 1e-3,
  Math.round(v[1] / 1e-3) * 1e-3,
];

/** Interior crossing of segment p1p2 with p3p4 → the param along p1p2 (both
 * params strictly interior), or null (parallel / collinear / endpoint-touch). */
function crossParam(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): number | null {
  const d1x = p2[0] - p1[0], d1z = p2[1] - p1[1];
  const d2x = p4[0] - p3[0], d2z = p4[1] - p3[1];
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const s = ((p3[0] - p1[0]) * d2z - (p3[1] - p1[1]) * d2x) / denom;
  const t = ((p3[0] - p1[0]) * d1z - (p3[1] - p1[1]) * d1x) / denom;
  const e = 1e-4;
  return s > e && s < 1 - e && t > e && t < 1 - e ? s : null;
}

/** Both frontage edges of every DRAWN street segment. A frontage is trimmed
 * exactly where its offset edge CROSSES another street's offset edge — that
 * crossing is the outer corner, shared byte-identically by both streets'
 * frontages so `syncCorners` welds them into one mitered corner building. The
 * stretch of an offset edge that runs INSIDE another street's carriageway is
 * dropped (the road crossing). This handles X, T-branch and T-through corners
 * uniformly; same-street bends already share the mitered ribbon vertex. Pure. */
export function streetFrontages(net: StreetNetwork): Frontage[] {
  const info: StreetInfo[] = net.streets
    .filter((s) => s.points.length >= 2)
    .map((s) => {
      const half = effectiveWidth(s) / 2 + PAVEMENT_GAP;
      const { left, right } = streetRibbon(
        s.points,
        effectiveWidth(s) + 2 * PAVEMENT_GAP,
      );
      return { id: s.id, half, pts: s.points as Vec2[], left, right };
    });

  // Is p inside some OTHER street's carriageway+gap (i.e. across a road)?
  const insideOther = (p: Vec2, selfId: string): boolean => {
    for (const b of info) {
      if (b.id === selfId) continue;
      for (let j = 0; j < b.pts.length - 1; j++) {
        if (closestPointOnSegment(p, b.pts[j], b.pts[j + 1]).dist < b.half - 1e-6)
          return true;
      }
    }
    return false;
  };

  const out: Frontage[] = [];
  for (const a of info) {
    for (const side of ["left", "right"] as const) {
      const edge = side === "left" ? a.left : a.right;
      for (let i = 0; i < edge.length - 1; i++) {
        const e0 = edge[i], e1 = edge[i + 1];
        const segLen = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]);
        if (segLen < 1e-6) continue;
        const at = (t: number): Vec2 => [
          e0[0] + (e1[0] - e0[0]) * t,
          e0[1] + (e1[1] - e0[1]) * t,
        ];

        // Cut params where this edge crosses ANY other street's offset edge.
        const cuts: number[] = [];
        for (const b of info) {
          if (b.id === a.id) continue;
          for (const bedge of [b.left, b.right]) {
            for (let j = 0; j < bedge.length - 1; j++) {
              const t = crossParam(e0, e1, bedge[j], bedge[j + 1]);
              if (t !== null) cuts.push(t);
            }
          }
        }
        cuts.sort((x, y) => x - y);

        const params = [0, ...cuts, 1];
        for (let k = 0; k < params.length - 1; k++) {
          const t0 = params[k], t1 = params[k + 1];
          if (t1 - t0 < 1e-9) continue;
          if (insideOther(at((t0 + t1) / 2), a.id)) continue; // across a road
          // Interior cut endpoints weld-snap (shared corner); raw segment ends
          // (t=0/1, incl. mitered bend vertices) stay exact so same-street
          // corners keep welding.
          const pa = t0 > 1e-9 ? weld(at(t0)) : at(t0);
          const pb = t1 < 1 - 1e-9 ? weld(at(t1)) : at(t1);
          if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < FRONTAGE_MIN) continue;
          out.push({
            streetId: a.id,
            segment: i,
            part: k,
            side,
            a: pa,
            b: pb,
            facingFlipped: side === "left",
          });
        }
      }
    }
  }
  return out;
}
