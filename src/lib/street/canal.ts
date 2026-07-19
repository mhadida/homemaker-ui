import type { Street, StreetNetwork, Vec2 } from "./types";
import { effectiveWidth } from "./types";
import { streetRibbon, closestPointOnSegment } from "./geometry";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";
import type { Intersection } from "./intersections";

/** Canal cross-section constants (metres). */
export const CANAL_QUAY = 0.5;        // quay-wall thickness
export const CANAL_SIDEWALK = 3;      // walkable band each bank
export const CANAL_WATER_DEPTH = 2.5; // water level below the lowest bank (real quays read deep)
export const CANAL_BED_DEPTH = 1.2;   // visible bed below the water surface
export const BRIDGE_DECK_WIDTH = 3;   // footbridge breadth (along the canal)
export const BRIDGE_RISE = 1.5;       // arch apex above bank grade

export type Vec3 = [number, number, number];

/** The three offset ribbons of a canal: water edge (½W), quay foot (½W+quay),
 * bank / building line (½W+quay+sidewalk). Each is a mitered streetRibbon. */
export function canalOffsets(centreline: Vec2[], width: number) {
  return {
    water: streetRibbon(centreline, width),
    quayFoot: streetRibbon(centreline, width + 2 * CANAL_QUAY),
    bank: streetRibbon(centreline, width + 2 * CANAL_QUAY + 2 * CANAL_SIDEWALK),
  };
}

/** The single level water-surface Y: WATER_DEPTH below the lowest bank-edge
 * ground point, so the level pool never floods. Flat ground → grade − depth. */
export function canalWaterY(centreline: Vec2[], width: number, ground: Ground): number {
  const { bank } = canalOffsets(centreline, width);
  let minG = Infinity;
  for (const p of [...bank.left, ...bank.right]) {
    const g = groundHeightAt(p[0], p[1], ground);
    if (g < minG) minG = g;
  }
  return minG - CANAL_WATER_DEPTH;
}

/** The closed plan outline of a canal's cut through the ground plane: the
 * BANK ribbon (outer sidewalk edge) as one loop — left side out, right side
 * back. The ground punches this as a hole (the sidewalks re-cover the rim,
 * so the seam hides); the quay walls + bed line the cut. Uses the same
 * fillet the canal mesh renders with so hole and masonry coincide. null for
 * degenerate polylines. */
export function canalHoleOutline(
  centreline: Vec2[],
  width: number,
): Vec2[] | null {
  if (centreline.length < 2) return null;
  const { bank } = canalOffsets(centreline, width);
  if (bank.left.length < 2) return null;
  return [...bank.left, ...[...bank.right].reverse()];
}

/** Ground rise along a canal beyond this is called out — the level pool sits
 * WATER_DEPTH under the LOWEST bank, so every metre of climb is a metre of
 * extra quay wall at the high end. Roughly one lock's worth. */
export const CANAL_GRADE_TOLERANCE = 1;

/** Advisory (never blocking, mirrors streetAdvisory): a canal drawn up a
 * slope makes no sense — water is level. Measures the ground rise along the
 * centreline (vertices + midpoints); null when within tolerance, for
 * non-canals, and on flat ground. */
export function canalGradeAdvisory(street: Street, ground: Ground): string | null {
  if (street.type !== "canal" || street.points.length < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  const sample = (x: number, z: number) => {
    const g = groundHeightAt(x, z, ground);
    if (g < min) min = g;
    if (g > max) max = g;
  };
  for (let i = 0; i < street.points.length; i++) {
    const p = street.points[i];
    sample(p[0], p[1]);
    if (i > 0) {
      const q = street.points[i - 1];
      sample((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
  }
  const rise = max - min;
  if (rise <= CANAL_GRADE_TOLERANCE) return null;
  return `This canal climbs ${rise.toFixed(1)} m — water stays level, so the high end digs a ${rise.toFixed(1)} m trench. Route it along the contours (or flatten the ground).`;
}

export interface BridgePlacement {
  key: string;
  pos: Vec2;
  tangent: Vec2;   // unit canal direction at pos
  span: number;    // bank-to-bank crossing length
}

/** Unit canal direction at `pos` — direction of the nearest canal segment
 * (locate by pos, not the ambiguous incident.vertex index). */
function canalTangentAt(street: Street, pos: Vec2): Vec2 {
  const pts = street.closed ? [...street.points, street.points[0]] : street.points;
  let best = Infinity;
  let dir: Vec2 = [1, 0];
  for (let i = 0; i < pts.length - 1; i++) {
    const c = closestPointOnSegment(pos, pts[i], pts[i + 1]);
    if (c.dist < best) {
      best = c.dist;
      const dx = pts[i + 1][0] - pts[i][0];
      const dz = pts[i + 1][1] - pts[i][1];
      const L = Math.hypot(dx, dz) || 1;
      dir = [dx / L, dz / L];
    }
  }
  return dir;
}

/** A footbridge at every junction mixing a canal with a land street. */
export function bridgesFor(net: StreetNetwork, intersections: Intersection[]): BridgePlacement[] {
  const typeById = new Map(net.streets.map((s) => [s.id, s.type]));
  const streetById = new Map(net.streets.map((s) => [s.id, s]));
  const out: BridgePlacement[] = [];
  for (const it of intersections) {
    const types = it.incident.map((i) => typeById.get(i.streetId));
    const hasCanal = types.some((t) => t === "canal");
    const hasLand = types.some((t) => t !== undefined && t !== "canal");
    if (!hasCanal || !hasLand) continue;
    const canalInc = it.incident.find((i) => typeById.get(i.streetId) === "canal")!;
    const canal = streetById.get(canalInc.streetId)!;
    out.push({
      key: it.key,
      pos: it.pos,
      tangent: canalTangentAt(canal, it.pos),
      span: effectiveWidth(canal) + 2 * CANAL_QUAY,
    });
  }
  return out;
}

const BRIDGE_DECK_THICKNESS = 0.4;
const BRIDGE_PARAPET_H = 0.5;

/** Humpback footbridge as a triangle soup, LOCAL frame: x across the span
 * [-span/2, span/2], z the deck breadth [-deckWidth/2, deckWidth/2], y up with
 * the springing at y=0. Parabolic profile rising `rise` at centre. Winding is
 * not guaranteed — the mesh auto-orients by normal. */
export function bridgeArch(span: number, rise: number, deckWidth: number, samples = 12): Vec3[] {
  const hs = span / 2;
  const wd = deckWidth / 2;
  const prof = (x: number) => rise * (1 - (2 * x / span) ** 2);
  const out: Vec3[] = [];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => out.push(a, b, c, a, c, d);
  const xs: number[] = [];
  for (let i = 0; i <= samples; i++) xs.push(-hs + (span * i) / samples);
  for (let i = 0; i < samples; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    const y0 = prof(x0), y1 = prof(x1);
    const b0 = y0 - BRIDGE_DECK_THICKNESS, b1 = y1 - BRIDGE_DECK_THICKNESS;
    quad([x0, y0, -wd], [x1, y1, -wd], [x1, y1, wd], [x0, y0, wd]);   // deck top
    quad([x0, b0, wd], [x1, b1, wd], [x1, b1, -wd], [x0, b0, -wd]);   // underside
    quad([x0, b0, -wd], [x1, b1, -wd], [x1, y1, -wd], [x0, y0, -wd]); // side -z
    quad([x0, y0, wd], [x1, y1, wd], [x1, b1, wd], [x0, b0, wd]);     // side +z
    for (const zc of [-wd, wd]) {                                     // parapets
      quad([x0, y0, zc], [x1, y1, zc],
           [x1, y1 + BRIDGE_PARAPET_H, zc], [x0, y0 + BRIDGE_PARAPET_H, zc]);
    }
  }
  return out;
}
