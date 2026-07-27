import type { Monument, Street, StreetNetwork, Vec2 } from "./types";
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

/** A single street segment, referenced by street index (into the network's
 * `streets` array) and its start vertex — the segment is
 * `points[seg]..points[seg + 1]`. */
interface SegRef {
  streetIdx: number;
  seg: number;
  a: Vec2;
  b: Vec2;
}

/** Cheap uniform spatial grid over 2D segments — prunes passes 2 and 3 below
 * from O(vertices × segments) / O(segments²) to near-linear. Each segment is
 * inserted into every cell its bounding box (padded a hair for float safety)
 * overlaps; a query returns the union of a 3×3 cell neighbourhood — always a
 * SUPERSET of what a brute-force scan would find, since ON_SEG_EPS is tiny
 * next to any sane cell size, so this can only add candidates, never drop a
 * true one. Only narrows WHICH pairs get tested; every result is still
 * verified with the exact same `closestPointOnSegment`/`segCross` math as
 * before, so output is unaffected by the pruning itself. */
class SegGrid {
  private cells = new Map<string, SegRef[]>();
  constructor(private cellSize: number) {}
  private key(cx: number, cz: number): string {
    return `${cx}:${cz}`;
  }
  insert(ref: SegRef): void {
    const pad = 1e-3; // >> ON_SEG_EPS, << any cell size
    const x0 = Math.floor((Math.min(ref.a[0], ref.b[0]) - pad) / this.cellSize);
    const x1 = Math.floor((Math.max(ref.a[0], ref.b[0]) + pad) / this.cellSize);
    const z0 = Math.floor((Math.min(ref.a[1], ref.b[1]) - pad) / this.cellSize);
    const z1 = Math.floor((Math.max(ref.a[1], ref.b[1]) + pad) / this.cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let arr = this.cells.get(k);
        if (!arr) { arr = []; this.cells.set(k, arr); }
        arr.push(ref);
      }
    }
  }
  /** Every segment sharing the 3×3 cell neighbourhood of `p`, deduped (a
   * segment spanning multiple cells is inserted once per cell, so the same
   * ref object can surface from more than one neighbour — a `Set` on object
   * identity collapses that back to one). */
  near(p: Vec2): SegRef[] {
    const cx = Math.floor(p[0] / this.cellSize);
    const cz = Math.floor(p[1] / this.cellSize);
    const seen = new Set<SegRef>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = this.cells.get(this.key(cx + dx, cz + dz));
        if (arr) for (const ref of arr) seen.add(ref);
      }
    }
    return [...seen];
  }
  /** Every populated cell's bucket — for pairwise candidate generation. */
  buckets(): SegRef[][] {
    return [...this.cells.values()];
  }
}

/** Cell size for `SegGrid`: aim for a handful of segments per cell whether the
 * network is a hand-drawn 5-50-segment sketch or a 1,600-segment real-world
 * import. An empty/degenerate network (no segments, or every point
 * coincident) has nothing to bucket, so any positive size is harmless. */
function gridCellSize(streets: Street[]): number {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let segCount = 0;
  for (const s of streets) {
    segCount += Math.max(0, s.points.length - 1);
    for (const p of s.points) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    }
  }
  if (segCount === 0 || !Number.isFinite(minX)) return 10;
  const area = Math.max(maxX - minX, 1e-6) * Math.max(maxZ - minZ, 1e-6);
  return Math.max(Math.sqrt(area / segCount), 1);
}

function buildSegGrid(streets: Street[]): SegGrid {
  const grid = new SegGrid(gridCellSize(streets));
  streets.forEach((s, streetIdx) => {
    for (let j = 0; j < s.points.length - 1; j++) {
      grid.insert({ streetIdx, seg: j, a: s.points[j], b: s.points[j + 1] });
    }
  });
  return grid;
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

  // A shared grid over every street's segments — passes 2 and 3 both use it
  // to prune candidates to nearby segments only, instead of scanning the
  // whole network for every vertex / every segment pair.
  const segGrid = buildSegGrid(net.streets);

  // Pass 2 — T: a vertex of A lying strictly ON a segment of a DIFFERENT B,
  // and not already a shared-vertex junction. Candidates come from the grid;
  // the (street, vertex) outer iteration order is unchanged from before (an
  // earlier vertex landing on this exact key can still suppress a later one —
  // preserved intentionally so output stays identical), and every match is
  // still verified with the same `closestPointOnSegment` math, so pruning to
  // nearby candidates cannot change the result, only how fast it's found.
  net.streets.forEach((a) => {
    a.points.forEach((v, vertex) => {
      if (byKey.has(keyOf(v))) return; // already a shared-vertex junction
      for (const ref of segGrid.near(v)) {
        const b = net.streets[ref.streetIdx];
        if (b.id === a.id) continue;
        const b0 = ref.a, b1 = ref.b;
        if (
          (Math.abs(v[0] - b0[0]) < WELD_EPS && Math.abs(v[1] - b0[1]) < WELD_EPS) ||
          (Math.abs(v[0] - b1[0]) < WELD_EPS && Math.abs(v[1] - b1[1]) < WELD_EPS)
        ) continue; // coincides with B's vertex → shared-vertex case
        const c = closestPointOnSegment(v, b0, b1);
        if (c.dist < ON_SEG_EPS && c.t > ON_SEG_EPS && c.t < 1 - ON_SEG_EPS) {
          add(keyOf(v), [v[0], v[1]], "t", { streetId: a.id, vertex });
          add(keyOf(v), [v[0], v[1]], "t", { streetId: b.id, vertex: ref.seg });
        }
      }
    });
  });

  // Pass 3 — X: proper interior crossing of a segment of A with a segment of a
  // later street B (each unordered pair once). The grid discovers candidate
  // pairs in arbitrary (bucket) order, but a coincident multi-way crossing
  // depends on WHICH pair is processed first (the `byKey.has(k)` gate below
  // lets only the first winner register) — so candidates are sorted back into
  // the exact (ai, bi, i, j) order the brute-force nested loop used before
  // being processed, making the result independent of discovery order.
  const streets = net.streets;
  const pairKeys = new Set<string>();
  const candidates: [number, number, number, number][] = []; // [ai, i, bi, j], ai < bi
  for (const bucket of segGrid.buckets()) {
    for (let x = 0; x < bucket.length; x++) {
      for (let y = x + 1; y < bucket.length; y++) {
        const r1 = bucket[x], r2 = bucket[y];
        if (r1.streetIdx === r2.streetIdx) continue;
        const [lo, hi] = r1.streetIdx < r2.streetIdx ? [r1, r2] : [r2, r1];
        const pk = `${lo.streetIdx}:${lo.seg}:${hi.streetIdx}:${hi.seg}`;
        if (pairKeys.has(pk)) continue;
        pairKeys.add(pk);
        candidates.push([lo.streetIdx, lo.seg, hi.streetIdx, hi.seg]);
      }
    }
  }
  candidates.sort((p, q) => p[0] - q[0] || p[2] - q[2] || p[1] - q[1] || p[3] - q[3]);
  for (const [ai, i, bi, j] of candidates) {
    const a = streets[ai], b = streets[bi];
    const p = segCross(a.points[i], a.points[i + 1], b.points[j], b.points[j + 1]);
    if (!p) continue;
    const k = roundKey(p);
    if (byKey.has(k) || nearExisting(p)) continue;
    add(k, p, "x", { streetId: a.id, vertex: i });
    add(k, p, "x", { streetId: b.id, vertex: j });
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

/** The shortest legal street segment (m). A drag that leaves any affected
 * segment shorter than this is rejected, and the street pen refuses to append a
 * vertex this close to the previous one — a (near-)zero-length segment
 * degenerates the ribbon offset math. */
export const MIN_STREET_SEG = 1;

/** Move every street vertex sitting EXACTLY at `from` to `to` — a shared
 * endpoint (a welded junction) moves as one, mirroring how block nodes move.
 * Returns null (reject) when no vertex sits at `from`, or when the move
 * would leave a segment touching the moved point shorter than MIN_STREET_SEG.
 * Roundabout entries keyed at the old position follow the junction (an entry
 * already present at the destination wins), and entries the move un-derives
 * are pruned. Pure. */
export function moveStreetNode(
  net: StreetNetwork,
  from: Vec2,
  to: Vec2,
): StreetNetwork | null {
  const at = (p: Vec2, q: Vec2) => p[0] === q[0] && p[1] === q[1];
  let touched = false;
  const streets = net.streets.map((s) => {
    if (!s.points.some((p) => at(p, from))) return s;
    touched = true;
    return {
      ...s,
      points: s.points.map((p) =>
        at(p, from) ? ([to[0], to[1]] as Vec2) : p,
      ),
    };
  });
  if (!touched) return null;

  // Reject degenerate results — only segments that INVOLVE the moved point;
  // a pre-existing short segment elsewhere is not this move's fault.
  for (const s of streets) {
    const n = s.points.length;
    const last = s.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = s.points[i];
      const b = s.points[(i + 1) % n];
      if (!at(a, to) && !at(b, to)) continue;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < MIN_STREET_SEG) return null;
    }
  }

  const fromKey = keyOf(from);
  const toKey = keyOf(to);
  const hasAtTo = net.roundabouts.some(([k]) => k === toKey);
  const roundabouts = net.roundabouts.flatMap<[string, Monument]>(([k, m]) =>
    k === fromKey ? (hasAtTo ? [] : [[toKey, m]]) : [[k, m]],
  );
  return pruneRoundabouts({ streets, roundabouts });
}
