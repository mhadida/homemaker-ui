/** Outward normal of the (single, v1) facade plane. Sub-project C replaces
 * per-block; every elevation camera derives from a normal, never a world
 * axis — elevations are ALWAYS perpendicular to the facade plane. */
export const FACADE_NORMAL: [number, number, number] = [0, 0, 1];

/** Orthographic zoom (pixels per world unit) that fits a worldW×worldH
 * rectangle into a viewW×viewH viewport. margin > 1 leaves breathing room
 * (1.15 = 15%). Degenerate inputs return 1 (visible, never NaN/Infinity). */
export function fitOrthoZoom(
  viewW: number,
  viewH: number,
  worldW: number,
  worldH: number,
  margin = 1.15,
): number {
  if (viewW <= 0 || viewH <= 0 || worldW <= 0 || worldH <= 0) return 1;
  return Math.min(viewW / (worldW * margin), viewH / (worldH * margin));
}

/** Camera position `distance` along the (normalized) facade normal from
 * `target`. Zero-length normals fall back to +z. */
export function elevationCameraPosition(
  target: [number, number, number],
  normal: [number, number, number],
  distance: number,
): [number, number, number] {
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  const n: [number, number, number] =
    len > 0 ? [normal[0] / len, normal[1] / len, normal[2] / len] : [0, 0, 1];
  return [
    target[0] + n[0] * distance,
    target[1] + n[1] * distance,
    target[2] + n[2] * distance,
  ];
}
