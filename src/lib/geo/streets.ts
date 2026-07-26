/** Real-world streets and canals imported as ordinary, editable Streets (M3).
 * Pure — no three, no React, no network. */
import type { GeoAnchor } from "./project";
import { project } from "./project";
import type { Street, StreetType, TrafficMode, Vec2 } from "@/lib/street/types";
import { reserveStreetIds } from "@/lib/street/types";
import { MIN_STREET_SEG } from "@/lib/street/intersections";

export interface OsmWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

export interface StreetFetchResult {
  streets: Street[];
  truncated: boolean;
  total: number;
}

/** OSM highway class → our StreetType. Anything absent from this table is
 * DROPPED: footways, cycleways, steps and paths are 48% of the ways in a city
 * bbox and are not streets in this model. */
const HIGHWAY_TYPES: Record<string, StreetType> = {
  motorway: "boulevard",
  motorway_link: "boulevard",
  trunk: "boulevard",
  trunk_link: "boulevard",
  primary: "boulevard",
  primary_link: "boulevard",
  secondary: "road",
  secondary_link: "road",
  tertiary: "road",
  tertiary_link: "road",
  residential: "street",
  unclassified: "street",
  living_street: "street",
  busway: "street",
  service: "alley",
};

export function classifyWay(
  tags: Record<string, string> | undefined,
): { type: StreetType; traffic?: TrafficMode } | null {
  if (!tags) return null;
  if (tags.waterway === "canal") return { type: "canal" };
  const hw = tags.highway;
  if (!hw) return null;
  // `highway=* area=yes` tags a PAVED AREA (a pedestrian square, a plaza), not
  // a centreline — its "way" is the polygon outline, so importing it as a
  // street draws a paved ring tracing the square's perimeter instead of the
  // square itself. Drop it; it's a polygon, not a road.
  if (tags.area === "yes") return null;
  // A real street that happens to be car-free — exactly what the existing
  // `peds` traffic mode models (Dutch city centres).
  if (hw === "pedestrian") return { type: "street", traffic: "peds" };
  const type = HIGHWAY_TYPES[hw];
  return type ? { type } : null;
}

const WIDTH_MIN = 1;
const WIDTH_MAX = 60;

/** OSM `width` in metres. Tolerates a unit suffix ("12 m") and a decimal
 * comma; rejects anything outside a sane road width so a mis-tagged value
 * cannot produce an absurd ribbon. */
export function parseWidth(tags: Record<string, string> | undefined): number | undefined {
  const raw = tags?.width;
  if (typeof raw !== "string") return undefined;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(raw);
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n < WIDTH_MIN || n > WIDTH_MAX) return undefined;
  return n;
}

const endKey = (p: { lat: number; lon: number }) => `${p.lat},${p.lon}`;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += dist(points[i], points[i + 1]);
  return total;
}

/** Collapses consecutive vertices closer than `minSeg`, keeping the first and
 * last vertex EXACTLY — merged-chain endpoints (and shared-vertex junction
 * derivation) match on exact equality, so they must never move. Real OSM
 * geometry has vertices a few centimetres apart (measured: 71 sub-1m segments
 * across 22 of 227 streets in a real import, minimum 5.6 cm) that would
 * otherwise degenerate the ribbon-offset math `MIN_STREET_SEG` exists to
 * guard against, and permanently reject any `moveStreetNode` drag touching
 * one. A street that collapses end-to-end to fewer than `minSeg` apart is
 * still emitted as a short 2-point stub rather than dropped — callers that
 * care about a minimum street length filter afterwards. */
export function collapseShortSegments(points: Vec2[], minSeg: number): Vec2[] {
  if (points.length <= 2) return points.map((p): Vec2 => [p[0], p[1]]);
  const out: Vec2[] = [[points[0][0], points[0][1]]];
  for (let i = 1; i < points.length - 1; i++) {
    if (dist(out[out.length - 1], points[i]) >= minSeg) {
      out.push([points[i][0], points[i][1]]);
    }
  }
  const finalPt: Vec2 = [points[points.length - 1][0], points[points.length - 1][1]];
  // Also drop trailing kept vertices that would otherwise leave the FINAL
  // segment short — never pops below the first vertex.
  while (out.length > 1 && dist(out[out.length - 1], finalPt) < minSeg) out.pop();
  out.push(finalPt);
  return out;
}

/** OSM splits one human street into many ways (at every tag change and
 * junction) — "Herengracht" is 8 separate ways. Chain contiguous ways sharing
 * (name, mapped type) back into whole streets so the network reads like
 * hand-drawn work instead of a field of stubs. Unnamed ways have no reliable
 * key, so they never merge. */
export function mergeWays(ways: OsmWay[]): OsmWay[][] {
  const out: OsmWay[][] = [];
  // Keyed by mapped type, then by name — avoids gluing an arbitrary
  // delimiter into a string key that a street name could itself contain.
  const groups = new Map<StreetType, Map<string, OsmWay[]>>();
  for (const w of ways) {
    const cls = classifyWay(w.tags);
    const name = w.tags?.name;
    const g = w.geometry;
    if (!cls || !name || !g || g.length < 2) {
      out.push([w]); // ungroupable — stands alone
      continue;
    }
    let byName = groups.get(cls.type);
    if (!byName) {
      byName = new Map<string, OsmWay[]>();
      groups.set(cls.type, byName);
    }
    const list = byName.get(name);
    if (list) list.push(w);
    else byName.set(name, [w]);
  }
  for (const byName of groups.values()) {
    for (const list of byName.values()) {
      const remaining = [...list];
      while (remaining.length) {
        const chain = [remaining.shift()!];
        let grew = true;
        while (grew) {
          grew = false;
          const head = chain[0].geometry!;
          const tail = chain[chain.length - 1].geometry!;
          for (let i = 0; i < remaining.length; i++) {
            const cand = remaining[i].geometry!;
            const cs = endKey(cand[0]);
            const ce = endKey(cand[cand.length - 1]);
            if (ce === endKey(head[0])) { chain.unshift(remaining.splice(i, 1)[0]); grew = true; break; }
            if (cs === endKey(head[0])) {
              const w = remaining.splice(i, 1)[0];
              chain.unshift({ ...w, geometry: [...w.geometry!].reverse() });
              grew = true; break;
            }
            if (cs === endKey(tail[tail.length - 1])) { chain.push(remaining.splice(i, 1)[0]); grew = true; break; }
            if (ce === endKey(tail[tail.length - 1])) {
              const w = remaining.splice(i, 1)[0];
              chain.push({ ...w, geometry: [...w.geometry!].reverse() });
              grew = true; break;
            }
          }
        }
        out.push(chain);
      }
    }
  }
  return out;
}

/** Overpass ways → local-frame Streets: filter, classify, merge, project, cap.
 * The pre-cap total is reported so callers can surface truncation. */
export function osmToStreets(
  ways: OsmWay[],
  anchor: GeoAnchor,
  maxStreets: number,
): StreetFetchResult {
  const usable = ways.filter((w) => classifyWay(w.tags) && (w.geometry?.length ?? 0) >= 2);
  const all: Street[] = [];
  for (const chain of mergeWays(usable)) {
    const cls = classifyWay(chain[0].tags);
    if (!cls) continue;
    const points: Vec2[] = [];
    for (const w of chain) {
      for (const p of w.geometry!) {
        const xz = project(p.lat, p.lon, anchor);
        // Drop the duplicated shared node where two ways join.
        const last = points[points.length - 1];
        if (last && last[0] === xz[0] && last[1] === xz[1]) continue;
        points.push(xz);
      }
    }
    if (points.length < 2) continue;
    const width = parseWidth(chain[0].tags);
    all.push({
      id: `street-osm-${chain[0].id}${chain.length > 1 ? "m" : ""}`,
      type: cls.type,
      points: collapseShortSegments(points, MIN_STREET_SEG),
      ...(width !== undefined ? { width } : {}),
      ...(cls.traffic ? { traffic: cls.traffic } : {}),
    });
  }
  const total = all.length;
  // Longest-first before the cap: `mergeWays` pushes ungroupable (unnamed,
  // short) stubs into its output during the SAME grouping loop that builds
  // merged named chains, so `all`'s order is essentially arbitrary — a
  // straight `slice` would truncate merged, significant streets before
  // one-off stubs just because of encounter order. Ordering by descending
  // polyline length keeps the most significant streets when a real import
  // (~200+ ways) exceeds `maxStreets`.
  const ordered = [...all].sort((a, b) => polylineLength(b.points) - polylineLength(a.points));
  const truncated = total > maxStreets;
  const streets = truncated ? ordered.slice(0, maxStreets) : ordered;
  // Keep the session id counter clear of these ids so a later hand-drawn
  // street can never collide with an imported one.
  reserveStreetIds(streets);
  return { streets, truncated, total };
}
