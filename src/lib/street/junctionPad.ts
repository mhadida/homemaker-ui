import type { Street, StreetNetwork, StreetType, Vec2 } from "./types";
import {
  effectiveWidth,
  minRadiusOf,
  ROUNDABOUT_OUTER_R,
  STREET_SPECS,
} from "./types";
import { deriveIntersections } from "./intersections";
import { filletCentreline } from "./geometry";

/** A clip disc contributed by one junction to one incident street. */
export interface ClipDisc {
  centre: Vec2;
  radius: number;
}

const EPS = 1e-6;

/** Split a polyline into the spans lying OUTSIDE every disc.
 *
 * Parametrized by cumulative arc length: each disc contributes the arc-length
 * ranges where the polyline is inside it (via a circle–segment quadratic); the
 * inside ranges are merged and the complementary (outside) ranges are re-emitted
 * as spans with the circle crossings inserted and the original interior vertices
 * kept. No discs, or a < 2-point input, is a no-op passthrough. Pure. */
export function clipCentreline(centreline: Vec2[], discs: ClipDisc[]): Vec2[][] {
  if (centreline.length < 2) return [];
  const copy = (): Vec2[][] => [centreline.map((p): Vec2 => [p[0], p[1]])];
  if (discs.length === 0) return copy();

  const cum: number[] = [0];
  for (let i = 1; i < centreline.length; i++) {
    cum.push(
      cum[i - 1] +
        Math.hypot(centreline[i][0] - centreline[i - 1][0], centreline[i][1] - centreline[i - 1][1]),
    );
  }
  const total = cum[cum.length - 1];
  if (total < EPS) return [];

  // inside-intervals in arc-length space
  const inside: [number, number][] = [];
  for (let i = 0; i < centreline.length - 1; i++) {
    const a = centreline[i];
    const b = centreline[i + 1];
    const segLen = cum[i + 1] - cum[i];
    if (segLen < 1e-12) continue;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    for (const disc of discs) {
      // |a + t·d − c|² < r²  →  A t² + B t + C < 0
      const fx = a[0] - disc.centre[0];
      const fz = a[1] - disc.centre[1];
      const A = dx * dx + dz * dz;
      const B = 2 * (fx * dx + fz * dz);
      const C = fx * fx + fz * fz - disc.radius * disc.radius;
      const det = B * B - 4 * A * C;
      if (det <= 0) continue; // never crosses zero → segment fully outside
      const sq = Math.sqrt(det);
      const t0 = Math.max(0, Math.min(1, (-B - sq) / (2 * A)));
      const t1 = Math.max(0, Math.min(1, (-B + sq) / (2 * A)));
      if (t1 - t0 <= 1e-12) continue;
      inside.push([cum[i] + t0 * segLen, cum[i] + t1 * segLen]);
    }
  }
  if (inside.length === 0) return copy();

  inside.sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const iv of inside) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] + EPS) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }

  const outside: [number, number][] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s - cursor > 1e-4) outside.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (total - cursor > 1e-4) outside.push([cursor, total]);

  const pointAt = (s: number): Vec2 => {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const segLen = cum[i + 1] - cum[i] || 1;
    const t = (s - cum[i]) / segLen;
    const a = centreline[i];
    const b = centreline[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };

  const spans: Vec2[][] = [];
  for (const [s, e] of outside) {
    const span: Vec2[] = [pointAt(s)];
    for (let i = 0; i < cum.length; i++) {
      if (cum[i] > s + EPS && cum[i] < e - EPS) span.push([centreline[i][0], centreline[i][1]]);
    }
    span.push(pointAt(e));
    if (span.length >= 2) spans.push(span);
  }
  return spans;
}

/** clipR (the along-centreline clip distance) for a junction. Roundabouts clip
 * to the ring; plain junctions to CLIP_K × the widest incident half-width.
 * Single source of truth shared by junctionClips (ribbon trim) and
 * deriveJunctionPads (pad mouths) so pad and ribbon meet exactly. */
export const CLIP_K = 1.3;
export function clipRadius(streets: Street[], isRoundabout: boolean): number {
  if (isRoundabout) return ROUNDABOUT_OUTER_R;
  return Math.max(...streets.map((s) => effectiveWidth(s) / 2)) * CLIP_K;
}

/** The distinct incident streets of a junction, resolved to Street objects. */
function incidentStreets(
  incident: { streetId: string }[],
  byId: Map<string, Street>,
): Street[] {
  const ids = [...new Set(incident.map((i) => i.streetId))];
  return ids.map((id) => byId.get(id)).filter((s): s is Street => !!s);
}

/** Per-street clip discs from every non-excluded junction it touches. A
 * junction with any canal incident, or fewer than 2 distinct incident streets,
 * is skipped. Pure. */
export function junctionClips(net: StreetNetwork): Map<string, ClipDisc[]> {
  const byId = new Map(net.streets.map((s) => [s.id, s]));
  const roundabout = new Set(net.roundabouts.map(([k]) => k));
  const out = new Map<string, ClipDisc[]>();
  for (const it of deriveIntersections(net)) {
    const streets = incidentStreets(it.incident, byId);
    if (streets.length < 2) continue;
    if (streets.some((s) => s.type === "canal")) continue;
    const radius = clipRadius(streets, roundabout.has(it.key));
    for (const s of streets) {
      const arr = out.get(s.id) ?? [];
      arr.push({ centre: [it.pos[0], it.pos[1]], radius });
      out.set(s.id, arr);
    }
  }
  return out;
}

/** Per-CLIPPED-street open spans (its filleted centreline minus every junction
 * disc). Unclipped streets are ABSENT (byte-identical rendering). Pure. */
export function streetSpans(net: StreetNetwork): Map<string, Vec2[][]> {
  const clips = junctionClips(net);
  const out = new Map<string, Vec2[][]>();
  for (const s of net.streets) {
    const discs = clips.get(s.id);
    if (!discs || discs.length === 0) continue;
    const cl = filletCentreline(s.points, minRadiusOf(s), 8, s.closed);
    if (cl.length < 2) continue;
    out.set(s.id, clipCentreline(cl, discs));
  }
  return out;
}

/** One mouth: a clipped ribbon end at a junction. `left`/`right` are the ribbon
 * end-cap corners (`M ± h·n`); the pad is built from these. */
export interface Mouth {
  centre: Vec2;
  left: Vec2;
  right: Vec2;
}

/** The mouths where `street` enters the junction at `pos`, clipped at `clipR`.
 * A through street yields two (one per side), an ending street one. Pure. */
export function mouthsAt(street: Street, pos: Vec2, clipR: number): Mouth[] {
  const cl = filletCentreline(street.points, minRadiusOf(street), 8, street.closed);
  if (cl.length < 2) return [];
  const spans = clipCentreline(cl, [{ centre: pos, radius: clipR }]);
  const h = effectiveWidth(street) / 2;
  const onCircle = (p: Vec2) => Math.abs(Math.hypot(p[0] - pos[0], p[1] - pos[1]) - clipR) < 1e-3;
  const mouths: Mouth[] = [];
  for (const span of spans) {
    if (span.length < 2) continue;
    // each span end sitting on the clip circle is a mouth; the tangent points
    // from that end toward the span's interior (i.e. away from pos).
    const ends: [Vec2, Vec2][] = [];
    if (onCircle(span[0])) ends.push([span[0], span[1]]);
    if (onCircle(span[span.length - 1])) ends.push([span[span.length - 1], span[span.length - 2]]);
    for (const [M, nextPt] of ends) {
      const tx = nextPt[0] - M[0];
      const tz = nextPt[1] - M[1];
      const tl = Math.hypot(tx, tz) || 1;
      const ux = tx / tl;
      const uz = tz / tl;
      const nx = -uz; // left-perp of the tangent
      const nz = ux;
      mouths.push({
        centre: [M[0], M[1]],
        left: [M[0] + nx * h, M[1] + nz * h],
        right: [M[0] - nx * h, M[1] - nz * h],
      });
    }
  }
  return mouths;
}

/** The paved intersection polygon for one non-roundabout, non-canal junction.
 * Color-free: the pure lib returns the dominant street's id; the component
 * resolves the paving color. */
export interface JunctionPad {
  key: string;
  pos: Vec2;
  polygon: Vec2[];
  dominantStreetId: string;
}

const typeOrder = (t: StreetType) => Object.keys(STREET_SPECS).indexOf(t);

/** One star-polygon pad per non-roundabout, non-canal junction. Walks the
 * incident mouths in angular order around the junction and emits each mouth's
 * [right, left] cap corners, so the pad tiles exactly with the clipped ribbons.
 * Pure, color-free. */
export function deriveJunctionPads(net: StreetNetwork): JunctionPad[] {
  const byId = new Map(net.streets.map((s) => [s.id, s]));
  const roundabout = new Set(net.roundabouts.map(([k]) => k));
  const pads: JunctionPad[] = [];
  for (const it of deriveIntersections(net)) {
    if (roundabout.has(it.key)) continue; // ring is the pad
    const streets = incidentStreets(it.incident, byId);
    if (streets.length < 2) continue;
    if (streets.some((s) => s.type === "canal")) continue;
    const clipR = clipRadius(streets, false);
    const mouths: Mouth[] = [];
    for (const s of streets) mouths.push(...mouthsAt(s, it.pos, clipR));
    if (mouths.length < 2) continue;
    // Sort the cap CORNERS (not the mouths) by angle around pos and connect in
    // that order. A polygon whose vertices are angle-sorted around an interior
    // point is star-shaped, hence ALWAYS simple — so even when two mouths meet
    // at an acute angle and their caps would otherwise cross, the pad never
    // self-intersects (which would fold the fan triangulation and reintroduce
    // the overlap this feature removes). For well-separated mouths each mouth's
    // two corners stay adjacent, so the cap edge — and exact ribbon tiling — is
    // preserved; acute mouths degrade gracefully to a simple polygon.
    const polygon: Vec2[] = mouths
      .flatMap((m): Vec2[] => [[m.right[0], m.right[1]], [m.left[0], m.left[1]]])
      .sort(
        (a, b) =>
          Math.atan2(a[1] - it.pos[1], a[0] - it.pos[0]) -
          Math.atan2(b[1] - it.pos[1], b[0] - it.pos[0]),
      );
    const dominant = streets.reduce((best, s) => {
      const bw = effectiveWidth(best);
      const sw = effectiveWidth(s);
      if (sw > bw) return s;
      if (sw === bw && typeOrder(s.type) > typeOrder(best.type)) return s;
      return best;
    });
    pads.push({ key: it.key, pos: [it.pos[0], it.pos[1]], polygon, dominantStreetId: dominant.id });
  }
  return pads;
}
