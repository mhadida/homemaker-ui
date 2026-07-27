"use client";
import { useMemo } from "react";
import * as THREE from "three";
import { turretWindows, TURRET_RADIUS_DEFAULT } from "@/lib/facade/turret";
import { windowBarColor } from "@/lib/facade/windowBar";

export const TURRET_RADIUS = TURRET_RADIUS_DEFAULT;
const CONE_HEIGHT = 3.2;
const CONE_OVERHANG = 0.25;
/** How far the shaft rises past the eave before the cone. */
const SHAFT_RISE = 0.7;
/** Height of the corbel taper under a corbelled shaft. */
const CORBEL_DROP = 1.1;
const GLASS = "#2b3138"; // dark recessed pane

/** Flat rounded-top (semicircular head) window outline, centred on the origin,
 * spanning [-w/2, w/2] wide, ~h tall, as a ShapeGeometry in the XY plane. */
function archedShape(w: number, h: number): THREE.ShapeGeometry {
  const hw = w / 2;
  const straight = Math.max(0.05, h - hw); // rectangular part below the arch
  const bottom = -h / 2;
  const shoulder = bottom + straight;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, bottom);
  shape.lineTo(-hw, shoulder);
  shape.absarc(0, shoulder, hw, Math.PI, 0, true); // semicircular head
  shape.lineTo(hw, bottom);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/** One arched window as a flat silhouette on the shaft surface, facing radially
 * outward at `angle`. A dark pane sits just proud of the shaft with a thin
 * light surround behind it. */
function TurretWindow({
  angle,
  cy,
  width,
  height,
  radius,
  surround,
}: {
  angle: number;
  cy: number;
  width: number;
  height: number;
  radius: number;
  surround: string;
}) {
  const paneGeo = useMemo(() => archedShape(width, height), [width, height]);
  const surroundGeo = useMemo(
    () => archedShape(width + 0.18, height + 0.14),
    [width, height],
  );
  // Radial outward direction over plan (x,z) is [cos angle, sin angle]. The
  // flat shape's +z is its outward normal; atan2(cos, sin) is the Y-rotation
  // that aims local +z along that radial direction.
  const rotY = Math.atan2(Math.cos(angle), Math.sin(angle));
  const px = Math.cos(angle) * radius;
  const pz = Math.sin(angle) * radius;
  return (
    <group position={[px, cy, pz]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0, 0.01]} geometry={surroundGeo}>
        <meshStandardMaterial color={surround} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0.05]} geometry={paneGeo}>
        <meshStandardMaterial
          color={GLASS}
          roughness={0.25}
          metalness={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/** A corner turret straddling the corner node of a unified corner building:
 * a round shaft with arched windows on the street-facing arc, capped with a
 * conical roof. `baseY` is the shaft's bottom — 0 for a to-ground turret; the
 * first-floor line for a corbelled one, which additionally grows a tapering
 * corbel underneath. Local y = the corner datum; the shaft is centred on the
 * node in plan. */
export default function TurretMesh({
  x,
  z,
  datum,
  baseY,
  wallTop,
  radius = TURRET_RADIUS,
  corbelled,
  storeyLevels,
  outwardAngle,
  wallColor,
  trimColor,
  roofColor,
}: {
  x: number;
  z: number;
  datum: number;
  baseY: number;
  wallTop: number;
  radius?: number;
  corbelled: boolean;
  storeyLevels: number[];
  outwardAngle: number;
  wallColor: string;
  trimColor: string;
  roofColor: string;
}) {
  const topY = wallTop + SHAFT_RISE;
  const shaftH = topY - baseY;
  const surround = windowBarColor(wallColor); // white/black per the shaft colour
  const windows = useMemo(
    () => turretWindows({ radius, baseY, wallTop, storeyLevels, outwardAngle }),
    [radius, baseY, wallTop, storeyLevels, outwardAngle],
  );
  if (shaftH <= 0) return null;
  const coneR = radius + CONE_OVERHANG;
  const trimR = radius + CONE_OVERHANG * 0.6;
  return (
    <group position={[x, datum, z]}>
      <mesh position={[0, baseY + shaftH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, shaftH, 24]} />
        <meshStandardMaterial color={wallColor} roughness={0.85} />
      </mesh>
      {windows.map((w, i) => (
        <TurretWindow key={i} {...w} radius={radius + 0.02} surround={surround} />
      ))}
      {corbelled && (
        <mesh position={[0, baseY - CORBEL_DROP / 2, 0]} castShadow>
          <cylinderGeometry args={[radius, radius * 0.35, CORBEL_DROP, 24]} />
          <meshStandardMaterial color={wallColor} roughness={0.85} />
        </mesh>
      )}
      {/* trim ring under the cone eave */}
      <mesh position={[0, topY - 0.12, 0]} castShadow>
        <cylinderGeometry args={[trimR, trimR, 0.24, 24]} />
        <meshStandardMaterial color={trimColor} roughness={0.85} />
      </mesh>
      <mesh position={[0, topY + CONE_HEIGHT / 2, 0]} castShadow>
        <coneGeometry args={[coneR, CONE_HEIGHT, 24]} />
        <meshStandardMaterial color={roofColor} roughness={0.8} />
      </mesh>
    </group>
  );
}
