"use client";

import { useMemo } from "react";
import { Environment, ContactShadows, Grid, Edges, Line } from "@react-three/drei";
import * as THREE from "three";
import FacadeMesh from "./FacadeMesh";
import type { FacadeParams } from "@/lib/facade/types";
import type { ViewSettings } from "@/lib/building/types";
import {
  blockFrame,
  lotPlacements,
  type FacadeBlock,
  type Selection,
} from "@/lib/facade/blocks";
import { computeLayout, MASSING_DEPTH_DEFAULT } from "@/lib/facade/layout";
import { detectCorners, miterFor, type LotMiter } from "@/lib/facade/corners";
import { levelingFor, groundNormal, type Ground } from "@/lib/facade/terrain";

const BASEMENT_MIN = 0.3; // no sliver plinths below this drop
const BASEMENT_COLOR = "#6f6a62"; // stone

/** Leveling plinth below a building on sloping ground: a stone box from the
 * floor (local y=0) down to −drop, pierced by a row of thin horizontal
 * semi-basement windows on the street face. */
function Basement({ width, depth, drop }: { width: number; depth: number; drop: number }) {
  if (drop < BASEMENT_MIN) return null;
  const n = Math.max(1, Math.floor(width / 1.3));
  const winW = Math.min(0.75, (width / n) * 0.7);
  const winY = -Math.min(drop * 0.45, drop - 0.12);
  return (
    <group>
      <mesh position={[0, -drop / 2, -depth / 2]} castShadow receiveShadow>
        <boxGeometry args={[width, drop, depth]} />
        <meshStandardMaterial color={BASEMENT_COLOR} roughness={0.92} />
      </mesh>
      {Array.from({ length: n }, (_, i) => {
        const x = -width / 2 + ((i + 0.5) * width) / n;
        return (
          <mesh key={i} position={[x, winY, 0.03]}>
            <boxGeometry args={[winW, 0.28, 0.05]} />
            <meshStandardMaterial
              color="#2a2e33"
              roughness={0.2}
              metalness={0.4}
            />
          </mesh>
        );
      })}
    </group>
  );
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

function SelectionMarker({ params }: { params: FacadeParams }) {
  const h = useMemo(() => computeLayout(params).totalHeight, [params]);
  return (
    <mesh position={[0, h / 2, -0.15]}>
      <boxGeometry args={[params.width + 0.15, h + 0.15, 0.7]} />
      <meshBasicMaterial visible={false} />
      <Edges color="#3b82f6" lineWidth={1.5} />
    </mesh>
  );
}

function BlockGroup({
  block,
  selected,
  onSelectLot,
  miters,
  ground,
}: {
  block: FacadeBlock;
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  miters: Map<string, LotMiter>;
  ground: Ground;
}) {
  const placements = useMemo(() => lotPlacements(block), [block]);
  const frame = useMemo(() => blockFrame(block), [block]);
  const isSelectedBlock = selected?.blockId === block.id;
  const mid: [number, number, number] = [
    frame.origin[0] + (frame.dir[0] * frame.length) / 2,
    0,
    frame.origin[1] + (frame.dir[1] * frame.length) / 2,
  ];
  const yaw = Math.atan2(-frame.dir[1], frame.dir[0]);
  return (
    <group>
      {block.lots.map((lot, i) => {
        const pos = placements[i].position;
        const depth = lot.params.massingDepth ?? MASSING_DEPTH_DEFAULT;
        const { datum, drop } = levelingFor(
          pos[0],
          pos[2],
          lot.params.width,
          depth,
          placements[i].rotationY,
          ground,
        );
        return (
          <group
            key={`${block.id}-${i}`}
            position={[pos[0], datum, pos[2]]}
            rotation={[0, placements[i].rotationY, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onSelectLot(block.id, i);
            }}
          >
            <FacadeMesh
              params={lot.params}
              miter={miters.get(`${block.id}:${i}`)}
            />
            <Basement width={lot.params.width} depth={depth} drop={drop} />
            {isSelectedBlock && selected?.lot === i && (
              <SelectionMarker params={lot.params} />
            )}
          </group>
        );
      })}
      {/* Per-block sidewalk strip on the street side of the line */}
      <group position={mid} rotation={[0, yaw, 0]}>
        <mesh position={[0, 0.005, 1.25]} receiveShadow>
          <boxGeometry args={[frame.length, 0.01, 2.5]} />
          <meshStandardMaterial color="#8f8a80" roughness={0.9} />
        </mesh>
      </group>
      {/* The block's line — always visible in plan, accented when selected */}
      <Line
        points={[
          [block.line.a[0], 0.06, block.line.a[1]],
          [block.line.b[0], 0.06, block.line.b[1]],
        ]}
        color={
          isSelectedBlock && selected?.level === "block"
            ? "#3b82f6"
            : "#4a4a48"
        }
        lineWidth={isSelectedBlock && selected?.level === "block" ? 3 : 1.5}
      />
    </group>
  );
}

export default function SceneContents({
  blocks,
  selected,
  onSelectLot,
  view,
  maxCornerAngle,
  ground,
}: {
  blocks: FacadeBlock[];
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  view: ViewSettings;
  maxCornerAngle: number;
  ground: Ground;
}) {
  const groundGeo = useGroundGeometry();
  const groundQuat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(...groundNormal(ground)),
    );
    return q;
  }, [ground]);
  const sunPos = useMemo(
    () => sunPositionFromAngles(view.sunAzimuth, view.sunAltitude),
    [view.sunAzimuth, view.sunAltitude],
  );
  const miters = useMemo(() => {
    const m = new Map<string, LotMiter>();
    for (const c of detectCorners(blocks, maxCornerAngle)) {
      const ext = miterFor(c);
      for (const [side, e] of [
        [c.a, ext.a],
        [c.b, ext.b],
      ] as const) {
        if (e === 0) continue;
        const key = `${side.blockId}:${side.lotIndex}`;
        const cur = m.get(key) ?? { left: 0, right: 0 };
        m.set(key, { ...cur, [side.lotSide]: e });
      }
    }
    return m;
  }, [blocks, maxCornerAngle]);
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

      {blocks.map((block) => (
        <BlockGroup
          key={block.id}
          block={block}
          selected={selected}
          onSelectLot={onSelectLot}
          miters={miters}
          ground={ground}
        />
      ))}
      {/* Ground plane + grid tilt to the slope so buildings sit on it at
       * their datums. polygonOffset keeps the sidewalk/road/grid winning
       * the depth test. */}
      <group quaternion={groundQuat}>
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
      </group>

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
