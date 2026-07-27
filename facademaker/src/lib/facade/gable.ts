/** Shaped ("bent"/compound) front-gable silhouettes — the street wall rising
 * above the eave into a curved (Dutch) or stepped (crow-step) top. Pure. */

export type GableStyle = "curved" | "stepped";

export const GABLE_HEIGHT_MIN = 1.0;
export const GABLE_HEIGHT_MAX = 6.0;
export const GABLE_HEIGHT_DEFAULT = 2.5;

/** Steps per side for a crow-stepped gable. */
export const GABLE_STEPS = 4;

export type Vec2 = [number, number];

/** Sample a quadratic Bézier at `k` points for t in (0, 1] (the start point
 * p0 is assumed already emitted by the previous segment). */
function quad(p0: Vec2, p1: Vec2, p2: Vec2, k: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i <= k; i++) {
    const t = i / k;
    const u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
  return out;
}

/** Mirror a left-half silhouette (x ≤ 0, ending at the centre peak) across
 * x = 0 to make the right half, dropping the duplicated peak point. */
function mirror(half: Vec2[]): Vec2[] {
  const right: Vec2[] = [];
  for (let i = half.length - 2; i >= 0; i--) right.push([-half[i][0], half[i][1]]);
  return right;
}

/** The shaped-gable outline, facade-local: points from the LEFT eave corner
 * (−width/2, 0) up over the shaped top to the RIGHT eave corner (width/2, 0),
 * with y measured above the eave. Symmetric about x = 0. The mesh closes the
 * bottom (eave) edge. `rise` is the peak height above the eave. */
export function gableProfile(
  style: GableStyle,
  width: number,
  rise: number,
): Vec2[] {
  const hw = width / 2;
  const r = rise;

  if (style === "stepped") {
    const n = GABLE_STEPS;
    const base = r * 0.18; // straight shoulder before the steps begin
    const stepW = hw / n;
    const stepH = (r - base) / n;
    const half: Vec2[] = [
      [-hw, 0],
      [-hw, base],
    ];
    let x = -hw;
    let y = base;
    for (let i = 0; i < n; i++) {
      y += stepH; // riser
      half.push([x, y]);
      x += stepW; // tread
      half.push([x, y]);
    }
    // half now ends at [0, r] (the peak)
    return [...half, ...mirror(half)];
  }

  // curved (Dutch ogee): straight side, a bellied concave shoulder, a convex
  // neck, then a small cap up to the centre peak.
  const half: Vec2[] = [[-hw, 0]];
  const add = (pts: Vec2[]) => half.push(...pts);
  half.push([-hw, r * 0.2]); // straight side
  add(quad([-hw, r * 0.2], [-hw, r * 0.42], [-hw * 0.62, r * 0.44], 6)); // concave in
  half.push([-hw * 0.62, r * 0.52]); // shoulder step
  add(quad([-hw * 0.62, r * 0.52], [-hw * 0.3, r * 0.52], [-hw * 0.24, r * 0.68], 6)); // convex neck
  add(quad([-hw * 0.24, r * 0.68], [-hw * 0.16, r * 0.9], [0, r], 7)); // cap to peak
  return [...half, ...mirror(half)];
}
