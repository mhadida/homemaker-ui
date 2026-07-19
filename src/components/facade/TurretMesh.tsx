"use client";

export const TURRET_RADIUS = 2.2;
const CONE_HEIGHT = 3.2;
const CONE_OVERHANG = 0.25;
/** How far the shaft rises past the eave before the cone. */
const SHAFT_RISE = 0.7;
/** Height of the corbel taper under a corbelled shaft. */
const CORBEL_DROP = 1.1;

/** A corner turret straddling the corner node of a unified corner building:
 * a round shaft capped with a conical roof. `baseY` is the shaft's bottom —
 * 0 for a to-ground turret; the first-floor line for a corbelled one, which
 * additionally grows a tapering corbel underneath. Local y = the corner
 * datum; the shaft is centred on the node in plan. */
export default function TurretMesh({
  x,
  z,
  datum,
  baseY,
  wallTop,
  corbelled,
  wallColor,
  trimColor,
  roofColor,
}: {
  x: number;
  z: number;
  datum: number;
  baseY: number;
  wallTop: number;
  corbelled: boolean;
  wallColor: string;
  trimColor: string;
  roofColor: string;
}) {
  const topY = wallTop + SHAFT_RISE;
  const shaftH = topY - baseY;
  if (shaftH <= 0) return null;
  return (
    <group position={[x, datum, z]}>
      <mesh position={[0, baseY + shaftH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TURRET_RADIUS, TURRET_RADIUS, shaftH, 24]} />
        <meshStandardMaterial color={wallColor} roughness={0.85} />
      </mesh>
      {corbelled && (
        <mesh position={[0, baseY - CORBEL_DROP / 2, 0]} castShadow>
          <cylinderGeometry
            args={[TURRET_RADIUS, TURRET_RADIUS * 0.35, CORBEL_DROP, 24]}
          />
          <meshStandardMaterial color={wallColor} roughness={0.85} />
        </mesh>
      )}
      {/* trim ring under the cone eave */}
      <mesh position={[0, topY - 0.12, 0]} castShadow>
        <cylinderGeometry
          args={[
            TURRET_RADIUS + CONE_OVERHANG * 0.6,
            TURRET_RADIUS + CONE_OVERHANG * 0.6,
            0.24,
            24,
          ]}
        />
        <meshStandardMaterial color={trimColor} roughness={0.85} />
      </mesh>
      <mesh position={[0, topY + CONE_HEIGHT / 2, 0]} castShadow>
        <coneGeometry args={[TURRET_RADIUS + CONE_OVERHANG, CONE_HEIGHT, 24]} />
        <meshStandardMaterial color={roofColor} roughness={0.8} />
      </mesh>
    </group>
  );
}
