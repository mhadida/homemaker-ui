"use client";

import * as THREE from "three";

/** One merged, terrain-draped overlay built at the FacadeViewer boundary.
 * Thin native line segments keep both WebGL and WebGPU paths inexpensive. */
export default function LotOutlines({
  geometry,
}: {
  geometry: THREE.BufferGeometry | null;
}) {
  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry} dispose={null} renderOrder={6}>
      <lineBasicMaterial
        color="#d2b46f"
        transparent
        opacity={0.88}
        depthWrite={false}
      />
    </lineSegments>
  );
}
