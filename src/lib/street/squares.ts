import type { Monument, StreetNetwork, Vec2 } from "./types";

/** A square: the open void enclosed by a closed-loop street. Fully DERIVED —
 * only the monument choice is stored (network.squares, sparse). */
export interface Square {
  /** the closed-loop street enclosing it */
  streetId: string;
  /** the loop polygon (street.points, first not repeated) */
  ring: Vec2[];
  /** polygon centroid — where a monument stands */
  centroid: Vec2;
  /** which frontage side of the loop faces the void */
  interiorSide: "left" | "right";
  /** interior area, m² */
  area: number;
}

/** Ring buildings' depth (mirrors streetBlocks' STREET_BUILDING_DEPTH via the
 * default parameter — passed in rather than imported to keep the street lib
 * free of facade-lib imports). */
const DEFAULT_BUILDING_DEPTH = 10;

/** Void guard factor: a loop must enclose more than k·depth² or the ring
 * buildings from opposite sides would meet — no void, no square. */
const VOID_GUARD_K = 4;

function signedArea(ring: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

function centroidOf(ring: Vec2[]): Vec2 {
  const A = signedArea(ring);
  if (Math.abs(A) < 1e-9) return [ring[0][0], ring[0][1]];
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    const cross = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * cross;
    cz += (z1 + z2) * cross;
  }
  return [cx / (6 * A), cz / (6 * A)];
}

/** Ray-cast point-in-polygon (even-odd). */
function pointInPolygon(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (
      zi > p[1] !== zj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Every closed-loop street big enough to enclose a real void becomes a
 * square. The interior side is found by GEOMETRY (a probe point a short
 * offset off the first segment's midpoint, tested against the ring) — robust
 * to CW/CCW winding and non-convex loops. */
export function deriveSquares(
  net: StreetNetwork,
  buildingDepth: number = DEFAULT_BUILDING_DEPTH,
): Square[] {
  const out: Square[] = [];
  for (const s of net.streets) {
    if (!s.closed || s.points.length < 3) continue;
    const ring = s.points;
    const area = Math.abs(signedArea(ring));
    if (area <= VOID_GUARD_K * buildingDepth * buildingDepth) continue;
    const [a, b] = [ring[0], ring[1]];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) continue;
    // left-perpendicular of the segment tangent — same convention as
    // streetRibbon/frontage.
    const nx = -dz / len;
    const nz = dx / len;
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const probe = 1.5;
    const leftP: Vec2 = [mid[0] + nx * probe, mid[1] + nz * probe];
    const rightP: Vec2 = [mid[0] - nx * probe, mid[1] - nz * probe];
    const interiorSide = pointInPolygon(leftP, ring)
      ? ("left" as const)
      : pointInPolygon(rightP, ring)
        ? ("right" as const)
        : null;
    if (!interiorSide) continue;
    out.push({
      streetId: s.id,
      ring,
      centroid: centroidOf(ring),
      interiorSide,
      area,
    });
  }
  return out;
}

/** True when a street-derived block lines a square's interior — its massing
 * backs onto the void, so it earns a second facade facing the square. */
export function isSquareFrontingBlock(
  block: { source?: { streetId: string; side: "left" | "right" } },
  squares: Square[],
): boolean {
  const src = block.source;
  if (!src) return false;
  return squares.some(
    (q) => q.streetId === src.streetId && q.interiorSide === src.side,
  );
}

/** Drops monument entries whose loop is no longer a derived square (loop
 * deleted or opened). Mirrors pruneRoundabouts. */
export function pruneSquareMonuments(net: StreetNetwork): StreetNetwork {
  const entries = net.squares ?? [];
  if (entries.length === 0) return net;
  const valid = new Set(deriveSquares(net).map((q) => q.streetId));
  return { ...net, squares: entries.filter(([id]) => valid.has(id)) };
}

export type SquareMonumentEntry = [string, Monument];
