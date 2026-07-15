import type { Vec2 } from "./types";

/** Centripetal-ish Catmull-Rom through the vertices (uniform), sampling each
 * segment. Endpoints are duplicated so the curve passes through the first and
 * last vertex. ≤ 2 points → straight (returned unchanged). */
export function smoothCentreline(points: Vec2[], samplesPerSegment = 10): Vec2[] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]] as Vec2);
  const out: Vec2[] = [];
  const p = points;
  const at = (i: number): Vec2 => p[Math.max(0, Math.min(p.length - 1, i))];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const steps = i === p.length - 2 ? samplesPerSegment : samplesPerSegment; // include last endpoint below
    for (let s = 0; s < steps; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const z =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, z]);
    }
  }
  out.push([p[p.length - 1][0], p[p.length - 1][1]]); // exact last vertex
  return out;
}
