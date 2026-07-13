/** Global topography: a tilted ground plane. slope = rise/run, azimuth =
 * uphill bearing in degrees. h(x,z) = slope·(x·sin az + z·cos az). */
export interface Ground {
  slope: number;
  azimuth: number;
}

export const DEFAULT_GROUND: Ground = { slope: 0, azimuth: 0 };
export const GROUND_SLOPE_MAX = 0.3;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Ground height at plan (x, z). */
export function groundHeightAt(x: number, z: number, g: Ground): number {
  if (!g.slope) return 0;
  const a = rad(g.azimuth);
  return g.slope * (x * Math.sin(a) + z * Math.cos(a));
}

export interface Leveling {
  /** floor datum: ground height at the building front-centre. */
  datum: number;
  /** how far the basement must reach below the floor (≥ 0). */
  drop: number;
}

/** A building at world (cx, cz), rotated rotationY, with footprint
 * width × depth (local x ∈ ±w/2, local z ∈ [0, −depth]): its floor datum
 * (front-centre ground height) and the basement drop (datum minus the
 * lowest footprint-corner ground height). */
export function levelingFor(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  rotationY: number,
  g: Ground,
): Leveling {
  const datum = groundHeightAt(cx, cz, g);
  if (!g.slope) return { datum, drop: 0 };
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  let minH = datum;
  for (const lx of [-width / 2, width / 2]) {
    for (const lz of [0, -depth]) {
      // three.js Y-rotation of a local (lx, ·, lz) offset
      const wx = cx + lx * cos + lz * sin;
      const wz = cz - lx * sin + lz * cos;
      minH = Math.min(minH, groundHeightAt(wx, wz, g));
    }
  }
  return { datum, drop: Math.max(0, datum - minH) };
}

/** Upward unit normal of the ground surface — drives the ground-mesh tilt
 * (quaternion from +y to this). */
export function groundNormal(g: Ground): [number, number, number] {
  if (!g.slope) return [0, 1, 0];
  const a = rad(g.azimuth);
  const nx = -g.slope * Math.sin(a);
  const nz = -g.slope * Math.cos(a);
  const len = Math.hypot(nx, 1, nz);
  return [nx / len, 1 / len, nz / len];
}
