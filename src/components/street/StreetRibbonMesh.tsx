"use client";
import { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { Street } from "@/lib/street/types";
import { effectiveWidth } from "@/lib/street/types";
import { smoothCentreline, streetRibbon } from "@/lib/street/geometry";

const PAVING: Record<Street["type"], string> = {
  alley: "#6f6a63",
  street: "#4a4a4c",
  road: "#3f3f44",
  boulevard: "#3a3a40",
};

export default function StreetRibbonMesh({ street }: { street: Street }) {
  const geo = useMemo(() => {
    const cl = smoothCentreline(street.points);
    if (cl.length < 2) return null;
    const { left, right } = streetRibbon(cl, effectiveWidth(street));
    const pos: number[] = [];
    const Y = 0.02; // just above the ground plane
    for (let i = 0; i < cl.length - 1; i++) {
      const l0 = left[i], l1 = left[i + 1], r0 = right[i], r1 = right[i + 1];
      pos.push(l0[0], Y, l0[1], r0[0], Y, r0[1], r1[0], Y, r1[1]);
      pos.push(l0[0], Y, l0[1], r1[0], Y, r1[1], l1[0], Y, l1[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }, [street]);
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial
        color={PAVING[street.type]}
        roughness={0.95}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}
