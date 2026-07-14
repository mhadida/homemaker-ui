import type { FacadeBlock } from "./blocks";
import { blockFrame } from "./blocks";

/** Street width bounds (metres). Half-width = frontage → centreline. */
export const STREET_WIDTH_MIN = 6;
export const STREET_WIDTH_MAX = 40;
export const STREET_WIDTH_DEFAULT = 14;

/** New blocks auto-orient when their midpoint is within
 * `width * CORRIDOR_FACTOR` of the centreline. 1 → ±1 street-width, which
 * comfortably covers the near frontage (−halfWidth) and far frontage
 * (+halfWidth) with margin. */
export const CORRIDOR_FACTOR = 1;

/** How far the construction guide lines extend past the reference block
 * ends, metres — enough to sight along without cluttering. */
const GUIDE_PAD = 8;

type Vec2 = [number, number];

/** The reference frontage that defines the street: the first block's
 * effective (flip-resolved) line and facade normal. The normal points from
 * the frontage toward the street (centreline side). */
export interface StreetRef {
  a: Vec2;
  b: Vec2;
  /** unit facade normal (blockFrame normal of the reference block) */
  normal: Vec2;
}

export interface StreetLines {
  /** street spine, offset halfWidth from the frontage */
  centre: { a: Vec2; b: Vec2 };
  /** far frontage (parallel street's near edge), offset fullWidth */
  mirror: { a: Vec2; b: Vec2 };
}

/** Build a StreetRef from the reference block. */
export function streetRefOf(block: FacadeBlock): StreetRef {
  const f = blockFrame(block);
  return {
    a: [f.origin[0], f.origin[1]],
    b: [f.origin[0] + f.dir[0] * f.length, f.origin[1] + f.dir[1] * f.length],
    normal: [f.normal[0], f.normal[1]],
  };
}

/** Centreline + mirror line derived from the reference, each extended by
 * `pad` past the reference ends for sighting. */
export function streetLines(
  ref: StreetRef,
  width: number,
  pad = GUIDE_PAD,
): StreetLines {
  const [nx, nz] = ref.normal;
  const dx = ref.b[0] - ref.a[0];
  const dz = ref.b[1] - ref.a[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const off = (o: number, at: Vec2, dir: number): Vec2 => [
    at[0] + nx * o + ux * dir * pad,
    at[1] + nz * o + uz * dir * pad,
  ];
  const half = width / 2;
  return {
    centre: { a: off(half, ref.a, -1), b: off(half, ref.b, +1) },
    mirror: { a: off(width, ref.a, -1), b: off(width, ref.b, +1) },
  };
}

/** Unit facade normal a segment gets when built with `flipped: false`
 * (matches blockFrame: normal = [-dir.z, dir.x]). */
function segNormal(a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
}

/**
 * The street-aware `flipped` for a new segment a→b, BEFORE the user's
 * f-toggle. Picks the orientation whose facade normal points toward the
 * centreline, when the segment midpoint sits inside the street corridor.
 * Returns false (drawn orientation) with no reference, outside the corridor,
 * or when the choice is ambiguous (segment on the centreline / normal
 * perpendicular to the street normal).
 */
export function streetAwareFlipped(
  ref: StreetRef | null,
  width: number,
  a: Vec2,
  b: Vec2,
): boolean {
  if (!ref) return false;
  const [nx, nz] = ref.normal;
  const half = width / 2;
  // A point on the centreline (frontage offset by half-width along normal).
  const cx = ref.a[0] + nx * half;
  const cz = ref.a[1] + nz * half;
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;
  // Signed perpendicular distance from the midpoint to the centreline.
  const d = (mx - cx) * nx + (mz - cz) * nz;
  if (Math.abs(d) > width * CORRIDOR_FACTOR) return false;
  // flipped=false normal · refNormal, tilted by which side of the spine we
  // are on: face +normal on the near side (d<0), −normal on the far (d>0).
  const seg = segNormal(a, b);
  const facing = Math.sign(d) * (seg[0] * nx + seg[1] * nz);
  return facing > 0;
}

/** The facing used by BOTH the pen preview and commit: street-aware auto,
 * with the user's f-toggle XORed on top. */
export function resolveFacing(
  ref: StreetRef | null,
  width: number,
  a: Vec2,
  b: Vec2,
  fFlip: boolean,
): boolean {
  return streetAwareFlipped(ref, width, a, b) !== fFlip;
}
