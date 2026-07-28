/** Real-world streets and canals imported as ordinary, editable Streets (M3).
 * Pure — no three, no React, no network. */
import type { GeoAnchor } from "./project";
import { project } from "./project";
import type { Street, StreetType, TrafficMode, Vec2 } from "@/lib/street/types";
import {
  effectiveWidth,
  reserveStreetIds,
  STREET_SPECS,
} from "@/lib/street/types";
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

const LANE_WIDTH = 3.2;

/** Typical paved carriageway widths when OSM has no explicit width/lanes.
 * These are deliberately narrower than the hand-drawn corridor defaults:
 * an imported way is the vehicle/pedestrian surface centreline, not the whole
 * street section including verges, sidewalks, median, etc. */
const IMPORTED_HIGHWAY_WIDTH: Record<string, number> = {
  motorway: 14,
  motorway_link: 7,
  trunk: 12,
  trunk_link: 7,
  primary: 10,
  primary_link: 6,
  secondary: 8,
  secondary_link: 5,
  tertiary: 7,
  tertiary_link: 4,
  residential: 6,
  unclassified: 6,
  living_street: 5,
  busway: 3.5,
  pedestrian: 4,
  service: 3.5,
};

function parseLaneValue(raw: string | undefined): number | undefined {
  if (typeof raw !== "string" || !/^\s*\d+(?:\.\d+)?\s*$/.test(raw))
    return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 12 ? n : undefined;
}

/** Best available paved-carriageway width from OSM tags.
 *
 * `STREET_SPECS` describes a whole hand-drawn street corridor. Imported OSM
 * data is different: divided roads are commonly represented as TWO separate
 * one-way centrelines. Giving each one the whole 14–24 m class width makes the
 * two ribbons physically overlap. Prefer explicit width, then lane count; a
 * one-way way with no lane tag gets a conservative carriageway width by class.
 * A normal untagged two-way road stays undefined and keeps the class default. */
export function inferWayWidth(
  tags: Record<string, string> | undefined,
  type: StreetType,
): number | undefined {
  const explicit = parseWidth(tags);
  if (explicit !== undefined) return explicit;
  if (!tags || type === "canal") return undefined;

  const lanes =
    parseLaneValue(tags.lanes) ??
    (() => {
      const forward = parseLaneValue(tags["lanes:forward"]);
      const backward = parseLaneValue(tags["lanes:backward"]);
      return forward !== undefined || backward !== undefined
        ? (forward ?? 0) + (backward ?? 0)
        : undefined;
    })();
  if (lanes !== undefined)
    return Math.min(STREET_SPECS[type].width, lanes * LANE_WIDTH);

  if (["yes", "true", "1", "-1"].includes(tags.oneway ?? "")) {
    const oneWayWidth: Record<Exclude<StreetType, "canal">, number> = {
      alley: 3.5,
      street: 3.5,
      road: 4,
      boulevard: 7,
    };
    return Math.min(
      STREET_SPECS[type].width,
      oneWayWidth[type as Exclude<StreetType, "canal">],
    );
  }

  const importedDefault = tags.highway
    ? IMPORTED_HIGHWAY_WIDTH[tags.highway]
    : undefined;
  return importedDefault === undefined
    ? undefined
    : Math.min(STREET_SPECS[type].width, importedDefault);
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

const PARALLEL_SIN = Math.sin((3 * Math.PI) / 180);
const PARALLEL_MIN_RUN = 8;
const PARALLEL_EDGE_GAP = 0.15;
const IMPORTED_WIDTH_MIN = 2;

/** Removes sustained coincident ribbon area from imported networks.
 *
 * Old fixtures/saves predate tag-aware widths and therefore contain separate
 * OSM carriageways at the full hand-drawn corridor width. For each pair of
 * near-parallel imported segments sharing at least 8 m of run, cap their
 * widths so the two ribbon edges retain a small gap. Widths only ever shrink,
 * so constraints already satisfied by earlier pairs remain satisfied. Hand-
 * drawn streets, canals, crossings, and short junction approaches are left
 * alone. Pure: returns the original array when no width changes. */
export function normalizeImportedStreetWidths(streets: Street[]): Street[] {
  const widths = streets.map(effectiveWidth);
  const changed = new Set<number>();
  const segments: {
    streetIdx: number;
    a: Vec2;
    b: Vec2;
    ux: number;
    uz: number;
    length: number;
  }[] = [];
  streets.forEach((street, streetIdx) => {
    if (!street.id.startsWith("street-osm-") || street.type === "canal") return;
    for (let i = 0; i < street.points.length - 1; i++) {
      const a = street.points[i];
      const b = street.points[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      if (length < 1e-6) continue;
      segments.push({
        streetIdx,
        a,
        b,
        ux: dx / length,
        uz: dz / length,
        length,
      });
    }
  });

  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j];
      if (a.streetIdx === b.streetIdx) continue;
      if (Math.abs(a.ux * b.uz - a.uz * b.ux) > PARALLEL_SIN) continue;

      // Signed perpendicular distance to A's supporting line. Opposite signs
      // mean B crosses A — a junction, not parallel carriageways.
      const side = (p: Vec2) =>
        (p[0] - a.a[0]) * -a.uz + (p[1] - a.a[1]) * a.ux;
      const d0 = side(b.a);
      const d1 = side(b.b);
      if (d0 * d1 < 0) continue;
      const separation = Math.min(Math.abs(d0), Math.abs(d1));

      const along = (p: Vec2) =>
        (p[0] - a.a[0]) * a.ux + (p[1] - a.a[1]) * a.uz;
      const t0 = along(b.a);
      const t1 = along(b.b);
      const run =
        Math.min(a.length, Math.max(t0, t1)) -
        Math.max(0, Math.min(t0, t1));
      if (run < PARALLEL_MIN_RUN) continue;

      const ai = a.streetIdx;
      const bi = b.streetIdx;
      const maxSum =
        2 * Math.max(IMPORTED_WIDTH_MIN, separation - PARALLEL_EDGE_GAP);
      const sum = widths[ai] + widths[bi];
      if (sum <= maxSum + 1e-6) continue;

      const ratio = maxSum / sum;
      let aw = Math.max(IMPORTED_WIDTH_MIN, widths[ai] * ratio);
      let bw = Math.max(IMPORTED_WIDTH_MIN, widths[bi] * ratio);
      let excess = aw + bw - maxSum;
      if (excess > 0) {
        const takeA = Math.min(excess, Math.max(0, aw - IMPORTED_WIDTH_MIN));
        aw -= takeA;
        excess -= takeA;
        bw -= Math.min(excess, Math.max(0, bw - IMPORTED_WIDTH_MIN));
      }
      if (aw < widths[ai] - 1e-6) {
        widths[ai] = aw;
        changed.add(ai);
      }
      if (bw < widths[bi] - 1e-6) {
        widths[bi] = bw;
        changed.add(bi);
      }
    }
  }

  if (changed.size === 0) return streets;
  return streets.map((street, i) =>
    changed.has(i)
      ? { ...street, width: Math.round(widths[i] * 1000) / 1000 }
      : street,
  );
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
 * care about a minimum street length filter afterwards.
 *
 * `protectedIdx` — indices into `points` that must NEVER be dropped even when
 * closer than `minSeg` to a kept neighbour. OSM splits ways exactly at real
 * junctions, so an interior vertex of a merged chain is frequently precisely
 * where a different street/bridge/canal meets it; collapsing it away would
 * silently delete that junction (`deriveIntersections` would no longer find
 * it, and `moveStreetNode` would stop treating the two streets as welded). */
export function collapseShortSegments(
  points: Vec2[],
  minSeg: number,
  protectedIdx: ReadonlySet<number> = new Set(),
): Vec2[] {
  if (points.length <= 2) return points.map((p): Vec2 => [p[0], p[1]]);
  const out: Vec2[] = [[points[0][0], points[0][1]]];
  const outIdx: number[] = [0];
  for (let i = 1; i < points.length - 1; i++) {
    if (protectedIdx.has(i) || dist(out[out.length - 1], points[i]) >= minSeg) {
      out.push([points[i][0], points[i][1]]);
      outIdx.push(i);
    }
  }
  const finalPt: Vec2 = [points[points.length - 1][0], points[points.length - 1][1]];
  // Also drop trailing kept vertices that would otherwise leave the FINAL
  // segment short — never pops a protected junction vertex, and never pops
  // below the first vertex.
  while (
    out.length > 1 &&
    dist(out[out.length - 1], finalPt) < minSeg &&
    !protectedIdx.has(outIdx[outIdx.length - 1])
  ) {
    out.pop();
    outIdx.pop();
  }
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
  const chains = mergeWays(usable);

  // Coordinates shared by ways belonging to >= 2 DIFFERENT merged chains are
  // genuine cross-street junctions — OSM splits ways at every real crossing,
  // so the shared node's EXACT raw lat/lon appears in both ways' geometry.
  // Built and looked up entirely from RAW lat/lon (never the projected local
  // frame), keyed the same exact-coordinate way `mergeWays`' own `endKey`
  // does, so "shared" here is identical to what junction derivation matches
  // on and there is no float-reprojection drift to worry about. A coordinate
  // shared only by ways WITHIN the same chain is just an internal OSM
  // way-split seam (a tag change, not a real junction) and must stay
  // collapsible — that IS the fix this file exists for.
  const coordToChains = new Map<string, Set<number>>();
  chains.forEach((chain, chainIdx) => {
    for (const w of chain) {
      for (const p of w.geometry ?? []) {
        const k = endKey(p);
        let set = coordToChains.get(k);
        if (!set) { set = new Set(); coordToChains.set(k, set); }
        set.add(chainIdx);
      }
    }
  });
  const junctionCoords = new Set(
    [...coordToChains].filter(([, s]) => s.size >= 2).map(([k]) => k),
  );

  const all: Street[] = [];
  for (const chain of chains) {
    const cls = classifyWay(chain[0].tags);
    if (!cls) continue;
    const points: Vec2[] = [];
    const junctionIdx = new Set<number>();
    for (const w of chain) {
      for (const p of w.geometry!) {
        const xz = project(p.lat, p.lon, anchor);
        // Drop the duplicated shared node where two ways join.
        const last = points[points.length - 1];
        if (last && last[0] === xz[0] && last[1] === xz[1]) continue;
        if (junctionCoords.has(endKey(p))) junctionIdx.add(points.length);
        points.push(xz);
      }
    }
    if (points.length < 2) continue;
    const width = inferWayWidth(chain[0].tags, cls.type);
    all.push({
      id: `street-osm-${chain[0].id}${chain.length > 1 ? "m" : ""}`,
      type: cls.type,
      points: collapseShortSegments(points, MIN_STREET_SEG, junctionIdx),
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
  const streets = normalizeImportedStreetWidths(
    truncated ? ordered.slice(0, maxStreets) : ordered,
  );
  // Keep the session id counter clear of these ids so a later hand-drawn
  // street can never collide with an imported one.
  reserveStreetIds(streets);
  return { streets, truncated, total };
}
