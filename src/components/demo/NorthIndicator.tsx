"use client";

import { Html } from "@react-three/drei";

/**
 * Small 3D arrow lying flat on the ground, pointing world +Z (north).
 * Stays fixed in world space so as the user orbits, they can see which
 * direction is north relative to the building.
 *
 * Positioned south of the building (negative Z in IFC terms — which the
 * glTF node rotation flips to +Z in world after the −90° X rotation),
 * so it's visible from the typical front-of-house camera angle.
 */
export default function NorthIndicator() {
  return (
    <group position={[0, 0.08, 8]}>
      {/* Arrow body — a cone rotated to lie on its side pointing +Z. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow={false} receiveShadow>
        <coneGeometry args={[0.45, 1.6, 16]} />
        <meshStandardMaterial
          color="#a64b32"
          roughness={0.6}
          metalness={0.0}
          envMapIntensity={0.5}
        />
      </mesh>
      {/* "N" label floating just above the tip */}
      <Html
        position={[0, 0.6, 1.1]}
        center
        distanceFactor={8}
        zIndexRange={[10, 0]}
      >
        <div
          style={{
            color: "#fff",
            fontFamily: "system-ui, sans-serif",
            fontWeight: 700,
            fontSize: "14px",
            textShadow: "0 1px 3px rgba(0,0,0,0.85)",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          N
        </div>
      </Html>
    </group>
  );
}
