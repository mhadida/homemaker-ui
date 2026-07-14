import type { FacadeParams } from "./types";
import { WALL_THICKNESS } from "./layout";

export const ROOF_HEIGHT_MIN = 0.5;
export const ROOF_HEIGHT_MAX = 8;
export const ROOF_HEIGHT_DEFAULT = 3;

export type RoofType = "flat" | "gable" | "hip";
export type RoofOrientation = "parallel" | "perpendicular";

/** A resolved roof over one building's mass. `null` (flat) = no roof mesh. */
export interface RoofPlan {
  type: "gable" | "hip";
  /** ridge axis: "x" = ridge along the facade width (parallel to street),
   * "z" = ridge front-to-back (perpendicular to street). */
  axis: "x" | "z";
  eaveY: number;
  ridgeY: number;
  x0: number;
  x1: number;
  /** z of the front (street) eave and back eave; zFront > zBack. */
  zFront: number;
  zBack: number;
  /** ridge line endpoints in plan [x, z], at y = ridgeY. */
  ridge: { a: [number, number]; b: [number, number] };
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** Pure: resolve the roof geometry plan. All clamps live here (height range,
 * non-finite sanitize). flat → null. The mesh turns the plan into triangles
 * via roofTriangles(). */
export function resolveRoof(
  params: FacadeParams,
  wallTop: number,
  massingDepth: number,
): RoofPlan | null {
  const type = params.roofType ?? "flat";
  if (type === "flat") return null;
  const orientation = params.roofOrientation ?? "parallel";
  const raw = params.roofHeight;
  const height =
    raw === undefined || !Number.isFinite(raw)
      ? ROOF_HEIGHT_DEFAULT
      : clamp(raw, ROOF_HEIGHT_MIN, ROOF_HEIGHT_MAX);

  const W = params.width;
  const x0 = -W / 2;
  const x1 = W / 2;
  const zFront = -WALL_THICKNESS;
  const zBack = -massingDepth;
  const depth = zFront - zBack; // > 0 (massingDepth clamped >= 3)
  const eaveY = wallTop;
  const ridgeY = wallTop + height;

  let axis: "x" | "z";
  let ridge: { a: [number, number]; b: [number, number] };
  if (orientation === "parallel") {
    axis = "x";
    const zMid = (zFront + zBack) / 2;
    if (type === "gable") {
      ridge = { a: [x0, zMid], b: [x1, zMid] };
    } else {
      // hip: inset each end along x by half the cross-span (depth), capped
      // at half the length (W) → pyramid when depth >= W.
      const inset = Math.min(depth / 2, W / 2);
      ridge = { a: [x0 + inset, zMid], b: [x1 - inset, zMid] };
    }
  } else {
    axis = "z";
    const xMid = 0;
    if (type === "gable") {
      ridge = { a: [xMid, zFront], b: [xMid, zBack] };
    } else {
      const inset = Math.min(W / 2, depth / 2);
      ridge = { a: [xMid, zFront - inset], b: [xMid, zBack + inset] };
    }
  }

  return { type, axis, eaveY, ridgeY, x0, x1, zFront, zBack, ridge };
}

export const DORMER_WIDTH = 0.9; // window width
export const DORMER_MAX = 9; // hard cap on dormer count

/** A dormer window on the front (street) roof slope, facade-local. The mesh
 * builds a small gabled house-let whose lower part buries in the opaque roof;
 * the window face sits proud of the eave at `faceZ`. */
export interface Dormer {
  /** center x */
  x: number;
  /** window sill height */
  sillY: number;
  /** window head height */
  headY: number;
  /** z of the vertical window face (proud of the eave toward the street) */
  faceZ: number;
  /** window width */
  w: number;
}

/** Pure: dormer placements on a parallel pitched roof's front slope. Empty for
 * flat/perpendicular roofs or a too-shallow rise. `count` is clamped to
 * [0, DORMER_MAX]; dormers space evenly across the width (bay-center aligned
 * when count === bays). */
export function roofDormers(plan: RoofPlan | null, count: number): Dormer[] {
  if (!plan || plan.axis !== "x") return [];
  const n = Math.min(DORMER_MAX, Math.max(0, Math.floor(count)));
  if (n === 0) return [];
  const rise = plan.ridgeY - plan.eaveY;
  const h = Math.min(1.05, rise * 0.5);
  if (h < 0.5) return []; // too shallow to host a real dormer
  const sillY = plan.eaveY + 0.3; // sit above the eave line
  const faceZ = plan.zFront + 0.15; // proud of the eave toward the street
  const span = plan.x1 - plan.x0;
  const out: Dormer[] = [];
  for (let i = 0; i < n; i++) {
    const x = plan.x0 + (span * (i + 0.5)) / n;
    out.push({ x, sillY, headY: sillY + h, faceZ, w: DORMER_WIDTH });
  }
  return out;
}

export type Vec3 = [number, number, number];

/** Pure: the roof's triangle soup (flat list, every 3 = one triangle),
 * facade-local coords. Winding is not guaranteed outward — the mesh
 * auto-orients each face by its normal (see FacadeMesh). One generic
 * "rectangle-to-ridge tent" per axis handles both gable (ridge to the
 * edge → vertical gable end) and hip (ridge inset → slanted end). */
export function roofTriangles(plan: RoofPlan): Vec3[] {
  const { eaveY, ridgeY, x0, x1, zFront, zBack, ridge, axis } = plan;
  const FL: Vec3 = [x0, eaveY, zFront];
  const FR: Vec3 = [x1, eaveY, zFront];
  const BL: Vec3 = [x0, eaveY, zBack];
  const BR: Vec3 = [x1, eaveY, zBack];
  const RA: Vec3 = [ridge.a[0], ridgeY, ridge.a[1]];
  const RB: Vec3 = [ridge.b[0], ridgeY, ridge.b[1]];
  const out: Vec3[] = [];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) =>
    out.push(a, b, c, a, c, d);
  const tri = (a: Vec3, b: Vec3, c: Vec3) => out.push(a, b, c);
  if (axis === "x") {
    quad(FL, FR, RB, RA); // front slope
    quad(BR, BL, RA, RB); // back slope
    tri(FL, BL, RA); // left end (gable end or hip slope)
    tri(FR, BR, RB); // right end
  } else {
    quad(FL, BL, RB, RA); // left slope
    quad(BR, FR, RA, RB); // right slope
    tri(FL, FR, RA); // front end
    tri(BL, BR, RB); // back end
  }
  return out;
}
