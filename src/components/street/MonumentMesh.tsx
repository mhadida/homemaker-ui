"use client";
import type { Monument } from "@/lib/street/types";

const STONE = "#8d867a";
const WATER = "#5f7d86";

export default function MonumentMesh({
  centre,
  kind,
}: {
  centre: [number, number];
  kind: Monument["kind"];
}) {
  const [x, z] = centre;
  if (kind === "obelisk") {
    return (
      <group position={[x, 0, z]}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[1.4, 0.6, 1.4]} />
          <meshStandardMaterial color={STONE} roughness={0.9} />
        </mesh>
        <mesh position={[0, 3.4, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.6, 5.6, 4]} />
          <meshStandardMaterial color={STONE} roughness={0.85} />
        </mesh>
        <mesh position={[0, 6.5, 0]} castShadow>
          <coneGeometry args={[0.28, 0.8, 4]} />
          <meshStandardMaterial color={STONE} roughness={0.85} />
        </mesh>
      </group>
    );
  }
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.2, 2.4, 0.5, 24]} />
        <meshStandardMaterial color={STONE} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[1.9, 1.9, 0.16, 24]} />
        <meshStandardMaterial color={WATER} roughness={0.25} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.24, 1.4, 12]} />
        <meshStandardMaterial color={STONE} roughness={0.85} />
      </mesh>
    </group>
  );
}
