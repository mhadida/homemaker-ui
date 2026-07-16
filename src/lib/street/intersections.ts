import type { StreetNetwork, Vec2 } from "./types";
import { closestPointOnSegment } from "./geometry";

export interface Intersection {
  key: string;
  pos: Vec2;
  kind: "node" | "t" | "x";
  /** `vertex` meaning depends on `kind`: for `"node"` and the branch side of a
   * `"t"` it is a real vertex index (`points[vertex] === pos`); for the
   * through side of a `"t"` and BOTH sides of an `"x"` it is a SEGMENT-start
   * index (the junction is mid-segment, so `points[vertex] !== pos`). Locate a
   * junction on a street via `pos`, not `points[vertex]`. */
  incident: { streetId: string; vertex: number }[];
}

const WELD_EPS = 1e-6;
const ON_SEG_EPS = 1e-4;

const keyOf = (p: Vec2) => `${p[0]}:${p[1]}`;
// X points are computed — round to a stable grid so the key is reproducible.
const roundKey = (p: Vec2) =>
  `${Math.round(p[0] / ON_SEG_EPS) * ON_SEG_EPS}:${Math.round(p[1] / ON_SEG_EPS) * ON_SEG_EPS}`;

/** Proper interior crossing of segment p1p2 with p3p4, or null (parallel,
 * collinear, or meeting only at an endpoint). */
function segCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): Vec2 | null {
  const d1x = p2[0] - p1[0], d1z = p2[1] - p1[1];
  const d2x = p4[0] - p3[0], d2z = p4[1] - p3[1];
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < WELD_EPS) return null; // parallel/collinear
  const s = ((p3[0] - p1[0]) * d2z - (p3[1] - p1[1]) * d2x) / denom;
  const t = ((p3[0] - p1[0]) * d1z - (p3[1] - p1[1]) * d1x) / denom;
  const e = ON_SEG_EPS;
  if (s > e && s < 1 - e && t > e && t < 1 - e) {
    return [p1[0] + s * d1x, p1[1] + s * d1z];
  }
  return null; // endpoint-touch or no crossing
}

/** Intersections are DERIVED, in three passes:
 *  1. shared vertices — a plan point shared (exact equality) by vertices of
 *     ≥ 2 different streets → "node".
 *  2. T-junctions — a vertex of one street lying strictly on a DIFFERENT
 *     street's segment (not already a shared vertex) → "t".
 *  3. X-junctions — a proper interior crossing of two different streets'
 *     segments (mid-span, not an endpoint-touch) → "x".
 * Deduped by key; each entry lists every incident (street, vertex). */
export function deriveIntersections(net: StreetNetwork): Intersection[] {
  const byKey = new Map<string, Intersection>();
  const add = (
    key: string,
    pos: Vec2,
    kind: Intersection["kind"],
    inc: { streetId: string; vertex: number },
  ) => {
    let e = byKey.get(key);
    if (!e) {
      e = { key, pos, kind, incident: [] };
      byKey.set(key, e);
    }
    if (!e.incident.some((i) => i.streetId === inc.streetId && i.vertex === inc.vertex)) {
      e.incident.push(inc);
    }
    return e;
  };
  // Position-based "already a junction here?" — robust to the exact-vs-rounded
  // key mismatch (a T keys exact, an X keys rounded, so a shared point could
  // otherwise slip past a key-only check and double-mark).
  const nearExisting = (p: Vec2) =>
    [...byKey.values()].some(
      (e) =>
        Math.abs(e.pos[0] - p[0]) < ON_SEG_EPS &&
        Math.abs(e.pos[1] - p[1]) < ON_SEG_EPS,
    );

  // Pass 1 — shared vertices (exact). Same as SP-1.
  const vByKey = new Map<string, { pos: Vec2; inc: { streetId: string; vertex: number }[] }>();
  for (const s of net.streets) {
    s.points.forEach((p, vertex) => {
      const k = keyOf(p);
      let v = vByKey.get(k);
      if (!v) { v = { pos: [p[0], p[1]], inc: [] }; vByKey.set(k, v); }
      v.inc.push({ streetId: s.id, vertex });
    });
  }
  for (const [k, v] of vByKey) {
    if (new Set(v.inc.map((i) => i.streetId)).size >= 2) {
      for (const i of v.inc) add(k, v.pos, "node", i);
    }
  }

  // Pass 2 — T: a vertex of A lying strictly ON a segment of a DIFFERENT B,
  // and not already a shared-vertex junction.
  for (const a of net.streets) {
    a.points.forEach((v, vertex) => {
      if (byKey.has(keyOf(v))) return; // already a shared-vertex junction
      for (const b of net.streets) {
        if (b.id === a.id) continue;
        for (let j = 0; j < b.points.length - 1; j++) {
          const b0 = b.points[j], b1 = b.points[j + 1];
          if (
            (Math.abs(v[0] - b0[0]) < WELD_EPS && Math.abs(v[1] - b0[1]) < WELD_EPS) ||
            (Math.abs(v[0] - b1[0]) < WELD_EPS && Math.abs(v[1] - b1[1]) < WELD_EPS)
          ) continue; // coincides with B's vertex → shared-vertex case
          const c = closestPointOnSegment(v, b0, b1);
          if (c.dist < ON_SEG_EPS && c.t > ON_SEG_EPS && c.t < 1 - ON_SEG_EPS) {
            add(keyOf(v), [v[0], v[1]], "t", { streetId: a.id, vertex });
            add(keyOf(v), [v[0], v[1]], "t", { streetId: b.id, vertex: j });
          }
        }
      }
    });
  }

  // Pass 3 — X: proper interior crossing of a segment of A with a segment of a
  // later street B (each unordered pair once).
  const streets = net.streets;
  for (let ai = 0; ai < streets.length; ai++) {
    for (let bi = ai + 1; bi < streets.length; bi++) {
      const a = streets[ai], b = streets[bi];
      for (let i = 0; i < a.points.length - 1; i++) {
        for (let j = 0; j < b.points.length - 1; j++) {
          const p = segCross(a.points[i], a.points[i + 1], b.points[j], b.points[j + 1]);
          if (!p) continue;
          const k = roundKey(p);
          if (byKey.has(k) || nearExisting(p)) continue;
          add(k, p, "x", { streetId: a.id, vertex: i });
          add(k, p, "x", { streetId: b.id, vertex: j });
        }
      }
    }
  }

  return [...byKey.values()];
}

/** Drops roundabout entries whose intersection key is no longer DERIVED
 * (e.g. after deleting a street that made the junction). Keeps every entry
 * still backed by a real intersection. Pure — no-op on an empty network. */
export function pruneRoundabouts(net: StreetNetwork): StreetNetwork {
  const valid = new Set(deriveIntersections(net).map((i) => i.key));
  return { ...net, roundabouts: net.roundabouts.filter(([k]) => valid.has(k)) };
}
