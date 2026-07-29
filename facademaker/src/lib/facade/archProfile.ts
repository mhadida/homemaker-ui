import * as THREE from "three";

/** Stable 2D masonry profile shared by gate-frontage lots and standalone
 * triumphal-arch monuments. */
export function archProfile(width: number): {
  shape: THREE.Shape;
  height: number;
  apex: number;
} {
  const pier = Math.min(2.2, Math.max(0.9, width * 0.16));
  const openingHalf = Math.max(0.5, width / 2 - pier);
  const spring = Math.min(4.4, Math.max(3.2, width * 0.38));
  const rise = Math.min(3, Math.max(1.4, openingHalf * 0.55));
  const apex = spring + rise;
  const height = apex + 1.1;

  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();

  // The 2 cm sill keeps the hole wholly inside the Shape for stable
  // triangulation; it disappears into the terrain in the assembled gate.
  const hole = new THREE.Path();
  hole.moveTo(-openingHalf, 0.02);
  hole.lineTo(-openingHalf, spring);
  hole.bezierCurveTo(
    -openingHalf * 0.72,
    spring + rise * 0.78,
    -openingHalf * 0.35,
    apex,
    0,
    apex,
  );
  hole.bezierCurveTo(
    openingHalf * 0.35,
    apex,
    openingHalf * 0.72,
    spring + rise * 0.78,
    openingHalf,
    spring,
  );
  hole.lineTo(openingHalf, 0.02);
  hole.closePath();
  shape.holes.push(hole);
  return { shape, height, apex };
}
