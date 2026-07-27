export interface Heightfield {
  /** world metres of sample [0][0] */
  originX: number;
  originZ: number;
  /** metre grid step */
  spacing: number;
  cols: number;
  rows: number;
  /** row-major heights (m), length cols·rows */
  data: number[];
}

/** Global topography: a tilted ground plane. slope = rise/run, azimuth =
 * uphill bearing in degrees. h(x,z) = slope·(x·sin az + z·cos az). */
export interface Ground {
  slope: number;
  azimuth: number;
  /** present ⇒ real terrain, overrides the plane */
  hf?: Heightfield;
}

export const DEFAULT_GROUND: Ground = { slope: 0, azimuth: 0 };
export const GROUND_SLOPE_MAX = 0.3;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Bilinear sample of a heightfield at world (x, z); clamps to the edge
 * outside the grid. */
export function sampleHF(hf: Heightfield, x: number, z: number): number {
  const { originX, originZ, spacing, cols, rows, data } = hf;
  const clampTo = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  const cx = clampTo((x - originX) / spacing, cols - 1);
  const cz = clampTo((z - originZ) / spacing, rows - 1);
  const x0 = Math.floor(cx);
  const z0 = Math.floor(cz);
  const x1 = Math.min(x0 + 1, cols - 1);
  const z1 = Math.min(z0 + 1, rows - 1);
  const tx = cx - x0;
  const tz = cz - z0;
  const at = (ix: number, iz: number) => data[iz * cols + ix];
  const top = at(x0, z0) * (1 - tx) + at(x1, z0) * tx;
  const bot = at(x0, z1) * (1 - tx) + at(x1, z1) * tx;
  return top * (1 - tz) + bot * tz;
}

/** Ground height at plan (x, z). */
export function groundHeightAt(x: number, z: number, g: Ground): number {
  if (g.hf) return sampleHF(g.hf, x, z);
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

/** Upward unit normal at world (x, z): central differences on the heightfield,
 * else the analytic plane normal. */
export function groundNormalAt(
  x: number,
  z: number,
  g: Ground,
): [number, number, number] {
  if (!g.hf) return groundNormal(g);
  const e = g.hf.spacing;
  const hx = (sampleHF(g.hf, x + e, z) - sampleHF(g.hf, x - e, z)) / (2 * e);
  const hz = (sampleHF(g.hf, x, z + e) - sampleHF(g.hf, x, z - e)) / (2 * e);
  const nx = -hx;
  const nz = -hz;
  const len = Math.hypot(nx, 1, nz);
  // Convert -0 to +0 for cleaner output
  const nx_norm = nx / len;
  const ny_norm = 1 / len;
  const nz_norm = nz / len;
  return [
    Object.is(nx_norm, -0) ? 0 : nx_norm,
    ny_norm,
    Object.is(nz_norm, -0) ? 0 : nz_norm,
  ];
}
