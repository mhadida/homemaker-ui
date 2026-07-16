import type { Street, StreetNetwork, Vec2 } from "./types";
import { STREET_SPECS } from "./types";

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
  const minR = STREET_SPECS[type].minRadius;
  for (let i = 1; i < points.length - 1; i++) {
    const { deflection, maxRadius } = cornerFit(points[i - 1], points[i], points[i + 1]);
    if (deflection > 0 && maxRadius < minR) {
      return `This ${STREET_SPECS[type].label.toLowerCase()} corner is tighter than its ${minR} m minimum radius — it was rounded as much as the segments allow; lengthen them or add a vertex for a gentle sweep.`;
    }
  }
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

/** Closest point on segment a→b to p, with the clamped parameter t∈[0,1] and
 * the distance. Zero-length segment → a (t=0). Pure. */
export function closestPointOnSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { point: Vec2; t: number; dist: number } {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const denom = abx * abx + abz * abz;
  let t = denom === 0 ? 0 : ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / denom;
  t = Math.max(0, Math.min(1, t));
  const point: Vec2 = [a[0] + abx * t, a[1] + abz * t];
  return { point, t, dist: Math.hypot(p[0] - point[0], p[1] - point[1]) };
}

/** Endpoint + segment snapping for the street-draw tool (mirrors `snapPoint`
 * in facade/blocks.ts): a two-stage snap — 1) nearest EXISTING vertex across
 * every street's `points`, within `radius` (exact reuse wins), else 2) the
 * nearest point on any segment within `radius` (lands ON the line, enabling
 * T-junctions). Exact-value vertex snapping (no rounding) so a snapped vertex
 * matches `deriveIntersections`' exact-float weld. Pure — an empty network is
 * a no-op. */
export function snapStreetPoint(
  p: Vec2,
  network: StreetNetwork,
  radius: number,
): Vec2 {
  // 1) nearest EXISTING vertex within radius (exact reuse wins).
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
  if (best !== p) return best; // snapped to a vertex
  // 2) else nearest point on any segment within radius (lands ON the line → T).
  let segD = radius;
  for (const s of network.streets) {
    for (let i = 0; i < s.points.length - 1; i++) {
      const c = closestPointOnSegment(p, s.points[i], s.points[i + 1]);
      if (c.dist < segD) {
        segD = c.dist;
        best = c.point;
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
  closed = false,
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
    let prev: Vec2, next: Vec2;
    if (closed && (i === 0 || i === n - 1)) {
      // Ring seam: centreline[n-1] coincides with centreline[0], so both
      // seam points use the SAME wrap-around tangents → identical offset →
      // the ribbon closes with no gap.
      prev = dir(centreline[n - 2], centreline[0]);
      next = dir(centreline[0], centreline[1]);
    } else {
      prev = i > 0 ? dir(centreline[i - 1], centreline[i]) : dir(centreline[i], centreline[i + 1]);
      next = i < n - 1 ? dir(centreline[i], centreline[i + 1]) : prev;
    }
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

/** Unit vector from `from` toward `to` (plan coords); coincident points → [0,0]. */
function unit(to: Vec2, from: Vec2): Vec2 {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
}

/** Geometry of one interior corner A–V–B: the deflection angle Δ (heading
 * change; 0 = collinear) and the largest fillet radius that seats within the
 * adjacent segments (tangent length capped at half the shorter neighbour, so a
 * fillet at the far end of each segment still fits). Pure. */
export function cornerFit(
  A: Vec2,
  V: Vec2,
  B: Vec2,
): { deflection: number; maxRadius: number } {
  // Compute segment lengths first and guard against degenerate segments
  const segA = Math.hypot(A[0] - V[0], A[1] - V[1]);
  const segB = Math.hypot(B[0] - V[0], B[1] - V[1]);
  if (segA < 1e-9 || segB < 1e-9) return { deflection: 0, maxRadius: 0 };
  const u = unit(A, V);
  const w = unit(B, V);
  let dot = u[0] * w[0] + u[1] * w[1];
  dot = Math.max(-1, Math.min(1, dot));
  const phi = Math.acos(dot); // interior angle between the two segments
  const delta = Math.PI - phi; // deflection
  if (delta < 1e-4) return { deflection: 0, maxRadius: 0 };
  const tCap = Math.min(segA, segB) * 0.5;
  const maxRadius = tCap / Math.tan(delta / 2);
  return { deflection: delta, maxRadius };
}

/** Real road alignment through the vertices: straight tangents joined by
 * circular arcs of radius min(minRadius, what fits). First and last vertices
 * are emitted exactly (shared junction points). Collinear corners pass
 * through. ≤ 2 points → straight passthrough copy. Pure. */
export function filletCentreline(
  points: Vec2[],
  minRadius: number,
  samplesPerArc = 8,
  closed = false,
): Vec2[] {
  if (points.length <= 2) return points.map((p): Vec2 => [p[0], p[1]]);
  const n = points.length;
  const out: Vec2[] = [];
  // Open: pin the first vertex, fillet interior corners 1..n-2, pin the last.
  // Closed: NO pinned endpoints — every vertex is a corner (cyclic neighbours),
  // and the ring is closed by repeating the first sample at the end.
  if (!closed) out.push([points[0][0], points[0][1]]);
  const lo = closed ? 0 : 1;
  const hi = closed ? n : n - 1; // exclusive
  for (let i = lo; i < hi; i++) {
    const A = points[(i - 1 + n) % n];
    const V = points[i % n];
    const B = points[(i + 1) % n];
    const { deflection, maxRadius } = cornerFit(A, V, B);
    if (deflection === 0 || maxRadius <= 0) {
      out.push([V[0], V[1]]);
      continue;
    }
    const r = Math.min(minRadius, maxRadius);
    const u = unit(A, V);
    const w = unit(B, V);
    const T = r * Math.tan(deflection / 2);
    const Ta: Vec2 = [V[0] + u[0] * T, V[1] + u[1] * T];
    const Tb: Vec2 = [V[0] + w[0] * T, V[1] + w[1] * T];
    let bx = u[0] + w[0];
    let bz = u[1] + w[1];
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl;
    bz /= bl;
    const dO = r / Math.cos(deflection / 2);
    const O: Vec2 = [V[0] + bx * dO, V[1] + bz * dO];
    const a0 = Math.atan2(Ta[1] - O[1], Ta[0] - O[0]);
    const a1 = Math.atan2(Tb[1] - O[1], Tb[0] - O[0]);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    out.push(Ta);
    for (let s = 1; s < samplesPerArc; s++) {
      const a = a0 + (d * s) / samplesPerArc;
      out.push([O[0] + Math.cos(a) * r, O[1] + Math.sin(a) * r]);
    }
    out.push(Tb);
  }
  if (closed) out.push([out[0][0], out[0][1]]); // close the ring
  else out.push([points[n - 1][0], points[n - 1][1]]); // exact last vertex
  return out;
}
