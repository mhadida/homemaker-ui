"use client";
import { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { Vec2 } from "@/lib/street/types";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";

/** One junction pad: a star polygon fan-triangulated from `pos`, terrain-draped
 * on the same plane as the ribbons so it never z-fights them. Decoration only —
 * not selectable. */
export default function JunctionPadMesh({
  polygon,
  pos,
  color,
  ground,
}: {
  polygon: Vec2[];
  pos: Vec2;
  color: string;
  ground: Ground;
}) {
  const geo = useMemo(() => {
    if (polygon.length < 3) return null;
    const yAt = (x: number, z: number) => groundHeightAt(x, z, ground) + 0.02;
    const ax = pos[0];
    const ay = yAt(pos[0], pos[1]);
    const az = pos[1];
    const p: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      p.push(ax, ay, az, a[0], yAt(a[0], a[1]), a[1], b[0], yAt(b[0], b[1]), b[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    return g;
  }, [polygon, pos, ground]);
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial
        color={color}
        roughness={0.95}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}
