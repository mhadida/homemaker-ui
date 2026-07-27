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

export const DORMER_WIDTH = 0.9; // preferred window width
export const DORMER_MAX = 9; // hard cap on dormer count
const DORMER_EAVE_OVER = 0.1; // little-roof overhang beyond the cheeks

/** A dormer window on the front (street) roof slope, facade-local, fully
 * resolved so the mesh is a straight transcription. The little gable roof and
 * cheeks die INTO the main slope at the back (their back edges lie on the
 * slope: `mainSlopeY(zEaveBack) === headY`, `mainSlopeY(zRidgeBack) === peakY`),
 * so the junction is watertight with no gap or poke-through. */
export interface Dormer {
  /** center x */
  x: number;
  /** window width */
  w: number;
  /** z of the vertical window/gable face (the roof's front eave line) */
  faceZ: number;
  /** main-roof eave height at the face (slope base the cheeks sit on) */
  eaveY: number;
  /** window sill / head heights */
  sillY: number;
  headY: number;
  /** dormer ridge apex height */
  peakY: number;
  /** z where the cheeks (eave height) meet the main slope */
  zEaveBack: number;
  /** z where the ridge (peak height) meets the main slope */
  zRidgeBack: number;
  /** overhang of the little roof beyond the cheeks */
  over: number;
}

/** Pure: dormer placements on a parallel pitched roof's front slope. Empty for
 * flat/perpendicular roofs or a too-shallow rise. `count` is clamped to
 * [0, DORMER_MAX] and to whatever fits without overlap; dormers space evenly
 * across the width (bay-center aligned when count === bays). */
export function roofDormers(plan: RoofPlan | null, count: number): Dormer[] {
  if (!plan || plan.axis !== "x") return [];
  const n = Math.min(DORMER_MAX, Math.max(0, Math.floor(count)));
  if (n === 0) return [];
  const rise = plan.ridgeY - plan.eaveY;
  if (rise < 1.6) return []; // need room for a dormer under the main ridge
  const zMid = (plan.zFront + plan.zBack) / 2;
  const run = plan.zFront - zMid; // > 0
  const m = rise / run; // front-slope gradient (y per −z)
  // z where the main slope reaches height Y: mainSlopeY(z) = eaveY + (zFront−z)·m
  const zAtHeight = (Y: number) => plan.zFront - (Y - plan.eaveY) / m;

  const span = plan.x1 - plan.x0;
  // Shrink the width so `n` dormers never overlap or spill off the roof edge.
  const w = Math.min(DORMER_WIDTH, (span / n) * 0.7);
  if (w < 0.4) return []; // too cramped to host real dormers
  const h = Math.min(1.0, rise * 0.5);
  const sillY = plan.eaveY + 0.35;
  const headY = sillY + h;
  const peakY = headY + 0.3;
  const out: Dormer[] = [];
  for (let i = 0; i < n; i++) {
    const x = plan.x0 + (span * (i + 0.5)) / n;
    out.push({
      x,
      w,
      faceZ: plan.zFront,
      eaveY: plan.eaveY,
      sillY,
      headY,
      peakY,
      zEaveBack: zAtHeight(headY),
      zRidgeBack: zAtHeight(peakY),
      over: DORMER_EAVE_OVER,
    });
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
