"use client";
import { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { Monument } from "@/lib/street/types";
import { roundaboutRing } from "@/lib/street/geometry";
import MonumentMesh from "./MonumentMesh";

export default function RoundaboutMesh({
  centre,
  outerR,
  islandR,
  monument,
}: {
  centre: [number, number];
  outerR: number;
  islandR: number;
  monument: Monument;
}) {
  const geo = useMemo(() => {
    const { outer, island } = roundaboutRing(centre, outerR, islandR);
    const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], p[1])));
    shape.holes.push(new THREE.Path(island.map((p) => new THREE.Vector2(p[0], p[1]))));
    const g = new THREE.ShapeGeometry(shape);
    // ShapeGeometry builds in the XY plane; rotateX(π/2) maps +Y→+Z to lay it
    // flat on XZ. Winding/up-facing normal is a visual check — Task 8.
    g.rotateX(Math.PI / 2); // shape is XY → lay flat on XZ
    g.translate(0, 0.021, 0);
    return g;
  }, [centre, outerR, islandR]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <group>
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial color="#3f3f44" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <MonumentMesh centre={centre} kind={monument.kind} />
    </group>
  );
}
