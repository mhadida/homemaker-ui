"use client";

import { useMemo } from "react";
import { archProfile } from "@/lib/facade/archProfile";

const STONE = "#a59b8b";
const SELECTED_STONE = "#c48765";

/** Reusable masonry arch shell for a gate-frontage lot and the freestanding
 * triumphal-arch monument. Local X spans the opening, Y is up, and local Z is
 * its masonry depth. */
export default function StoneArch({
  width,
  depth,
  selected = false,
}: {
  width: number;
  depth: number;
  selected?: boolean;
}) {
  const { shape, height, apex } = useMemo(() => archProfile(width), [width]);
  const color = selected ? SELECTED_STONE : STONE;
  return (
    <group>
      <mesh position={[0, 0, -depth / 2]} castShadow receiveShadow>
        <extrudeGeometry
          args={[
            shape,
            {
              depth,
              bevelEnabled: false,
              curveSegments: 18,
            },
          ]}
        />
        <meshStandardMaterial
          color={color}
          roughness={0.88}
          emissive={selected ? "#402015" : "#000000"}
          emissiveIntensity={selected ? 0.2 : 0}
        />
      </mesh>
      <mesh position={[0, height + 0.12, 0]} castShadow>
        <boxGeometry args={[width + 0.35, 0.24, depth + 0.18]} />
        <meshStandardMaterial color={color} roughness={0.84} />
      </mesh>
      <mesh
        position={[0, apex - 0.18, depth / 2 + 0.04]}
        rotation={[0, 0, Math.PI / 18]}
        castShadow
      >
        <boxGeometry args={[0.56, 0.9, 0.18]} />
        <meshStandardMaterial color="#c1b5a2" roughness={0.8} />
      </mesh>
    </group>
  );
}
