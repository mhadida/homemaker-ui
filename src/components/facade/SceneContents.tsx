"use client";

import { useEffect, useMemo } from "react";
import { Environment, ContactShadows, Grid } from "@react-three/drei";
import * as THREE from "three";
import FacadeMesh from "./FacadeMesh";
import Line from "./NodeLine";
import NodeGrid from "./NodeGrid";
import { isWebGPUPath } from "./webgpu";
import InstancedFacadeBoxes from "./InstancedFacadeBoxes";
import StreetNetworkView from "@/components/street/StreetNetworkView";
import type { StreetNetwork } from "@/lib/street/types";
// Ground half-extent's single source of truth — the perspective far plane is
// derived from it (src/lib/facade/clip.ts) so the two can never drift apart.
import { GROUND_HALF } from "@/lib/facade/clip";
import { effectiveWidth, minRadiusOf } from "@/lib/street/types";
import { canalHoleOutline } from "@/lib/street/canal";
import { filletCentreline } from "@/lib/street/geometry";
import { deriveSquares, isSquareFrontingBlock } from "@/lib/street/squares";
import type { FacadeParams } from "@/lib/facade/types";
import type { ViewSettings } from "@/lib/building/types";
import {
  blockFrame,
  lotPlacements,
  type FacadeBlock,
  type Selection,
} from "@/lib/facade/blocks";
import { computeLayout, MASSING_DEPTH_DEFAULT } from "@/lib/facade/layout";
import {
  detectCorners,
  miterFor,
  massMiterFor,
  cornerChoice,
  cornerFrame,
  type CornerChoice,
  type LotMiter,
} from "@/lib/facade/corners";
import { cornerRoofPlan, type CornerRoofPlan } from "@/lib/facade/cornerRoof";
import {
  openFillFor,
  blockFootprint,
  type OpenFill,
} from "@/lib/facade/openBlock";
import OpenBlockMesh from "./OpenBlockMesh";
import CornerRoofMesh from "./CornerRoofMesh";
import TurretMesh from "./TurretMesh";
import { ROOF_COLORS } from "./FacadeMesh";
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

/** One simple opaque plane out to the horizon (replaces the old radially
 * fading 200 m patch), with a REAL hole punched for every canal: the cut's
 * rim hides under the canal's own sidewalks and the quay walls + bed line
 * the channel. The same holes-in-terrain shape is where future cuts
 * (sunken plazas, stairs) will go. */
function useGroundGeometry(streetNetwork?: StreetNetwork) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape([
      new THREE.Vector2(-GROUND_HALF, -GROUND_HALF),
      new THREE.Vector2(GROUND_HALF, -GROUND_HALF),
      new THREE.Vector2(GROUND_HALF, GROUND_HALF),
      new THREE.Vector2(-GROUND_HALF, GROUND_HALF),
    ]);
    for (const s of streetNetwork?.streets ?? []) {
      if (s.type !== "canal") continue;
      const cl = filletCentreline(s.points, minRadiusOf(s), 8, s.closed);
      const outline = canalHoleOutline(cl, effectiveWidth(s));
      if (!outline) continue;
      // The plane is rotated −90° about X: plane (x, y) → world (x, −z).
      shape.holes.push(
        new THREE.Path(outline.map(([x, z]) => new THREE.Vector2(x, -z))),
      );
    }
    return new THREE.ShapeGeometry(shape);
  }, [streetNetwork]);
  useEffect(() => () => geo.dispose(), [geo]);
  return geo;
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
  massMiters,
  noRoof,
  datumOverride,
  rearSkin,
  openFill,
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
  /** Merged-corner elbow extensions / roof suppression / shared datums —
   * empty when no unified corner touches this block. */
  massMiters: Map<string, LotMiter>;
  noRoof: Set<string>;
  datumOverride: Map<string, number>;
  /** This block lines a square's interior — each lot grows a second facade
   * skin on the massing rear, facing the void. */
  rearSkin: boolean;
  /** Non-null → this frontage is too short for a terrace and renders as open
   * space (plaza/park) instead of buildings. Null = normal building block. */
  openFill: OpenFill | null;
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
      {/* Open block: plaza/park fill replaces the buildings. The frontage line
        * below still renders (plan view), byte-identical when openFill null. */}
      {openFill && (
        <OpenBlockMesh
          footprint={blockFootprint(frame, MASSING_DEPTH_DEFAULT)}
          fill={openFill}
          seed={block.seed}
          ground={ground}
        />
      )}
      {!openFill &&
        block.lots.map((lot, i) => {
        const pos = placements[i].position;
        const depth = lot.params.massingDepth ?? MASSING_DEPTH_DEFAULT;
        const key = `${block.id}:${i}`;
        const { datum: ownDatum, drop: ownDrop } = levelingFor(
          pos[0],
          pos[2],
          lot.params.width,
          depth,
          placements[i].rotationY,
          ground,
        );
        // A merged corner levels both wings at the primary side's datum so
        // the shared mass and L-roof can't tear on a slope; the basement
        // grows by the lift so it still reaches the ground.
        const datum = datumOverride.get(key) ?? ownDatum;
        const drop = ownDrop + (datum - ownDatum);
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
              miter={miters.get(key)}
              massMiter={massMiters.get(key)}
              roof={!noRoof.has(key)}
            />
            {/* Second facade on the massing rear, facing the square void —
             * wall + openings + ornament only (skin mode); the front's
             * massing and roof already span the depth. */}
            {rearSkin && (
              <group position={[0, 0, -depth]} rotation={[0, Math.PI, 0]}>
                <FacadeMesh params={lot.params} skin />
              </group>
            )}
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
      {!openFill && (
        <group position={mid} rotation={[0, yaw, 0]}>
          <mesh position={[0, 0.005, 1.25]} receiveShadow>
            <boxGeometry args={[frame.length, 0.01, 2.5]} />
            <meshStandardMaterial color="#8f8a80" roughness={0.9} />
          </mesh>
        </group>
      )}
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
  selectedSquare = null,
  onSelectSquare,
  gridAngleDeg = null,
  cornerChoices,
}: {
  blocks: FacadeBlock[];
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  view: ViewSettings;
  maxCornerAngle: number;
  ground: Ground;
  /** Rotate the drawn grid to the drawing-grid angle while grid lock is on
   * (plan pane). null → axis-aligned, byte-identical. */
  gridAngleDeg?: number | null;
  /** Corner mode choices — unified corners merge into one mass with one
   * L-roof. Absent → no merging (byte-identical). */
  cornerChoices?: ReadonlyMap<string, CornerChoice>;
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
  /** Selected square (loop id) + selection callback. */
  selectedSquare?: string | null;
  onSelectSquare?: (streetId: string) => void;
}) {
  const groundGeo = useGroundGeometry(streetNetwork);
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
  // Merged (unified) corners: elbow mass extensions, the shared datum both
  // wings level to, per-lot roof suppression, and the L-roof plans
  // (2026-07-17 corner-l-roof spec). Empty maps/sets when no corner is
  // unified or a precondition fails — every path falls back byte-identical.
  const cornerMerge = useMemo(() => {
    const roofs: { key: string; plan: CornerRoofPlan; datum: number; color: string }[] = [];
    const turrets: {
      key: string;
      x: number;
      z: number;
      datum: number;
      baseY: number;
      wallTop: number;
      corbelled: boolean;
      wallColor: string;
      trimColor: string;
      roofColor: string;
    }[] = [];
    const massMiters = new Map<string, LotMiter>();
    const noRoof = new Set<string>();
    const datumOverride = new Map<string, number>();
    if (!cornerChoices || corners.length === 0)
      return { roofs, turrets, massMiters, noRoof, datumOverride };
    const byId = new Map(blocks.map((b) => [b.id, b]));
    for (const c of corners) {
      const choice = cornerChoice(cornerChoices, c, blocks);
      if (choice.mode !== "unified") continue;
      const pSide = c[choice.primary];
      const oSide = c[choice.primary === "a" ? "b" : "a"];
      const pBlock = byId.get(pSide.blockId)!;
      const pLot = pBlock.lots[pSide.lotIndex];
      const oLot = byId.get(oSide.blockId)!.lots[oSide.lotIndex];
      const pLayout = computeLayout(pLot.params);
      const oLayout = computeLayout(oLot.params);
      const D = pLayout.massingDepth;

      // Elbow fill — every unified corner, flat roofs included. Seed from
      // the WALL miter so the untouched side keeps its wall extension.
      const mm = massMiterFor(c, D);
      for (const [side, e] of [
        [c.a, mm.a],
        [c.b, mm.b],
      ] as const) {
        if (e === 0) continue;
        const key = `${side.blockId}:${side.lotIndex}`;
        const cur =
          massMiters.get(key) ??
          { ...(miters.get(key) ?? { left: 0, right: 0 }) };
        massMiters.set(key, { ...cur, [side.lotSide]: e });
      }

      // Shared datum: both wings level where the PRIMARY corner lot stands,
      // so the merged mass (and its roof) can't tear on a slope. Flat
      // ground: every datum is equal anyway — byte-identical.
      const placement = lotPlacements(pBlock)[pSide.lotIndex];
      const { datum } = levelingFor(
        placement.position[0],
        placement.position[2],
        pLot.params.width,
        D,
        placement.rotationY,
        ground,
      );
      datumOverride.set(`${c.a.blockId}:${c.a.lotIndex}`, datum);
      datumOverride.set(`${c.b.blockId}:${c.b.lotIndex}`, datum);

      // Corner turret — straddles the node; independent of the roof
      // preconditions (a flat-roofed corner can still carry one).
      const turret = choice.turret ?? "none";
      if (turret !== "none") {
        turrets.push({
          key: c.key,
          x: c.node[0],
          z: c.node[1],
          datum,
          baseY: turret === "corbel" ? (pLayout.storeyLevels[1] ?? 0) : 0,
          wallTop: pLayout.wallTop,
          corbelled: turret === "corbel",
          wallColor: pLot.params.wallColor,
          trimColor: pLot.params.trimColor,
          roofColor: ROOF_COLORS[pLot.params.roofColor ?? "slate"],
        });
      }

      // One L-roof only when every precondition holds; otherwise the wings
      // keep their independent tents exactly as today.
      if (!pLayout.roof) continue; // flat — the fill above still applies
      if ((pLot.params.roofOrientation ?? "parallel") !== "parallel") continue;
      if ((oLot.params.roofOrientation ?? "parallel") !== "parallel") continue;
      if (oLayout.massingDepth !== D) continue;
      if (oLayout.wallTop !== pLayout.wallTop) continue;
      const frame = cornerFrame(c, blocks);
      const plan = cornerRoofPlan({
        V: frame.V,
        uA: frame.uA,
        uB: frame.uB,
        nA: frame.nA,
        nB: frame.nB,
        D,
        Wa: frame.Wa,
        Wb: frame.Wb,
        convex: c.convex,
        type: pLayout.roof.type,
        eaveY: pLayout.wallTop,
        roofHeight: pLayout.roof.ridgeY - pLayout.roof.eaveY,
      });
      if (!plan) continue;
      roofs.push({
        key: c.key,
        plan,
        datum,
        color: ROOF_COLORS[pLot.params.roofColor ?? "slate"],
      });
      noRoof.add(`${c.a.blockId}:${c.a.lotIndex}`);
      noRoof.add(`${c.b.blockId}:${c.b.lotIndex}`);
    }
    return { roofs, turrets, massMiters, noRoof, datumOverride };
  }, [cornerChoices, corners, blocks, miters, ground]);
  // Square-fronting blocks: street-derived blocks lining a closed loop's
  // interior back onto the square void, so they earn a second facade skin
  // facing it. Empty set when no closed loops (byte-identical).
  const squareFrontingIds = useMemo(() => {
    if (!streetNetwork) return new Set<string>();
    const squares = deriveSquares(streetNetwork);
    if (squares.length === 0) return new Set<string>();
    return new Set(
      blocks.filter((b) => isSquareFrontingBlock(b, squares)).map((b) => b.id),
    );
  }, [streetNetwork, blocks]);
  // Open blocks: frontages too short for a terrace render as plaza/park instead
  // of buildings. Derived from seed + length — sparse, empty for a normal scene
  // (byte-identical). Excluded below from the window instancer too.
  const openFills = useMemo(() => {
    const m = new Map<string, OpenFill>();
    for (const b of blocks) {
      const f = openFillFor(blockFrame(b).length, b.seed, b.gen.lotWidth.min);
      if (f) m.set(b.id, f);
    }
    return m;
  }, [blocks]);
  const buildingBlocks = useMemo(
    () => blocks.filter((b) => !openFills.has(b.id)),
    [blocks, openFills],
  );
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
          massMiters={cornerMerge.massMiters}
          noRoof={cornerMerge.noRoof}
          datumOverride={cornerMerge.datumOverride}
          rearSkin={squareFrontingIds.has(block.id)}
          openFill={openFills.get(block.id) ?? null}
        />
      ))}
      {/* Merged corner L-roofs — one hip/valley surface per unified corner,
       * replacing the two suppressed per-wing tents. */}
      {cornerMerge.roofs.map((r) => (
        <CornerRoofMesh key={r.key} plan={r.plan} datum={r.datum} color={r.color} />
      ))}
      {/* Corner turrets (round towers straddling unified corner nodes). */}
      {cornerMerge.turrets.map(({ key, ...t }) => (
        <TurretMesh key={`turret-${key}`} {...t} />
      ))}
      {/* Scene-wide window glass + frames as two InstancedMeshes (perf). The
       * per-block FacadeMesh skips WindowFill under USE_INSTANCING. */}
      <InstancedFacadeBoxes blocks={buildingBlocks} ground={ground} />
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
          selectedSquare={selectedSquare}
          onSelectSquare={onSelectSquare}
          ground={ground}
        />
      )}
      {/* Ground plane + grid tilt to the slope so buildings sit on it at
       * their datums. polygonOffset keeps the sidewalk/road/grid winning
       * the depth test. */}
      <group quaternion={groundQuat}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow geometry={groundGeo}>
          <meshStandardMaterial
            color="#a59e95"
            roughness={0.95}
            metalness={0}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>

        {/* drei's Grid is a GLSL ShaderMaterial the node renderer can't
         * compile; NodeGrid is its TSL port with identical parameters. The
         * wrapper group spins the grid to the drawing-grid angle while grid
         * lock is on (5 m sections = the snap spacing). */}
        <group rotation={[0, ((gridAngleDeg ?? 0) * Math.PI) / 180, 0]}>
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
