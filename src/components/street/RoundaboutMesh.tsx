"use client";
import { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { Monument } from "@/lib/street/types";
import { roundaboutRing } from "@/lib/street/geometry";
import { groundHeightAt, groundNormal, type Ground } from "@/lib/facade/terrain";
import MonumentMesh from "./MonumentMesh";

export default function RoundaboutMesh({
  centre,
  outerR,
  islandR,
  monument,
  ground,
}: {
  centre: [number, number];
  outerR: number;
  islandR: number;
  monument: Monument;
  /** Tilted ground plane — the disc tilts to it; the monument stays plumb. */
  ground: Ground;
}) {
  const geo = useMemo(() => {
    // Built at the local origin (not `centre`) so it can be positioned by the
    // tilted group below without double-counting the world offset.
    const { outer, island } = roundaboutRing([0, 0], outerR, islandR);
    const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], p[1])));
    shape.holes.push(new THREE.Path(island.map((p) => new THREE.Vector2(p[0], p[1]))));
    const g = new THREE.ShapeGeometry(shape);
    // ShapeGeometry builds in the XY plane; rotateX(π/2) maps +Y→+Z to lay it
    // flat on XZ. Winding/up-facing normal is a visual check — Task 8.
    g.rotateX(Math.PI / 2); // shape is XY → lay flat on XZ
    g.translate(0, 0.021, 0);
    return g;
  }, [outerR, islandR]);
  useEffect(() => () => geo.dispose(), [geo]);
  const [cx, cz] = centre;
  const baseY = groundHeightAt(cx, cz, ground);
  const q = useMemo(() => {
    const n = groundNormal(ground);
    return new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(n[0], n[1], n[2]),
    );
  }, [ground]);
  return (
    <group>
      <group position={[cx, baseY, cz]} quaternion={q}>
        <mesh geometry={geo} receiveShadow>
          <meshStandardMaterial color="#3f3f44" roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <MonumentMesh centre={centre} kind={monument.kind} baseY={baseY} />
    </group>
  );
}
