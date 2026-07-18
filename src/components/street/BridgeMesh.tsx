"use client";
import { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { BridgePlacement } from "@/lib/street/canal";
import { bridgeArch, BRIDGE_DECK_WIDTH, BRIDGE_RISE } from "@/lib/street/canal";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";

const STONE = "#7d766a";

export default function BridgeMesh({
  placement, ground,
}: {
  placement: BridgePlacement;
  ground: Ground;
}) {
  const geo = useMemo(() => {
    const tris = bridgeArch(placement.span, BRIDGE_RISE, BRIDGE_DECK_WIDTH);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
    g.computeVertexNormals();
    return g;
  }, [placement.span]);
  useEffect(() => () => geo.dispose(), [geo]);
  const [x, z] = placement.pos;
  const baseY = groundHeightAt(x, z, ground);
  // local +x spans the channel (canal normal); local +z is the deck breadth.
  const n: [number, number] = [-placement.tangent[1], placement.tangent[0]];
  const yaw = Math.atan2(-n[1], n[0]);
  return (
    <group position={[x, baseY, z]} rotation={[0, yaw, 0]}>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial color={STONE} roughness={0.9} />
      </mesh>
    </group>
  );
}
