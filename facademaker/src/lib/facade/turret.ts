/** Corner-turret geometry: window placements on the round shaft, and the
 * radius clamp. Pure and color-free — the mesh reads these and paints. The
 * turret straddles a unified corner's node; windows sit on the OUTWARD arc
 * (the ~270° facing the streets, not the inner arc buried against the
 * building), one row per storey. Extends
 * docs/superpowers/specs/2026-07-17-corner-l-roof-design.md. */

/** Default shaft radius (m) — the historical fixed value. */
export const TURRET_RADIUS_DEFAULT = 2.2;
export const TURRET_RADIUS_MIN = 1;
export const TURRET_RADIUS_MAX = 6;

export function clampTurretRadius(r: number): number {
  return Math.max(TURRET_RADIUS_MIN, Math.min(TURRET_RADIUS_MAX, r));
}

export interface TurretWindow {
  /** Plan angle around the shaft; the outward (radial) direction there is
   * [cos angle, sin angle] over plan (x, z). */
  angle: number;
  /** Window vertical centre, relative to the shaft datum. */
  cy: number;
  width: number;
  height: number;
}

/** Windows on the turret shaft: one evenly-spaced row per full storey that
 * lies within the shaft [baseY, wallTop], each row spread across the outward
 * arc. Count per row scales with the arc length (a fatter turret gets more),
 * capped. Empty for a degenerate shaft. Deterministic (no randomness). */
export function turretWindows(opts: {
  radius: number;
  /** Shaft bottom (relative to datum): 0 for a to-ground turret, the first
   * floor for a corbelled one. */
  baseY: number;
  /** Shaft top (the eave, before the cone rise), relative to datum. */
  wallTop: number;
  /** Floor levels relative to datum, ascending, length storeys+1. */
  storeyLevels: number[];
  /** Plan angle the outward arc centres on. */
  outwardAngle: number;
  /** Total arc the windows span; default 270°. */
  arcSpan?: number;
}): TurretWindow[] {
  const { radius, baseY, wallTop, storeyLevels, outwardAngle } = opts;
  const arcSpan = opts.arcSpan ?? 1.5 * Math.PI;
  if (radius <= 0 || wallTop <= baseY) return [];
  const perRow = Math.max(1, Math.min(6, Math.round((arcSpan * radius) / 2.4)));
  const out: TurretWindow[] = [];
  for (let s = 0; s < storeyLevels.length - 1; s++) {
    const floor = storeyLevels[s];
    const top = storeyLevels[s + 1];
    if (floor < baseY - 1e-6) continue; // below a corbelled shaft
    if (top > wallTop + 1e-6) continue; // above the eave
    const sh = top - floor;
    if (sh <= 0.6) continue; // storey too short for a window
    const height = 0.55 * sh;
    const cy = floor + 0.28 * sh + height / 2;
    for (let i = 0; i < perRow; i++) {
      const angle = outwardAngle - arcSpan / 2 + ((i + 0.5) * arcSpan) / perRow;
      out.push({ angle, cy, width: 0.85, height });
    }
  }
  return out;
}
