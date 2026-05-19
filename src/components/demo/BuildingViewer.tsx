"use client";

import { Suspense, useMemo, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  ContactShadows,
  Grid,
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
    // Subdivided enough that the fade band reads smoothly
    const geo = new THREE.PlaneGeometry(200, 200, 96, 96);
    // Slightly-warm gray — between the original tan (#a89c8d) and a cool
    // gray. Reads as neutral stone with a touch of warmth.
    const base = new THREE.Color("#a59e95");
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 4); // RGBA — itemSize=4 enables USE_COLOR_ALPHA
    const SOLID_HALF = 15; // 30×30 m solid square at the centre
    const FADE_END = 70;   // fully transparent past this radius
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // Chebyshev distance → square (not circular) solid region
      const d = Math.max(Math.abs(x), Math.abs(y));
      let alpha: number;
      if (d <= SOLID_HALF) {
        alpha = 1;
      } else if (d >= FADE_END) {
        alpha = 0;
      } else {
        const t = (d - SOLID_HALF) / (FADE_END - SOLID_HALF);
        alpha = 1 - t * t * (3 - 2 * t); // smoothstep falloff
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

/** Tracks the camera's azimuth (angle around the world Y axis from world
 * +Z) every frame and forwards it to a parent listener. Used by the HTML
 * <Compass /> overlay to rotate the N/S/E/W rose so "N" always glues to
 * world +Z on screen. */
function CompassTracker({ onAzimuth }: { onAzimuth: (deg: number) => void }) {
  useFrame(({ camera }) => {
    // atan2(x, z) → angle of camera position in XZ plane, measured from +Z
    // toward +X (CCW positive when looking down from +Y). Returns degrees.
    const deg = (Math.atan2(camera.position.x, camera.position.z) * 180) / Math.PI;
    onAzimuth(deg);
  });
  return null;
}

function Scene({
  params,
  view,
  onStatusChange,
  onAzimuthChange,
}: {
  params: BuildingParams;
  view: ViewSettings;
  onStatusChange: (s: BuildStatus) => void;
  onAzimuthChange: (deg: number) => void;
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

      {/* Fürstenstein old town courtyard HDRI (Poly Haven CC0) */}
      <Environment
        files="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/furstenstein_1k.hdr"
        background={false}
      />

      {/* Building (Homemaker engine → IFC → glTF from backend) */}
      <GLTFBuildingScene params={params} onStatusChange={onStatusChange} />

      {/* Ground plane: uniform warm-earthy color, RGBA vertex attribute
       * holds the alpha gradient. 30×30 m solid square at the centre,
       * smoothstep falloff to fully transparent at 70 m radius. The
       * sky gradient behind the canvas shows through where transparent. */}
      <mesh
        position={[0, -0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        geometry={groundGeo}
      >
        <meshStandardMaterial
          vertexColors
          transparent
          roughness={0.95}
          metalness={0}
        />
      </mesh>

      {/* Site grid overlay — three levels: 25 cm fine, 1 m regular, 5 m major.
       * drei's <Grid> only supports two levels (cell + section), so we stack
       * two grids on slightly different Y offsets to avoid z-fight. */}
      {/* Fine 25 cm sub-grid (faint), 1 m as its "section" (medium-dark) */}
      <Grid
        position={[0, -0.006, 0]}
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
      {/* 5 m major lines (strongest), 1 m repeated here too so the 1 m
       * stays visible past the fine-grid fade distance. */}
      <Grid
        position={[0, -0.004, 0]}
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

      {/* Soft contact shadow blob right under the building */}
      <ContactShadows
        position={[0, 0.005, 0]}
        opacity={0.45}
        scale={50}
        blur={2.5}
        far={20}
        resolution={1024}
      />

      {/* Camera-azimuth tracker — lifts the camera's XZ angle out to the
       * HTML compass overlay below the Canvas. No 3D up/down indicator is
       * shown; the compass is purely N/S/E/W. */}
      <CompassTracker onAzimuth={onAzimuthChange} />

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

/** HTML compass overlay: 2D rose in the top-right corner showing world
 * N/S/E/W. N is rendered in red (compass-needle convention). The whole
 * rose rotates by -azimuth so each label sticks to its world direction
 * regardless of where the camera is. */
function Compass({ azimuth }: { azimuth: number }) {
  return (
    <div className="pointer-events-none absolute top-3 right-3 h-16 w-16">
      <div
        className="relative h-full w-full rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/15"
        style={{ transform: `rotate(${-azimuth}deg)` }}
      >
        <span className="absolute left-1/2 top-1 -translate-x-1/2 font-serif text-[13px] font-bold leading-none text-red-400">
          N
        </span>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] leading-none text-white/55">
          S
        </span>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] leading-none text-white/55">
          E
        </span>
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] leading-none text-white/55">
          W
        </span>
      </div>
    </div>
  );
}

export default function BuildingViewer({
  params,
  view = DEFAULT_VIEW,
}: BuildingViewerProps) {
  const [status, setStatus] = useState<BuildStatus>({ kind: "idle" });
  const [azimuth, setAzimuth] = useState(0);

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
    // footprintKey covers content-equality for params.footprint (which is an
    // array reference that changes on every render).
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
          <Scene
            params={params}
            view={view}
            onStatusChange={setStatus}
            onAzimuthChange={setAzimuth}
          />
        </Suspense>
      </Canvas>

      <Compass azimuth={azimuth} />

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