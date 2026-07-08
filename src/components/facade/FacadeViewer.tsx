"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, Grid } from "@react-three/drei";
import * as THREE from "three";
import FacadeMesh from "./FacadeMesh";
import type { FacadeParams, LotContext } from "@/lib/facade/types";
import { FACADE_DEFAULT_VIEW } from "@/lib/facade/types";
import type { ViewSettings } from "@/lib/building/types";

interface FacadeViewerProps {
  params: FacadeParams;
  context: LotContext;
  view?: ViewSettings;
}

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

/** Exposes a capture function that renders a fresh frame then downloads a
 * PNG. Rendering immediately before toDataURL avoids needing
 * preserveDrawingBuffer (which costs performance every frame). */
function CaptureBridge({ bind }: { bind: (fn: () => void) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    bind(() => {
      gl.render(scene, camera);
      const url = gl.domElement.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "facade.png";
      a.click();
    });
  }, [gl, scene, camera, bind]);
  return null;
}

function SceneContents({
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

      {/* Orbit constrained to the front hemisphere — nothing exists behind
       * the facade. Azimuth 0 = camera on +z looking at the wall face. */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={[0, 4, 0]}
        minDistance={3}
        maxDistance={60}
        minAzimuthAngle={-Math.PI * 0.44}
        maxAzimuthAngle={Math.PI * 0.44}
        maxPolarAngle={Math.PI / 2.05}
        enablePan
        panSpeed={0.8}
        rotateSpeed={0.5}
        zoomSpeed={1.0}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </>
  );
}

export default function FacadeViewer({
  params,
  context,
  view = FACADE_DEFAULT_VIEW,
}: FacadeViewerProps) {
  const captureRef = useRef<(() => void) | null>(null);
  const bindCapture = useCallback((fn: () => void) => {
    captureRef.current = fn;
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background:
          "linear-gradient(to bottom, #8ea4b8 0%, #a8b0b3 55%, #b8ad9c 100%)",
      }}
    >
      <Canvas
        shadows
        camera={{ position: [6, 5, 14], fov: 40, near: 0.1, far: 200 }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <SceneContents params={params} context={context} view={view} />
        </Suspense>
        <CaptureBridge bind={bindCapture} />
      </Canvas>

      <button
        type="button"
        onClick={() => captureRef.current?.()}
        className="absolute top-3 right-3 rounded-lg bg-black/55 backdrop-blur-md px-3 py-1.5 text-[11px] text-white/85 hover:bg-black/70 transition-colors"
      >
        Save image
      </button>
    </div>
  );
}
