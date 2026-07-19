"use client";

import { useMemo } from "react";
import { Environment, ContactShadows, Grid } from "@react-three/drei";
import * as THREE from "three";
import FacadeMesh from "./FacadeMesh";
import Line from "./NodeLine";
import NodeGrid from "./NodeGrid";
import { isWebGPUPath } from "./webgpu";
import InstancedFacadeBoxes from "./InstancedFacadeBoxes";
import StreetNetworkView from "@/components/street/StreetNetworkView";
import type { StreetNetwork } from "@/lib/street/types";
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
import type { Marquee } from "@/lib/facade/marquee";
import {
  levelingFor,
  groundNormal,
  groundHeightAt,
  type Ground,
} from "@/lib/facade/terrain";

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

/** The 12 edges of a centred w×h×d box as segment endpoint pairs — what
 * drei's `<Edges>` computes from a box via EdgesGeometry. Stated explicitly
 * so the outline can render through NodeLine's segments mode on the WebGPU
 * path (drei's Edges is built on the classic LineMaterial, which the node
 * renderer rejects). */
function boxEdgePoints(
  w: number,
  h: number,
  d: number,
): [number, number, number][] {
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  const c = (sx: number, sy: number, sz: number): [number, number, number] => [
    sx * x,
    sy * y,
    sz * z,
  ];
  return [
    // bottom ring
    c(-1, -1, -1), c(1, -1, -1),
    c(1, -1, -1), c(1, -1, 1),
    c(1, -1, 1), c(-1, -1, 1),
    c(-1, -1, 1), c(-1, -1, -1),
    // top ring
    c(-1, 1, -1), c(1, 1, -1),
    c(1, 1, -1), c(1, 1, 1),
    c(1, 1, 1), c(-1, 1, 1),
    c(-1, 1, 1), c(-1, 1, -1),
    // verticals
    c(-1, -1, -1), c(-1, 1, -1),
    c(1, -1, -1), c(1, 1, -1),
    c(1, -1, 1), c(1, 1, 1),
    c(-1, -1, 1), c(-1, 1, 1),
  ];
}

function SelectionMarker({ params }: { params: FacadeParams }) {
  const h = useMemo(() => computeLayout(params).totalHeight, [params]);
  const edges = useMemo(
    () => boxEdgePoints(params.width + 0.15, h + 0.15, 0.7),
    [params.width, h],
  );
  return (
    <group position={[0, h / 2, -0.15]}>
      <Line segments points={edges} color="#3b82f6" lineWidth={1.5} />
    </group>
  );
}

function BlockGroup({
  block,
  selected,
  onSelectLot,
  miters,
  ground,
  cornerSides,
  marqueeLots,
}: {
  block: FacadeBlock;
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  miters: Map<string, LotMiter>;
  ground: Ground;
  cornerSides: Set<string> | null;
  /** Lot indices highlighted by a live marquee (whole enclosed block → all
   * indices; partial block → its selected lots). */
  marqueeLots: Set<number> | null;
}) {
  const placements = useMemo(() => lotPlacements(block), [block]);
  const frame = useMemo(() => blockFrame(block), [block]);
  const isSelectedBlock = selected?.blockId === block.id;
  const midX = frame.origin[0] + (frame.dir[0] * frame.length) / 2;
  const midZ = frame.origin[1] + (frame.dir[1] * frame.length) / 2;
  const mid: [number, number, number] = [
    midX,
    groundHeightAt(midX, midZ, ground), // sit the sidewalk on the tilted ground
    midZ,
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
            {/* At a live corner, cornerSides lights both wings and suppresses
             * the single-lot marker. When no corner resolves (lot/block level,
             * or a dissolved corner), fall back to the plain selected-lot
             * marker so the edited lot is always visibly highlighted. */}
            {((isSelectedBlock && selected?.lot === i && !cornerSides) ||
              cornerSides?.has(`${block.id}:${i}`) ||
              marqueeLots?.has(i)) && (
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
      {/* The block's line — always visible in plan, accented when selected;
       * each endpoint rides the tilted ground so it doesn't float on slopes */}
      <Line
        points={[
          [
            block.line.a[0],
            groundHeightAt(block.line.a[0], block.line.a[1], ground) + 0.06,
            block.line.a[1],
          ],
          [
            block.line.b[0],
            groundHeightAt(block.line.b[0], block.line.b[1], ground) + 0.06,
            block.line.b[1],
          ],
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
  marquee = null,
  streetNetwork,
  selectedStreet = null,
  onSelectStreet,
  selectedIntersection = null,
  onSelectIntersection,
}: {
  blocks: FacadeBlock[];
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  view: ViewSettings;
  maxCornerAngle: number;
  ground: Ground;
  /** Live marquee selection to highlight (blocks/lots via SelectionMarker,
   * nodes via a gold ring). null → no marquee (byte-identical). */
  marquee?: Marquee | null;
  /** Drawn streets + roundabouts, world space. undefined → nothing rendered
   * (byte-identical to before street support existed). */
  streetNetwork?: StreetNetwork;
  /** Selected street id — highlights its ribbon. */
  selectedStreet?: string | null;
  /** Undefined → street ribbons aren't selectable. */
  onSelectStreet?: (id: string) => void;
  /** Selected intersection key — highlights its marker. */
  selectedIntersection?: string | null;
  /** Undefined → intersections aren't selectable. */
  onSelectIntersection?: (key: string) => void;
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
  // Detected once, shared by every corner-derived memo below (this scene
  // mounts once per workspace pane, so a single detectCorners call matters).
  const corners = useMemo(
    () => detectCorners(blocks, maxCornerAngle),
    [blocks, maxCornerAngle],
  );
  const miters = useMemo(() => {
    const m = new Map<string, LotMiter>();
    for (const c of corners) {
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
  }, [corners]);
  // Both corner-side lots to highlight when a corner is selected. Null when
  // no corner is selected OR the selected corner has dissolved (angle change
  // / node drag) — the marker condition falls back to the plain lot marker.
  const cornerSides = useMemo(() => {
    if (selected?.level !== "corner" || !selected.cornerKey) return null;
    const c = corners.find((x) => x.key === selected.cornerKey);
    if (!c) return null;
    return new Set([
      `${c.a.blockId}:${c.a.lotIndex}`,
      `${c.b.blockId}:${c.b.lotIndex}`,
    ]);
  }, [selected, corners]);
  // Marquee highlight: per-block lot-index sets (enclosed block → every lot;
  // partial block → its selected lots) + gold rings at selected node points.
  const marqueeLotsByBlock = useMemo(() => {
    if (!marquee) return null;
    const byId = new Map<string, FacadeBlock>(blocks.map((b) => [b.id, b]));
    const map = new Map<string, Set<number>>();
    const add = (id: string, i: number) => {
      const s = map.get(id) ?? new Set<number>();
      s.add(i);
      map.set(id, s);
    };
    for (const id of marquee.blocks) {
      const b = byId.get(id);
      if (b) b.lots.forEach((_, i) => add(id, i));
    }
    for (const key of marquee.lots) {
      const sep = key.lastIndexOf(":");
      add(key.slice(0, sep), Number(key.slice(sep + 1)));
    }
    return map;
  }, [marquee, blocks]);
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

      {/* Bundled locally (CC0, Poly Haven) — a runtime CDN fetch here once
       * took the whole viewer down when the network hiccuped. */}
      <Environment files="/hdri/furstenstein_1k.hdr" background={false} />

      {blocks.map((block) => (
        <BlockGroup
          key={block.id}
          block={block}
          selected={selected}
          onSelectLot={onSelectLot}
          miters={miters}
          ground={ground}
          cornerSides={cornerSides}
          marqueeLots={marqueeLotsByBlock?.get(block.id) ?? null}
        />
      ))}
      {/* Scene-wide window glass + frames as two InstancedMeshes (perf). The
       * per-block FacadeMesh skips WindowFill under USE_INSTANCING. */}
      <InstancedFacadeBoxes blocks={blocks} ground={ground} />
      {marquee?.nodes.map(([x, z]) => (
        <mesh
          key={`marquee-node-${x}:${z}`}
          position={[x, groundHeightAt(x, z, ground) + 0.12, z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.6, 0.95, 28]} />
          <meshBasicMaterial
            color="#d4a017"
            transparent
            opacity={0.95}
            depthWrite={false}
          />
        </mesh>
      ))}
      {streetNetwork && (
        <StreetNetworkView
          network={streetNetwork}
          selectedStreet={selectedStreet}
          onSelectStreet={onSelectStreet}
          selectedIntersection={selectedIntersection}
          onSelectIntersection={onSelectIntersection}
          ground={ground}
        />
      )}
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

        {/* drei's Grid is a GLSL ShaderMaterial the node renderer can't
         * compile; NodeGrid is its TSL port with identical parameters. */}
        {isWebGPUPath() ? (
          <NodeGrid
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
        ) : (
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
        )}
      </group>

      {/* drei's ContactShadows renders the scene through a MeshDepthMaterial,
       * which the WebGPU node renderer can't compile (it was the spike's
       * stubborn "MeshDepthMaterial is not compatible" error — not the sun's
       * shadow map). On the WebGPU path the real sun shadow covers the ground
       * contact; WebGL keeps the soft blob unchanged. */}
      {!isWebGPUPath() && (
        <ContactShadows
          position={[0, 0.005, 0]}
          opacity={0.45}
          scale={50}
          blur={2.5}
          far={20}
          resolution={1024}
        />
      )}
    </>
  );
}
