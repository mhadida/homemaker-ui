/** The unified corner L-roof: one hip/valley roof spanning both wings of a
 * merged corner building (2026-07-17 corner-l-roof spec).
 *
 * The roof is exactly four planes — each wing's front and back eave line
 * rising at the shared gradient m = roofHeight / (D/2) — restricted to four
 * quad faces. Their pairwise intersections give every crease: both ridges,
 * the valley (front∩front, from the reentrant corner) and the hip
 * (back∩back, from the outer corner), all meeting at one point P where the
 * two wings' centrelines cross.
 *
 * NOT built by extending each wing's rectangular tent: at a point in the
 * elbow the tent measures height from a stretch of eave line that is
 * interior to the L (not an eave), and is wrong by metres — see the spec's
 * "Why not just extend the tent". */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface CornerRoofInput {
  /** the corner node (plan coords) */
  V: Vec2;
  /** unit vectors from V INTO each wing along its line */
  uA: Vec2;
  uB: Vec2;
  /** each wing's outward facade normal */
  nA: Vec2;
  nB: Vec2;
  /** shared massing depth (the two lots' resolved depths must be equal) */
  D: number;
  /** corner-lot widths */
  Wa: number;
  Wb: number;
  convex: boolean;
  type: "gable" | "hip";
  eaveY: number;
  roofHeight: number;
}

export interface CornerRoofPlan {
  /** four quads, plan coords + y (eaveY or ridgeY per vertex) */
  faces: Vec3[][];
  /** party-wall end treatments, one triangle per wing (vertical for gable,
   * slanted for hip) */
  ends: Vec3[][];
  eaveY: number;
  ridgeY: number;
  /** where every crease meets, at ridgeY */
  P: Vec2;
  /** outer corner of the L footprint (hip end when convex) */
  Q: Vec2;
}

const EPS = 1e-9;

/** p1 + t·d1 = p2 + s·d2 → the intersection point, or null when parallel. */
function lineIntersect(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < EPS) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / denom;
  return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}

const add = (p: Vec2, d: Vec2, k: number): Vec2 => [p[0] + d[0] * k, p[1] + d[1] * k];

/** Pure. null when a precondition fails — the caller falls back to today's
 * independent per-wing roofs. Preconditions checked here are the geometric
 * ones (the caller owns mode/orientation/shared-depth):
 * degenerate turn (parallel wings), non-positive dimensions, and for a
 * concave corner P lying inside both wings (Wa > D/2 and Wb > D/2). */
export function cornerRoofPlan(input: CornerRoofInput): CornerRoofPlan | null {
  const { V, uA, uB, nA, nB, D, Wa, Wb, convex, type, eaveY, roofHeight } = input;
  if (!(D > 0) || !(Wa > 0) || !(Wb > 0) || !(roofHeight > 0)) return null;
  if (!convex && (Wa <= D / 2 || Wb <= D / 2)) return null;

  // Q: back-eave-lines intersection; P: centrelines intersection.
  const Q = lineIntersect(add(V, nA, -D), uA, add(V, nB, -D), uB);
  const P = lineIntersect(add(V, nA, -D / 2), uA, add(V, nB, -D / 2), uB);
  if (!Q || !P) return null; // parallel wings — no corner

  const ridgeY = eaveY + roofHeight;

  // Party-wall ridge ends: gable runs the ridge to the wall; hip insets it.
  const insetA = type === "hip" ? Math.min(D / 2, Wa) : 0;
  const insetB = type === "hip" ? Math.min(D / 2, Wb) : 0;
  const endA = add(V, uA, Wa); // front eave party corner, wing A
  const backA = add(endA, nA, -D);
  const ridgeEndA = add(add(V, uA, Wa - insetA), nA, -D / 2);
  const endB = add(V, uB, Wb);
  const backB = add(endB, nB, -D);
  const ridgeEndB = add(add(V, uB, Wb - insetB), nB, -D / 2);

  const lo = (p: Vec2): Vec3 => [p[0], eaveY, p[1]];
  const hi = (p: Vec2): Vec3 => [p[0], ridgeY, p[1]];

  // Front faces always foot at V (it lies on BOTH front eave lines — the
  // facades meet there); back faces always foot at Q (both back eave lines).
  // Only the crease NAMES swap with convexity: front∩front is the valley at
  // a convex corner and the hip at a concave one, and vice versa. Footing a
  // front face anywhere else (e.g. Q) would put an eave-height vertex off
  // the face's plane.
  const faces: Vec3[][] = [
    [lo(V), lo(endA), hi(ridgeEndA), hi(P)], // A-front
    [lo(Q), lo(backA), hi(ridgeEndA), hi(P)], // A-back
    [lo(V), lo(endB), hi(ridgeEndB), hi(P)], // B-front
    [lo(Q), lo(backB), hi(ridgeEndB), hi(P)], // B-back
  ];
  const ends: Vec3[][] = [
    [lo(endA), lo(backA), hi(ridgeEndA)],
    [lo(endB), lo(backB), hi(ridgeEndB)],
  ];
  return { faces, ends, eaveY, ridgeY, P, Q };
}

/** Pure: plan → triangle soup (flat list, every 3 = one triangle). Winding
 * not guaranteed outward — the mesh auto-orients by normal, the same
 * contract as roofTriangles. */
export function cornerRoofTriangles(plan: CornerRoofPlan): Vec3[] {
  const out: Vec3[] = [];
  for (const q of plan.faces) {
    out.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  }
  for (const t of plan.ends) {
    out.push(t[0], t[1], t[2]);
  }
  return out;
}
