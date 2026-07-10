"use client";

import { useMemo } from "react";
import { Environment, ContactShadows, Grid } from "@react-three/drei";
import * as THREE from "three";
import FacadeMesh from "./FacadeMesh";
import type { FacadeParams, LotContext } from "@/lib/facade/types";
import type { ViewSettings } from "@/lib/building/types";

/** Copied from BuildingViewer — sun azimuth/altitude → directional light pos. */
function sunPositionFromAngles(
  azimuthDeg: number,
  altitudeDeg: number,
): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  const r = 30;
  const x = r * Math.cos(alt) * Math.sin(az);
  const y = r * Math.sin(alt);
  const z = r * Math.cos(alt) * Math.cos(az);
  return [x, y, z];
}

/** Copied from BuildingViewer — radially fading ground plane. */
function useGroundGeometry() {
  return useMemo(() => {
    const geo = new THREE.PlaneGeometry(200, 200, 96, 96);
    const base = new THREE.Color("#a59e95");
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 4);
    const SOLID_HALF = 15;
    const FADE_END = 70;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const d = Math.max(Math.abs(x), Math.abs(y));
      let alpha: number;
      if (d <= SOLID_HALF) {
        alpha = 1;
      } else if (d >= FADE_END) {
        alpha = 0;
      } else {
        const t = (d - SOLID_HALF) / (FADE_END - SOLID_HALF);
        alpha = 1 - t * t * (3 - 2 * t);
      }
      colors[i * 4] = base.r;
      colors[i * 4 + 1] = base.g;
      colors[i * 4 + 2] = base.b;
      colors[i * 4 + 3] = alpha;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    return geo;
  }, []);
}

/** Grey party-wall neighbor volumes flanking the lot. */
function NeighborMasses({
  context,
  facadeWidth,
}: {
  context: LotContext;
  facadeWidth: number;
}) {
  if (!context.show) return null;
  const W = 8; // neighbor visible width
  const D = 9; // neighbor depth behind the street line
  return (
    <>
      <mesh
        position={[-facadeWidth / 2 - W / 2, context.leftNeighborHeight / 2, -D / 2 + 0.2]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[W, context.leftNeighborHeight, D]} />
        <meshStandardMaterial color="#6f6b64" roughness={0.95} />
      </mesh>
      <mesh
        position={[facadeWidth / 2 + W / 2, context.rightNeighborHeight / 2, -D / 2 + 0.2]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[W, context.rightNeighborHeight, D]} />
        <meshStandardMaterial color="#67635c" roughness={0.95} />
      </mesh>
    </>
  );
}

export default function SceneContents({
  params,
  context,
  view,
}: {
  params: FacadeParams;
  context: LotContext;
  view: ViewSettings;
}) {
  const groundGeo = useGroundGeometry();
  const sunPos = useMemo(
    () => sunPositionFromAngles(view.sunAzimuth, view.sunAltitude),
    [view.sunAzimuth, view.sunAltitude],
  );
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight
        position={sunPos}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={80}
        shadow-camera-near={0.1}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-bias={-0.0005}
      />
      <directionalLight position={[-8, 10, -6]} intensity={0.25} />
      <pointLight position={[0, 30, 0]} intensity={0.3} />

      <Environment
        files="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/furstenstein_1k.hdr"
        background={false}
      />

      <FacadeMesh params={params} />
      <NeighborMasses context={context} facadeWidth={params.width} />

      {/* Ground plane — polygonOffset pushes it back so the sidewalk, road
       * strip, and grid lines all win the depth test (same trick as the
       * main viewer). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow geometry={groundGeo}>
        <meshStandardMaterial
          vertexColors
          transparent
          roughness={0.95}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      {/* Sidewalk strip in front of the facade (z 0 → 2.5) */}
      <mesh position={[0, 0, 1.25]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 2.5]} />
        <meshStandardMaterial color="#8f8a80" roughness={0.9} />
      </mesh>
      {/* Road beyond the sidewalk (z 2.5 → 9) */}
      <mesh position={[0, 0, 5.75]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 6.5]} />
        <meshStandardMaterial color="#57544f" roughness={0.95} />
      </mesh>

      <Grid
        position={[0, 0, 0]}
        args={[60, 60]}
        cellSize={1}
        cellThickness={0.7}
        cellColor="#1f1d1b"
        sectionSize={5}
        sectionThickness={1.4}
        sectionColor="#0d0c0b"
        fadeDistance={70}
        fadeStrength={1.2}
        infiniteGrid
      />

      <ContactShadows
        position={[0, 0.005, 0]}
        opacity={0.45}
        scale={50}
        blur={2.5}
        far={20}
        resolution={1024}
      />
    </>
  );
}
