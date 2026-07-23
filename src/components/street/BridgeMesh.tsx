"use client";
import { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { BridgePlacement } from "@/lib/street/canal";
import { bridgeArch, BRIDGE_RISE } from "@/lib/street/canal";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";

const STONE = "#7d766a";

export default function BridgeMesh({
  placement, ground,
}: {
  placement: BridgePlacement;
  ground: Ground;
}) {
  const geo = useMemo(() => {
    const tris = bridgeArch(placement.span, BRIDGE_RISE, placement.deckWidth);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
    g.computeVertexNormals();
    return g;
  }, [placement.span, placement.deckWidth]);
  useEffect(() => () => geo.dispose(), [geo]);

  // Drape the arch so each springing end sits on ITS bank: local +x runs bank-
  // to-bank (tilted to the grade difference across the span), local +z is the
  // deck breadth (along the canal), local +y is up. Flat / longitudinal-slope
  // ground → an untilted arch at grade (byte-identical to a rigid placement).
  const { pos, quat } = useMemo(() => {
    const [x, z] = placement.pos;
    const t = placement.tangent;
    const hs = placement.span / 2;
    const nx = -t[1], nz = t[0];                       // across-channel unit
    const ga = groundHeightAt(x + nx * hs, z + nz * hs, ground); // +x-end bank
    const gb = groundHeightAt(x - nx * hs, z - nz * hs, ground); // −x-end bank
    const baseY = (ga + gb) / 2;                       // arch centre height
    const spanDir = new THREE.Vector3(nx * hs, (ga - gb) / 2, nz * hs).normalize();
    const zAxis = new THREE.Vector3().crossVectors(spanDir, new THREE.Vector3(0, 1, 0)).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, spanDir).normalize();
    const m = new THREE.Matrix4().makeBasis(spanDir, yAxis, zAxis);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    return {
      pos: [x, baseY, z] as [number, number, number],
      quat: [q.x, q.y, q.z, q.w] as [number, number, number, number],
    };
  }, [placement, ground]);

  return (
    <group position={pos} quaternion={quat}>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial color={STONE} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
