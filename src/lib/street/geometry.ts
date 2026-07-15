import type { Street, StreetNetwork, Vec2 } from "./types";

const RING_SEGMENTS = 32;

/** Krier/Alexander thresholds (m) — traditional urbanism prefers streets
 * that bend rather than run dead-straight for long stretches, and grand
 * boulevards to be punctuated (a terminating monument, a roundabout) rather
 * than running featureless. Advisory only. */
const STRAIGHT_RUN_MAX = 40;
const BOULEVARD_LENGTH_MAX = 120;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += dist(points[i], points[i + 1]);
  return total;
}

/** Pure Krier/Alexander advisory hint, or null. Never blocks the layout —
 * `alley`/`street` flags a single straight run (any consecutive vertex
 * pair) longer than STRAIGHT_RUN_MAX with no bend relieving it;
 * `boulevard` flags total length over BOULEVARD_LENGTH_MAX (a grand avenue
 * wants a terminating monument or a roundabout along its length). `road`
 * carries no advisory — it's a cars-first type, not a pedestrian
 * streetscape concern. */
export function streetAdvisory(street: Street): string | null {
  const { type, points } = street;
  if (type === "boulevard") {
    return polylineLength(points) > BOULEVARD_LENGTH_MAX
      ? "Long boulevard — consider a terminating monument or a roundabout along its length."
      : null;
  }
  if (type === "alley" || type === "street") {
    for (let i = 0; i < points.length - 1; i++) {
      if (dist(points[i], points[i + 1]) > STRAIGHT_RUN_MAX) {
        return "Long straight run — a gentle curve or bend reads as more traditional streetscape.";
      }
    }
  }
  return null;
}

/** Endpoint snapping for the street-draw tool (mirrors `snapPoint` in
 * facade/blocks.ts): returns the nearest EXISTING vertex across every
 * street's `points`, within `radius`, else `p` unchanged. Exact-value
 * snapping (no rounding) so a snapped vertex matches `deriveIntersections`'
 * exact-float weld. Pure — an empty network is a no-op. */
export function snapStreetPoint(
  p: Vec2,
  network: StreetNetwork,
  radius: number,
): Vec2 {
  let best = p;
  let bestD = radius;
  for (const s of network.streets) {
    for (const v of s.points) {
      const d = Math.hypot(p[0] - v[0], p[1] - v[1]);
      if (d < bestD) {
        bestD = d;
        best = [v[0], v[1]];
      }
    }
  }
  return best;
}

/** Uniform Catmull-Rom through the vertices, sampling each segment.
 * Endpoints are duplicated so the curve passes through the first and last
 * vertex. ≤ 2 points → straight (returned unchanged). */
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
    const steps = samplesPerSegment;
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

/** Per-vertex offset of a sampled centreline by ±half the width. The normal at
 * each vertex is the left-perpendicular of the averaged direction of the
 * adjacent segments, so joints stay smooth. Left = +normal, right = −normal. */
export function streetRibbon(
  centreline: Vec2[],
  width: number,
): { left: Vec2[]; right: Vec2[] } {
  const h = width / 2;
  const n = centreline.length;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const dir = (a: Vec2, b: Vec2): Vec2 => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
  };
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? dir(centreline[i - 1], centreline[i]) : dir(centreline[i], centreline[i + 1]);
    const next = i < n - 1 ? dir(centreline[i], centreline[i + 1]) : prev;
    let tx = prev[0] + next[0];
    let tz = prev[1] + next[1];
    const tl = Math.hypot(tx, tz);
    // If averaged tangent is degenerate (sharp reversal), fall back to next direction
    if (tl < 1e-6) {
      tx = next[0];
      tz = next[1];
    } else {
      tx /= tl;
      tz /= tl;
    }
    // left-perpendicular of the tangent (plan coords)
    const nx = -tz;
    const nz = tx;
    const c = centreline[i];
    left.push([c[0] + nx * h, c[1] + nz * h]);
    right.push([c[0] - nx * h, c[1] - nz * h]);
  }
  return { left, right };
}

/** Two centred 32-gon loops: the paved ring's outer edge and the central
 * island. The monument sits at `centre`. Note: uses no Math.random/Date. */
export function roundaboutRing(
  centre: Vec2,
  outerR: number,
  islandR: number,
): { outer: Vec2[]; island: Vec2[] } {
  const loop = (r: number): Vec2[] =>
    Array.from({ length: RING_SEGMENTS }, (_, i): Vec2 => {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      return [centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r];
    });
  return { outer: loop(outerR), island: loop(islandR) };
}
