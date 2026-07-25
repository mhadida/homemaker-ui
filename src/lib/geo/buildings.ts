/** Real-world building footprints loaded as inert backdrop context (M2).
 * Pure — no three, no React, no network. */
import type { GeoAnchor } from "./project";
import { project } from "./project";
import type { Ground } from "@/lib/facade/terrain";
import { groundHeightAt } from "@/lib/facade/terrain";

export type Vec2 = [number, number];

export interface ContextBuilding {
  /** OSM element id, e.g. "way/123456" — stable across re-fetch, so it is the
   * key `hiddenIds` stores. */
  id: string;
  /** Local metres [x, z], projected through the scene's GeoAnchor. */
  footprint: Vec2[];
  /** Resolved height in metres — always finite and > 0. */
  height: number;
}

export interface FetchResult {
  buildings: ContextBuilding[];
  /** true when maxBuildings clipped the result. */
  truncated: boolean;
  /** how many the source returned, BEFORE the cap. */
  total: number;
}

/** The subset of an Overpass `out geom` element we consume. */
export interface OsmElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

export const DEFAULT_BUILDING_HEIGHT = 8;
const METRES_PER_LEVEL = 3;

/** Leading number out of an OSM tag that may carry a unit suffix ("12 m") or
 * a decimal comma ("12,5"). null when there is no number at all. */
function parseNum(v: string | undefined): number | null {
  if (typeof v !== "string") return null;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(v);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** height tag → building:levels x 3 → DEFAULT_BUILDING_HEIGHT. A non-positive
 * or unparseable value falls through to the next rule. */
export function resolveHeight(tags: Record<string, string> | undefined): number {
  const h = parseNum(tags?.height);
  if (h !== null && h > 0) return h;
  const levels = parseNum(tags?.["building:levels"]);
  if (levels !== null && levels > 0) return levels * METRES_PER_LEVEL;
  return DEFAULT_BUILDING_HEIGHT;
}

/** Overpass elements → local-frame buildings, capped at maxBuildings with the
 * pre-cap total reported (callers surface truncation; never a silent cap). */
export function osmToContextBuildings(
  elements: OsmElement[],
  anchor: GeoAnchor,
  maxBuildings: number,
): FetchResult {
  const all: ContextBuilding[] = [];
  for (const el of elements) {
    const g = el.geometry;
    if (!Array.isArray(g) || g.length < 3) continue;
    const pts = g.slice();
    // A closed way repeats its first node last — drop it so the polygon has
    // no duplicate vertex.
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (pts.length > 3 && first.lat === last.lat && first.lon === last.lon) pts.pop();
    if (pts.length < 3) continue;
    all.push({
      id: `${el.type}/${el.id}`,
      footprint: pts.map((p) => project(p.lat, p.lon, anchor)),
      height: resolveHeight(el.tags),
    });
  }
  const total = all.length;
  const truncated = total > maxBuildings;
  return {
    buildings: truncated ? all.slice(0, maxBuildings) : all,
    truncated,
    total,
  };
}

/** Lowest ground height under the footprint — the base a context building sits
 * on, so it never floats on a slope (it buries into the uphill side instead). */
export function footprintBase(footprint: Vec2[], ground: Ground): number {
  let min = Infinity;
  for (const [x, z] of footprint) min = Math.min(min, groundHeightAt(x, z, ground));
  return Number.isFinite(min) ? min : 0;
}

/** Everything the user has not demolished. */
export function visibleBuildings(
  all: ContextBuilding[],
  hidden: ReadonlySet<string>,
): ContextBuilding[] {
  return hidden.size === 0 ? all : all.filter((b) => !hidden.has(b.id));
}
