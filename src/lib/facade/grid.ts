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
