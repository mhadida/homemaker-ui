"use client";

import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  ContactShadows,
  Grid,
  GizmoHelper,
  Text,
} from "@react-three/drei";
import * as THREE from "three";
import GLTFBuildingScene, { type BuildStatus } from "./GLTFBuildingScene";
import type { BuildingParams, ViewSettings } from "@/lib/building/types";
import { DEFAULT_VIEW } from "@/lib/building/types";

interface BuildingViewerProps {
  params: BuildingParams;
  view?: ViewSettings;
}

/** Convert sun azimuth/altitude (degrees) to a directional-light position
 * vector. Distance is arbitrary — the light is directional so only direction
 * matters; we pick a large radius so the shadow camera frustum lines up. */
function sunPositionFromAngles(
  azimuthDeg: number,
  altitudeDeg: number,
): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  const r = 30;
  // Convention: az=0 → +Z (north), az=90 → +X (east), so sun position is
  // OPPOSITE to where the light shines from. directionalLight.position is
  // the light's location; it shines toward the origin.
  const x = r * Math.cos(alt) * Math.sin(az);
  const y = r * Math.sin(alt);
  const z = r * Math.cos(alt) * Math.cos(az);
  return [x, y, z];
}

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

/** One horizontal arrow of the NSEW compass: a short shaft + a cone tip
 * with a text label just past the tip. `dir` is a unit vector in world
 * coords along which the arrow points; `color` paints the shaft+cone;
 * `label` is the cardinal letter. */
function CompassArrow({
  dir,
  color,
  label,
}: {
  dir: [number, number, number];
  color: string;
  label: string;
}) {
  // Build a quaternion that rotates +Y (cone's natural axis) to `dir`.
  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir));
    return q;
  }, [dir]);

  const SHAFT_LEN = 0.55;
  const SHAFT_R = 0.045;
  const CONE_LEN = 0.35;
  const CONE_R = 0.13;
  const tip: [number, number, number] = [
    dir[0] * (SHAFT_LEN + CONE_LEN + 0.15),
    dir[1] * (SHAFT_LEN + CONE_LEN + 0.15),
    dir[2] * (SHAFT_LEN + CONE_LEN + 0.15),
  ];

  return (
    <group quaternion={quat}>
      {/* Shaft — unlit material so it stays visible in the GizmoHelper's
       * isolated (light-less) inset scene. PBR would render black there. */}
      <mesh position={[0, SHAFT_LEN / 2, 0]}>
        <cylinderGeometry args={[SHAFT_R, SHAFT_R, SHAFT_LEN, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* Cone tip */}
      <mesh position={[0, SHAFT_LEN + CONE_LEN / 2, 0]}>
        <coneGeometry args={[CONE_R, CONE_LEN, 24]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* Label — placed in world coords, NOT inside the rotated group,
       * so it doesn't tumble with the arrow. We achieve this by
       * counter-rotating: applying the inverse quaternion to a child
       * positioned at `tip` would be simpler outside this group; instead
       * we place it in local up-direction and let billboard handle it. */}
      <Text
        position={[0, SHAFT_LEN + CONE_LEN + 0.25, 0]}
        fontSize={0.32}
        color={color}
        anchorX="center"
        anchorY="middle"
        // billboard keeps the glyph facing the gizmo camera, so it reads
        // correctly regardless of how the parent group is rotated.
        outlineWidth={0.012}
        outlineColor="#000000"
      >
        {label}
      </Text>
      {/* unused but kept for future click-to-snap */}
      <mesh position={tip} visible={false}>
        <sphereGeometry args={[0.01]} />
      </mesh>
    </group>
  );
}

/** 3D isometric NSEW gizmo. Rendered inside drei's <GizmoHelper>, which
 * mounts a HUD with an orthographic camera sized in pixels. Our compass
 * content is authored in unit coords (arrows ~1 unit long), so we wrap
 * everything in `scale={40}` to land in the ~40px range — matching
 * drei's built-in GizmoViewport convention. Without this the arrows
 * render at sub-pixel size and are invisible. */
function NSEWGizmo() {
  return (
    <group scale={40}>
      {/* +Z = North — red (compass needle) */}
      <CompassArrow dir={[0, 0, 1]} color="#e74c4c" label="N" />
      {/* -Z = South — neutral */}
      <CompassArrow dir={[0, 0, -1]} color="#cccccc" label="S" />
      {/* +X = East */}
      <CompassArrow dir={[1, 0, 0]} color="#cccccc" label="E" />
      {/* -X = West */}
      <CompassArrow dir={[-1, 0, 0]} color="#cccccc" label="W" />
      {/* Small disc at the center for visual anchor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.18, 32]} />
        <meshBasicMaterial color="#1a1a1a" toneMapped={false} />
      </mesh>
    </group>
  );
}

function Scene({
  params,
  view,
  onStatusChange,
}: {
  params: BuildingParams;
  view: ViewSettings;
  onStatusChange: (s: BuildStatus) => void;
}) {
  const groundGeo = useGroundGeometry();
  const sunPos = useMemo(
    () => sunPositionFromAngles(view.sunAzimuth, view.sunAltitude),
    [view.sunAzimuth, view.sunAltitude],
  );
  return (
    <>
      {/* Lighting — sun-direction driven by the view sliders. */}
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

      {/* Bundled locally (CC0, Poly Haven) — a runtime CDN fetch here once
       * took the whole viewer down when the network hiccuped. */}
      <Environment files="/hdri/furstenstein_1k.hdr" background={false} />

      <GLTFBuildingScene params={params} onStatusChange={onStatusChange} />

      {/* Ground and grids are all coplanar at y=0. We avoid z-fighting by
       * giving the ground material `polygonOffset` (positive factor/units
       * pushes its depth values back), so the grid lines always win the
       * depth test regardless of camera angle — no Y stacking needed. */}
      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        geometry={groundGeo}
      >
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

      <Grid
        position={[0, 0, 0]}
        args={[60, 60]}
        cellSize={0.25}
        cellThickness={0.35}
        cellColor="#3f3c39"
        sectionSize={1}
        sectionThickness={0.7}
        sectionColor="#1f1d1b"
        fadeDistance={25}
        fadeStrength={1.4}
        infiniteGrid
      />
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

      {/* 3D isometric NSEW compass anchored to the top-right corner.
       * GizmoHelper handles fixed-corner placement and mirrors the main
       * camera's orientation so the gizmo rotates with the view. */}
      <GizmoHelper alignment="top-right" margin={[80, 80]}>
        <NSEWGizmo />
      </GizmoHelper>

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={3}
        maxDistance={80}
        maxPolarAngle={Math.PI / 2.05}
        enablePan
        panSpeed={0.8}
        rotateSpeed={0.5}
        zoomSpeed={1.0}
        touches={{
          ONE: THREE.TOUCH.ROTATE,
          TWO: THREE.TOUCH.DOLLY_PAN,
        }}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </>
  );
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[2, 2, 2]} />
      <meshStandardMaterial color="#666" wireframe />
    </mesh>
  );
}

export default function BuildingViewer({
  params,
  view = DEFAULT_VIEW,
}: BuildingViewerProps) {
  const [status, setStatus] = useState<BuildStatus>({ kind: "idle" });

  const footprintKey = useMemo(
    () => JSON.stringify(params.footprint),
    [params.footprint],
  );
  const cameraDistance = useMemo(() => {
    const maxDim = Math.max(
      ...params.footprint.map((p) => Math.abs(p[0])),
      ...params.footprint.map((p) => Math.abs(p[1]))
    );
    const totalHeight = params.storeys * params.storeyHeight;
    return Math.max(maxDim * 3, totalHeight * 2, 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footprintKey, params.storeys, params.storeyHeight]);

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
        camera={{
          position: [
            cameraDistance * 0.7,
            cameraDistance * 0.5,
            cameraDistance * 0.7,
          ],
          fov: 40,
          near: 0.1,
          far: 200,
        }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={<LoadingFallback />}>
          <Scene params={params} view={view} onStatusChange={setStatus} />
        </Suspense>
      </Canvas>

      {/* Centered loading spinner overlay */}
      {status.kind === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-2xl bg-black/55 backdrop-blur-md">
            <div className="w-12 h-12 rounded-full border-[3px] border-white/25 border-t-white animate-spin" />
            <span className="text-white/85 text-[11px] font-mono tracking-wide">
              generating…
            </span>
          </div>
        </div>
      )}

      {/* Compact status chip (corner) */}
      <div className="absolute top-3 left-3 text-[10px] font-mono px-2 py-1 rounded bg-black/55 backdrop-blur-sm text-white/75 pointer-events-none">
        {status.kind === "ready" && (
          <span>
            {status.generationMs}ms · {(status.bytes / 1024).toFixed(0)}KB
          </span>
        )}
        {status.kind === "error" && (
          <span className="text-red-300">err: {status.message.slice(0, 60)}</span>
        )}
        {status.kind === "loading" && <span>generating…</span>}
        {status.kind === "idle" && <span>idle</span>}
      </div>
    </div>
  );
}
