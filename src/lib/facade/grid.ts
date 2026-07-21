/** Rectilinear drawing grid: optional snap for the pen and road tools.
 *
 * The grid is square with GRID_SPACING metre cells, rotated `angleDeg`
 * degrees from north (plan up, −z). Snapping rotates the point into the
 * grid frame, rounds to the nearest cell corner, and rotates back. Weld /
 * street endpoint snapping runs AFTER this and wins — joining existing
 * geometry beats the grid. */

export const GRID_SPACING = 5;

export type Vec2 = [number, number];

export function snapToGrid(
  p: Vec2,
  angleDeg: number,
  spacing: number = GRID_SPACING,
): Vec2 {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // into the grid frame (rotate by −a)
  const gx = p[0] * c + p[1] * s;
  const gz = -p[0] * s + p[1] * c;
  const rx = Math.round(gx / spacing) * spacing;
  const rz = Math.round(gz / spacing) * spacing;
  // back to world (rotate by +a)
  return [rx * c - rz * s, rx * s + rz * c];
}

/** Grid snap constrained to 90° increments of the grid direction: the point is
 * pulled onto the grid axis running through `anchor`, so a drawn segment can
 * only run along the grid, never diagonally across it.
 *
 * The offset is measured from the ANCHOR, not from the world origin. A
 * committed vertex need not sit on the lattice — weld snapping wins over the
 * grid, so it may have been pulled onto an existing node. Rounding to the world
 * lattice would then produce a segment that neither starts at the anchor nor
 * stays on the axis (a small perpendicular jog at every welded corner);
 * anchoring the offset keeps it exactly axis-aligned and a whole number of
 * cells long wherever the anchor happens to be.
 *
 * `anchor === null` — the first vertex of a chain, with nothing to be
 * orthogonal to — falls back to plain `snapToGrid`.
 *
 * The dominant component wins (ties go to grid-x). Within half a cell the
 * result collapses ONTO the anchor, so callers must reject zero-length
 * segments. Pure. */
export function snapToGridAxis(
  p: Vec2,
  anchor: Vec2 | null,
  angleDeg: number,
  spacing: number = GRID_SPACING,
): Vec2 {
  if (!anchor) return snapToGrid(p, angleDeg, spacing);
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // into the grid frame (rotate by −a)
  const ax = anchor[0] * c + anchor[1] * s;
  const az = -anchor[0] * s + anchor[1] * c;
  const px = p[0] * c + p[1] * s;
  const pz = -p[0] * s + p[1] * c;
  const dx = px - ax;
  const dz = pz - az;
  const alongX = Math.abs(dx) >= Math.abs(dz);
  const gx = alongX ? ax + Math.round(dx / spacing) * spacing : ax;
  const gz = alongX ? az : az + Math.round(dz / spacing) * spacing;
  // back to world (rotate by +a)
  return [gx * c - gz * s, gx * s + gz * c];
}
