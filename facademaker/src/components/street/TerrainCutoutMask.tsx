"use client";

import * as THREE from "three";

/**
 * Marks a paved surface in the stencil buffer before the displaced terrain
 * renders. The terrain material rejects these pixels, so a cross-slope cannot
 * poke through a flat road, junction pad, roundabout, or canal.
 */
export default function TerrainCutoutMask({
  geometry,
  enabled,
}: {
  geometry: THREE.BufferGeometry;
  enabled: boolean;
}) {
  if (!enabled) return null;
  return (
    <mesh geometry={geometry} renderOrder={-20} raycast={() => {}}>
      <meshBasicMaterial
        colorWrite={false}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
        stencilWrite
        stencilRef={1}
        stencilFunc={THREE.AlwaysStencilFunc}
        stencilFail={THREE.ReplaceStencilOp}
        stencilZFail={THREE.ReplaceStencilOp}
        stencilZPass={THREE.ReplaceStencilOp}
      />
    </mesh>
  );
}
