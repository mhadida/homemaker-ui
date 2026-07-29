"use client";
import type { Monument } from "@/lib/street/types";
import StoneArch from "@/components/facade/StoneArch";

const STONE = "#8d867a";
const WATER = "#5f7d86";
const BRONZE = "#596b5a";

export default function MonumentMesh({
  centre,
  kind,
  baseY = 0,
}: {
  centre: [number, number];
  kind: Monument["kind"];
  /** Ground height at the centre — the group's y, so the monument stands
   * plumb (vertical) at the correct elevation even on tilted ground. */
  baseY?: number;
}) {
  const [x, z] = centre;
  if (kind === "obelisk") {
    return (
      <group position={[x, baseY, z]}>
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
  if (kind === "statue") {
    return (
      <group position={[x, baseY, z]}>
        <mesh position={[0, 0.35, 0]} castShadow>
          <boxGeometry args={[1.8, 0.7, 1.8]} />
          <meshStandardMaterial color={STONE} roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.25, 0]} castShadow>
          <boxGeometry args={[1.15, 1.1, 1.15]} />
          <meshStandardMaterial color={STONE} roughness={0.88} />
        </mesh>
        <group position={[0, 2.1, 0]}>
          <mesh position={[0, 1.15, 0]} castShadow>
            <capsuleGeometry args={[0.42, 1.15, 8, 12]} />
            <meshStandardMaterial color={BRONZE} roughness={0.62} metalness={0.35} />
          </mesh>
          <mesh position={[0, 2.15, 0]} castShadow>
            <sphereGeometry args={[0.34, 16, 12]} />
            <meshStandardMaterial color={BRONZE} roughness={0.6} metalness={0.38} />
          </mesh>
          {[-1, 1].map((side) => (
            <group key={side}>
              <mesh
                position={[side * 0.27, 0.15, 0]}
                rotation={[0, 0, side * 0.08]}
                castShadow
              >
                <capsuleGeometry args={[0.15, 1.35, 6, 10]} />
                <meshStandardMaterial color={BRONZE} roughness={0.62} metalness={0.35} />
              </mesh>
              <mesh
                position={[side * 0.62, 1.25, 0]}
                rotation={[0, 0, side * 0.72]}
                castShadow
              >
                <capsuleGeometry args={[0.13, 1, 6, 10]} />
                <meshStandardMaterial color={BRONZE} roughness={0.62} metalness={0.35} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
    );
  }
  if (kind === "triumphal-arch") {
    return (
      <group position={[x, baseY, z]}>
        <StoneArch width={5.8} depth={1.8} />
      </group>
    );
  }
  return (
    <group position={[x, baseY, z]}>
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
