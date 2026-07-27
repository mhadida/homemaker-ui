"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  cornerRoofTriangles,
  type CornerRoofPlan,
} from "@/lib/facade/cornerRoof";

/** One merged corner building's L-roof: the four-plane hip/valley surface
 * from cornerRoofPlan, rendered as a single mesh in WORLD plan coords (the
 * plan carries world x/z; only the datum lifts it). Same auto-orient
 * contract as FacadeMesh's buildRoofGeometry: winding is not guaranteed, so
 * each triangle flips until its normal points away from a reference point
 * under the apex. */
export default function CornerRoofMesh({
  plan,
  datum,
  color,
}: {
  plan: CornerRoofPlan;
  datum: number;
  color: string;
}) {
  const geo = useMemo(() => {
    const tris = cornerRoofTriangles(plan);
    const ref = new THREE.Vector3(plan.P[0], plan.eaveY - 1, plan.P[1]);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const n = new THREE.Vector3();
    const cen = new THREE.Vector3();
    const positions: number[] = [];
    for (let i = 0; i < tris.length; i += 3) {
      a.set(...tris[i]);
      b.set(...tris[i + 1]);
      c.set(...tris[i + 2]);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      n.crossVectors(ab, ac);
      cen
        .copy(a)
        .add(b)
        .add(c)
        .multiplyScalar(1 / 3)
        .sub(ref);
      if (n.dot(cen) < 0) {
        positions.push(...tris[i], ...tris[i + 2], ...tris[i + 1]);
      } else {
        positions.push(...tris[i], ...tris[i + 1], ...tris[i + 2]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    return g;
  }, [plan]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} position={[0, datum, 0]} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}
