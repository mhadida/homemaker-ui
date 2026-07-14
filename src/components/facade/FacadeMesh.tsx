"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import {
  computeLayout,
  WALL_THICKNESS,
  SHOPFRONT_FASCIA,
  type FacadeLayout,
  type OpeningRect,
  type SectionStrip,
  type PassagePlan,
  type GablePlan,
} from "@/lib/facade/layout";
import type { FacadeParams, WindowStyleId } from "@/lib/facade/types";
import type { LotMiter } from "@/lib/facade/corners";
import { roofTriangles, type RoofPlan, type Dormer } from "@/lib/facade/roof";

const ROOF_COLORS = { slate: "#4a4e57", red: "#8a3b2e" } as const;

/** Roof BufferGeometry from a plan. Non-indexed (crisp faceted faces) with
 * each triangle auto-oriented so its normal points away from the mass
 * interior — so roofTriangles() needn't hand-wind faces correctly. */
function buildRoofGeometry(plan: RoofPlan): THREE.BufferGeometry {
  const tris = roofTriangles(plan);
  const ref = new THREE.Vector3(0, plan.eaveY, (plan.zFront + plan.zBack) / 2);
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
    cen.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(ref);
    if (n.dot(cen) < 0) {
      // flip winding so the normal points outward
      positions.push(...tris[i], ...tris[i + 2], ...tris[i + 1]);
    } else {
      positions.push(...tris[i], ...tris[i + 1], ...tris[i + 2]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A shaped ("bent"/compound) front gable: the street wall panel rising above
 * the eave into the curved/stepped silhouette, extruded to wall thickness with
 * a thin trim coping tracing the profile. Facade-local; in the outer group. */
function GableMesh({
  gable,
  wallColor,
  trimColor,
}: {
  gable: GablePlan;
  wallColor: string;
  trimColor: string;
}) {
  const geo = useMemo(() => {
    const p = gable.points;
    const shape = new THREE.Shape();
    shape.moveTo(p[0][0], gable.baseY + p[0][1]);
    for (let i = 1; i < p.length; i++)
      shape.lineTo(p[i][0], gable.baseY + p[i][1]);
    shape.closePath(); // close along the eave (bottom) back to the start
    // Extrude slightly DEEPER than the wall so the gable's opaque volume
    // covers a perpendicular roof's front gable-end (which sits at
    // −WALL_THICKNESS) instead of z-fighting a coplanar face with it.
    const depth = WALL_THICKNESS + 0.08;
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth); // front face at z = 0
    return g;
  }, [gable]);
  useEffect(() => () => geo.dispose(), [geo]);
  // Coping outline: the shaped top edge, proud of the wall, in trim colour.
  const coping = useMemo<[number, number, number][]>(
    () => gable.points.map((pt) => [pt[0], gable.baseY + pt[1], 0.04]),
    [gable],
  );
  return (
    <group>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial color={wallColor} roughness={0.85} />
      </mesh>
      <Line points={coping} color={trimColor} lineWidth={2.5} />
    </group>
  );
}

type V3 = [number, number, number];
function soupGeometry(t: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(t, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A gabled dormer on the front roof slope. The little gable roof and the two
 * cheek walls die INTO the main slope at the back (their back edges lie on the
 * slope, per `roofDormers`), so the junction is watertight — no gap or
 * poke-through. Facade-local; rendered in the roof group. */
function DormerMesh({
  d,
  wallColor,
  trimColor,
  roofColor,
}: {
  d: Dormer;
  wallColor: string;
  trimColor: string;
  roofColor: string;
}) {
  const h = d.headY - d.sillY;
  const cy = (d.sillY + d.headY) / 2;
  const xl = d.x - d.w / 2;
  const xr = d.x + d.w / 2;
  const oxl = xl - d.over;
  const oxr = xr + d.over;

  // Little gable roof: front gable at the face, two slopes running back to die
  // into the main slope (ridge at zRidgeBack, eaves at zEaveBack).
  const roofGeo = useMemo(() => {
    const PF: V3 = [d.x, d.peakY, d.faceZ];
    const PB: V3 = [d.x, d.peakY, d.zRidgeBack];
    const EL: V3 = [oxl, d.headY, d.faceZ];
    const ER: V3 = [oxr, d.headY, d.faceZ];
    const BL: V3 = [oxl, d.headY, d.zEaveBack];
    const BR: V3 = [oxr, d.headY, d.zEaveBack];
    const t: number[] = [];
    const push = (...vs: V3[]) => vs.forEach((v) => t.push(v[0], v[1], v[2]));
    push(EL, PF, PB, EL, PB, BL); // left slope
    push(ER, BR, PB, ER, PB, PF); // right slope
    return soupGeometry(t);
  }, [d.x, d.peakY, d.faceZ, d.zRidgeBack, d.headY, oxl, oxr, d.zEaveBack]);

  // Front gable infill (wall) + two cheek walls that meet the slope at the back.
  const wallGeo = useMemo(() => {
    const t: number[] = [];
    const push = (...vs: V3[]) => vs.forEach((v) => t.push(v[0], v[1], v[2]));
    // front gable triangle
    push([oxl, d.headY, d.faceZ], [oxr, d.headY, d.faceZ], [d.x, d.peakY, d.faceZ]);
    // left cheek: front-top (headY), front-bottom on slope (eaveY), back on
    // slope at headY — a triangle riding the slope.
    push([xl, d.headY, d.faceZ], [xl, d.eaveY, d.faceZ], [xl, d.headY, d.zEaveBack]);
    // right cheek
    push([xr, d.headY, d.faceZ], [xr, d.headY, d.zEaveBack], [xr, d.eaveY, d.faceZ]);
    return soupGeometry(t);
  }, [d.x, d.headY, d.peakY, d.faceZ, d.eaveY, d.zEaveBack, xl, xr, oxl, oxr]);

  useEffect(
    () => () => {
      roofGeo.dispose();
      wallGeo.dispose();
    },
    [roofGeo, wallGeo],
  );

  return (
    <group>
      <mesh geometry={roofGeo} castShadow receiveShadow>
        <meshStandardMaterial
          color={roofColor}
          roughness={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={wallGeo} castShadow receiveShadow>
        <meshStandardMaterial
          color={wallColor}
          roughness={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* window: trim frame + glass, on the vertical face */}
      <mesh position={[d.x, cy, d.faceZ + 0.02]} castShadow>
        <boxGeometry args={[d.w + 0.08, h + 0.08, 0.05]} />
        <meshStandardMaterial color={trimColor} roughness={0.7} />
      </mesh>
      <mesh position={[d.x, cy, d.faceZ + 0.04]}>
        <boxGeometry args={[d.w, h, 0.04]} />
        <meshStandardMaterial color="#2a2e33" roughness={0.2} metalness={0.4} />
      </mesh>
    </group>
  );
}

const FRAME_T = 0.07; // window frame member thickness
const FRAME_D = 0.06; // frame depth
const GLASS_RECESS = 0.15; // how far frames/glass sit behind the wall face
const GLAZING_BAR = 0.04; // thin internal glazing-bar thickness

/** Does this bay belong to the strip? The layout guarantees strips tile the
 * bay range, so every opening/sill/stoop lands in exactly one strip. */
const inStrip = (bay: number, s: SectionStrip): boolean =>
  bay >= s.startBay && bay < s.startBay + s.bays;

/** One section strip's wall body: the strip rect (lap included) with its own
 * punched opening holes, extruded to thickness. ExtrudeGeometry runs +z from
 * the shape plane, so we shift it back so the front face lands at z=0 (the
 * strip group applies the section's relief offset). `extendL`/`extendR` are
 * the corner miter extensions — nonzero only on the outer strips; the
 * mitered sliver carries no openings. */
function buildStripGeometry(
  layout: FacadeLayout,
  strip: SectionStrip,
  extendL = 0,
  extendR = 0,
): THREE.ExtrudeGeometry {
  const x0 = strip.x0 - extendL;
  const x1 = strip.x1 + extendR;
  const shape = new THREE.Shape();
  shape.moveTo(x0, 0);
  shape.lineTo(x1, 0);
  shape.lineTo(x1, layout.wallTop);
  shape.lineTo(x0, layout.wallTop);
  shape.closePath();
  for (const o of layout.openings) {
    if (!inStrip(o.bay, strip)) continue;
    const hole = new THREE.Path();
    if (o.arched) {
      // Semicircular head (radius w/2 at springline y + h − w/2): up the
      // jambs, then an arc right → top → left across the crown.
      const r = o.w / 2;
      const spring = o.y + o.h - r;
      const cx = o.x + r;
      hole.moveTo(o.x, o.y);
      hole.lineTo(o.x + o.w, o.y);
      hole.lineTo(o.x + o.w, spring);
      hole.absarc(cx, spring, r, 0, Math.PI, false);
      hole.lineTo(o.x, o.y);
    } else {
      hole.moveTo(o.x, o.y);
      hole.lineTo(o.x + o.w, o.y);
      hole.lineTo(o.x + o.w, o.y + o.h);
      hole.lineTo(o.x, o.y + o.h);
    }
    hole.closePath();
    shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: WALL_THICKNESS,
    bevelEnabled: false,
  });
  geo.translate(0, 0, -WALL_THICKNESS);
  return geo;
}

/** Shared glass material treatment — mirrors the "homemaker:window" handling
 * in GLTFBuildingScene (high envMapIntensity, transparent, no depth write). */
function Glass({ w, h }: { w: number; h: number }) {
  return (
    <mesh position={[0, 0, -0.02]}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial
        color="#8fa9bd"
        roughness={0.08}
        metalness={0.6}
        envMapIntensity={3.0}
        transparent
        opacity={0.9}
        depthWrite={false}
      />
    </mesh>
  );
}

function Trim({ color }: { color: string }) {
  return <meshStandardMaterial color={color} roughness={0.6} />;
}

/** Internal glazing bars for a w×h pane, centered on the group origin.
 * "sash" reproduces the pre-windowStyle rendering exactly. */
function MullionBars({
  w,
  h,
  style,
  trimColor,
}: {
  w: number;
  h: number;
  style: WindowStyleId;
  trimColor: string;
}) {
  if (style === "none") return null;
  if (style === "victorian") {
    return (
      <mesh position={[0, h * 0.12, 0]}>
        <boxGeometry args={[w, 0.05, FRAME_D]} />
        <Trim color={trimColor} />
      </mesh>
    );
  }
  if (style === "sash") {
    return (
      <>
        <mesh>
          <boxGeometry args={[0.05, h, FRAME_D]} />
          <Trim color={trimColor} />
        </mesh>
        <mesh position={[0, h * 0.12, 0]}>
          <boxGeometry args={[w, 0.05, FRAME_D]} />
          <Trim color={trimColor} />
        </mesh>
      </>
    );
  }
  // georgian: vertical bars at thirds + horizontal bars for ~square panes
  const rows = Math.max(2, Math.round(h / (w / 3)));
  return (
    <>
      {[-w / 6, w / 6].map((x, i) => (
        <mesh key={`v${i}`} position={[x, 0, 0]}>
          <boxGeometry args={[GLAZING_BAR, h, FRAME_D]} />
          <Trim color={trimColor} />
        </mesh>
      ))}
      {Array.from({ length: rows - 1 }, (_, i) => (
        <mesh key={`h${i}`} position={[0, -h / 2 + ((i + 1) * h) / rows, 0]}>
          <boxGeometry args={[w, GLAZING_BAR, FRAME_D]} />
          <Trim color={trimColor} />
        </mesh>
      ))}
    </>
  );
}

function WindowFill({
  o,
  trimColor,
  windowStyle,
}: {
  o: OpeningRect;
  trimColor: string;
  windowStyle: WindowStyleId;
}) {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  return (
    <group position={[cx, cy, -GLASS_RECESS]}>
      <Glass w={o.w} h={o.h} />
      {/* frame: top / bottom / left / right */}
      <mesh position={[0, o.h / 2 - FRAME_T / 2, 0]}>
        <boxGeometry args={[o.w, FRAME_T, FRAME_D]} />
        <Trim color={trimColor} />
      </mesh>
      <mesh position={[0, -o.h / 2 + FRAME_T / 2, 0]}>
        <boxGeometry args={[o.w, FRAME_T, FRAME_D]} />
        <Trim color={trimColor} />
      </mesh>
      <mesh position={[-o.w / 2 + FRAME_T / 2, 0, 0]}>
        <boxGeometry args={[FRAME_T, o.h, FRAME_D]} />
        <Trim color={trimColor} />
      </mesh>
      <mesh position={[o.w / 2 - FRAME_T / 2, 0, 0]}>
        <boxGeometry args={[FRAME_T, o.h, FRAME_D]} />
        <Trim color={trimColor} />
      </mesh>
      <MullionBars w={o.w} h={o.h} style={windowStyle} trimColor={trimColor} />
    </group>
  );
}

function DoorFill({
  o,
  doorColor,
  trimColor,
  windowStyle,
}: {
  o: OpeningRect;
  doorColor: string;
  trimColor: string;
  windowStyle: WindowStyleId;
}) {
  // With a transom, the leaf occupies the bottom DOOR_LEAF_HEIGHT of the
  // opening (o.h - transomH === DOOR_LEAF_HEIGHT by construction).
  const leafH = o.transomH ? o.h - o.transomH : o.h;
  return (
    <group position={[o.x + o.w / 2, o.y, -0.18]}>
      {/* leaf panel */}
      <mesh position={[0, leafH / 2, 0]} castShadow>
        <boxGeometry args={[o.w, leafH, 0.07]} />
        <meshStandardMaterial color={doorColor} roughness={0.5} />
      </mesh>
      {/* two raised panel hints (same proportions as before, bottom-up) */}
      <mesh position={[0, leafH * 0.72, 0.045]}>
        <boxGeometry args={[o.w * 0.62, leafH * 0.3, 0.015]} />
        <meshStandardMaterial color={doorColor} roughness={0.4} />
      </mesh>
      <mesh position={[0, leafH * 0.28, 0.045]}>
        <boxGeometry args={[o.w * 0.62, leafH * 0.3, 0.015]} />
        <meshStandardMaterial color={doorColor} roughness={0.4} />
      </mesh>
      {/* knob */}
      <mesh position={[o.w * 0.32, leafH / 2, 0.06]}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshStandardMaterial color="#b8a878" roughness={0.25} metalness={0.8} />
      </mesh>
      {/* glazed transom above the leaf */}
      {o.transomH && (
        <group position={[0, leafH + o.transomH / 2, 0]}>
          <Glass w={o.w} h={o.transomH} />
          {windowStyle === "georgian" &&
            [-o.w / 6, o.w / 6].map((x, i) => (
              <mesh key={i} position={[x, 0, 0]}>
                <boxGeometry args={[GLAZING_BAR, o.transomH!, FRAME_D]} />
                <Trim color={trimColor} />
              </mesh>
            ))}
          {/* frame bar between leaf and transom */}
          <mesh position={[0, -o.transomH / 2 + 0.04, 0.02]}>
            <boxGeometry args={[o.w, 0.08, 0.1]} />
            <Trim color={trimColor} />
          </mesh>
          {/* slim top frame member */}
          <mesh position={[0, o.transomH / 2 - 0.035, 0]}>
            <boxGeometry args={[o.w, 0.07, 0.06]} />
            <Trim color={trimColor} />
          </mesh>
        </group>
      )}
    </group>
  );
}

const AWNING_PROJECT = 1.0; // how far the awning reaches out from the wall
const AWNING_DROP = 0.35; // vertical fall over that projection
const AWNING_VALANCE = 0.3; // hanging front flap
const AWNING_COLOR = "#6b3b3b"; // canvas

/** Projecting shopfront awning: a sloped canvas + a hanging front valance,
 * attached just above the glazing. Rendered only when toggled on. */
function Awning({ w, topY }: { w: number; topY: number }) {
  const slope = Math.hypot(AWNING_PROJECT, AWNING_DROP);
  const angle = Math.atan2(AWNING_DROP, AWNING_PROJECT);
  return (
    <group>
      {/* sloped canvas: attaches at the wall front (local z ≈ 0.1) above the
       * glazing, tilts down-and-out */}
      <mesh
        position={[0, topY - AWNING_DROP / 2, 0.1 + AWNING_PROJECT / 2]}
        rotation={[angle, 0, 0]}
        castShadow
      >
        <boxGeometry args={[w + 0.2, 0.04, slope]} />
        <meshStandardMaterial color={AWNING_COLOR} roughness={0.85} />
      </mesh>
      {/* front valance flap */}
      <mesh
        position={[0, topY - AWNING_DROP - AWNING_VALANCE / 2, 0.1 + AWNING_PROJECT]}
        castShadow
      >
        <boxGeometry args={[w + 0.2, AWNING_VALANCE, 0.04]} />
        <meshStandardMaterial color={AWNING_COLOR} roughness={0.85} />
      </mesh>
    </group>
  );
}

function ShopfrontFill({
  o,
  trimColor,
  awning,
}: {
  o: OpeningRect;
  trimColor: string;
  awning?: boolean;
}) {
  return (
    <group position={[o.x + o.w / 2, o.y + o.h / 2, -0.1]}>
      <Glass w={o.w} h={o.h} />
      {awning && <Awning w={o.w} topY={o.h / 2} />}
      {/* stallriser: solid base band */}
      <mesh position={[0, -o.h / 2 + 0.25, 0]}>
        <boxGeometry args={[o.w, 0.5, 0.08]} />
        <Trim color={trimColor} />
      </mesh>
      {/* transom bar at door height when the glazing is tall enough */}
      {o.h > 2.4 && (
        <mesh position={[0, -o.h / 2 + 2.1, 0]}>
          <boxGeometry args={[o.w, 0.08, 0.08]} />
          <Trim color={trimColor} />
        </mesh>
      )}
      {/* vertical mullions at thirds */}
      <mesh position={[-o.w / 6, 0, 0]}>
        <boxGeometry args={[0.06, o.h, 0.08]} />
        <Trim color={trimColor} />
      </mesh>
      <mesh position={[o.w / 6, 0, 0]}>
        <boxGeometry args={[0.06, o.h, 0.08]} />
        <Trim color={trimColor} />
      </mesh>
      {/* fascia band over the glazing, slightly proud of the wall face */}
      <mesh position={[0, o.h / 2 + SHOPFRONT_FASCIA / 2, 0.12]} castShadow>
        <boxGeometry args={[o.w + 0.2, SHOPFRONT_FASCIA - 0.1, 0.08]} />
        <Trim color={trimColor} />
      </mesh>
    </group>
  );
}

function GarageFill({ o, doorColor }: { o: OpeningRect; doorColor: string }) {
  const RIBS = 5;
  return (
    <group position={[o.x + o.w / 2, o.y + o.h / 2, -0.15]}>
      <mesh castShadow>
        <boxGeometry args={[o.w, o.h, 0.06]} />
        <meshStandardMaterial color={doorColor} roughness={0.55} metalness={0.15} />
      </mesh>
      {Array.from({ length: RIBS }, (_, i) => (
        <mesh
          key={i}
          position={[0, -o.h / 2 + ((i + 0.5) * o.h) / RIBS, 0.04]}
        >
          <boxGeometry args={[o.w - 0.1, 0.05, 0.02]} />
          <meshStandardMaterial color={doorColor} roughness={0.4} metalness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

/** Carriage-arch surround for a pass-through passage: a stone keystone at the
 * crown + impost blocks at the springline. The see-through void itself is the
 * arched wall hole (punched in buildStripGeometry) + the pierced mass
 * (StripMass); this is the facade decoration that reads it as an arch. */
function PassageFill({ o, trimColor }: { o: OpeningRect; trimColor: string }) {
  const r = o.w / 2;
  const spring = o.y + o.h - r; // springline
  const crown = o.y + o.h;
  const cx = o.x + r;
  return (
    <group>
      <mesh position={[cx, crown - 0.15, 0.05]} castShadow>
        <boxGeometry args={[0.34, 0.5, 0.16]} />
        <meshStandardMaterial color={trimColor} roughness={0.8} />
      </mesh>
      {[o.x, o.x + o.w].map((ix, i) => (
        <mesh key={i} position={[ix, spring, 0.04]} castShadow>
          <boxGeometry args={[0.2, 0.16, 0.13]} />
          <meshStandardMaterial color={trimColor} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

const MASS_EPS = 0.02; // sliver guard for pier/lintel boxes
const TUNNEL_FLOOR_COLOR = "#2b2724"; // dark cobbles under the passage

/** One section strip's massing body. Normally a single wall-colored box; when
 * a pass-through passage falls inside this strip's band it splits into two
 * piers + a lintel around a full-depth tunnel void (plus a dark floor), so the
 * arch reads all the way through to behind the building. Depth/center match
 * the original box (front flush with the wall back, extending back by
 * massingDepth). */
function StripMass({
  x0,
  x1,
  wallTop,
  massingDepth,
  color,
  passage,
}: {
  x0: number;
  x1: number;
  wallTop: number;
  massingDepth: number;
  color: string;
  /** non-null only when the passage lies within [x0, x1] */
  passage: PassagePlan | null;
}) {
  const zc = -(WALL_THICKNESS + massingDepth) / 2;
  const dz = massingDepth - WALL_THICKNESS;
  if (!passage) {
    return (
      <mesh position={[(x0 + x1) / 2, wallTop / 2, zc]} castShadow receiveShadow>
        <boxGeometry args={[x1 - x0, wallTop, dz]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
    );
  }
  const { x0: px0, x1: px1, top } = passage;
  const leftW = px0 - x0;
  const rightW = x1 - px1;
  const lintelH = wallTop - top;
  return (
    <group>
      {leftW > MASS_EPS && (
        <mesh position={[(x0 + px0) / 2, wallTop / 2, zc]} castShadow receiveShadow>
          <boxGeometry args={[leftW, wallTop, dz]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      )}
      {rightW > MASS_EPS && (
        <mesh position={[(px1 + x1) / 2, wallTop / 2, zc]} castShadow receiveShadow>
          <boxGeometry args={[rightW, wallTop, dz]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      )}
      {lintelH > MASS_EPS && (
        <mesh
          position={[(px0 + px1) / 2, (top + wallTop) / 2, zc]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[px1 - px0, lintelH, dz]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      )}
      <mesh position={[(px0 + px1) / 2, 0.02, zc]} receiveShadow>
        <boxGeometry args={[px1 - px0, 0.04, dz]} />
        <meshStandardMaterial color={TUNNEL_FLOOR_COLOR} roughness={0.95} />
      </mesh>
    </group>
  );
}

/** Stepped classical cornice for one section strip: three stacked boxes with
 * growing projection spanning [x0, x1] (miter extensions folded in by the
 * caller). Sideways projection applies only at the OUTER facade ends
 * (`projectLeft`/`projectRight`) — internal section ends butt flush so
 * same-offset neighbors' boxes never overlap/z-fight, and offset steps read
 * as clean returns. */
function CorniceSegment({
  layout,
  trimColor,
  x0,
  x1,
  projectLeft,
  projectRight,
}: {
  layout: FacadeLayout;
  trimColor: string;
  x0: number;
  x1: number;
  projectLeft: boolean;
  projectRight: boolean;
}) {
  if (!layout.cornice) return null;
  const { y, height, projection } = layout.cornice;
  const steps = [
    { h: height * 0.4, p: projection * 0.4 },
    { h: height * 0.35, p: projection * 0.7 },
    { h: height * 0.25, p: projection },
  ];
  let cursor = y;
  const boxes = steps.map((s) => {
    const box = { yCenter: cursor + s.h / 2, ...s };
    cursor += s.h;
    return box;
  });
  return (
    <>
      {boxes.map((b, i) => {
        const pl = projectLeft ? b.p : 0;
        const pr = projectRight ? b.p : 0;
        return (
          <mesh
            key={i}
            position={[
              (x0 - pl + x1 + pr) / 2,
              b.yCenter,
              (-WALL_THICKNESS + b.p) / 2,
            ]}
            castShadow
          >
            <boxGeometry args={[x1 - x0 + pl + pr, b.h, WALL_THICKNESS + b.p]} />
            <Trim color={trimColor} />
          </mesh>
        );
      })}
    </>
  );
}

export default function FacadeMesh({
  params,
  miter,
}: {
  params: FacadeParams;
  miter?: LotMiter;
}) {
  const ml = miter?.left ?? 0;
  const mr = miter?.right ?? 0;
  const layout = useMemo(() => computeLayout(params), [params]);
  const stripGeos = useMemo(
    () =>
      layout.sections.map((strip, i) =>
        buildStripGeometry(
          layout,
          strip,
          i === 0 ? ml : 0,
          i === layout.sections.length - 1 ? mr : 0,
        ),
      ),
    [layout, ml, mr],
  );
  // R3F does NOT auto-dispose geometry passed via the `geometry` prop —
  // without this, every slider tick leaks GPU buffers.
  useEffect(() => () => stripGeos.forEach((g) => g.dispose()), [stripGeos]);
  const roofGeo = useMemo(
    () => (layout.roof ? buildRoofGeometry(layout.roof) : null),
    [layout.roof],
  );
  useEffect(() => () => roofGeo?.dispose(), [roofGeo]);

  // Everything renders per section strip inside a group carrying the strip's
  // perpendicular relief offset — openings, sills, surrounds, cornice,
  // parapet, and the stoop all step with their strip.
  return (
    <group>
      {layout.sections.map((strip, si) => {
        const first = si === 0;
        const last = si === layout.sections.length - 1;
        // Ornament band x-extents: strip edges plus corner miter extensions
        // at the outer facade ends only.
        const bandX0 = strip.x0 - (first ? ml : 0);
        const bandX1 = strip.x1 + (last ? mr : 0);
        const copingL = first ? 0.05 : 0;
        const copingR = last ? 0.05 : 0;
        return (
          <group key={si} position={[0, 0, strip.offset]}>
            {/* Massing: the building body behind this section's wall. Front
             * flush with the wall back (−WALL_THICKNESS), extending back by
             * the clamped depth; wall-colored so the building reads solid. A
             * pass-through passage within this strip pierces it (piers +
             * lintel + tunnel). The strip group's offset applies the relief. */}
            <StripMass
              x0={bandX0}
              x1={bandX1}
              wallTop={layout.wallTop}
              massingDepth={layout.massingDepth}
              color={params.wallColor}
              passage={
                layout.passage &&
                layout.passage.x0 >= bandX0 - 1e-6 &&
                layout.passage.x1 <= bandX1 + 1e-6
                  ? layout.passage
                  : null
              }
            />
            <mesh geometry={stripGeos[si]} castShadow receiveShadow>
              <meshStandardMaterial color={params.wallColor} roughness={0.85} />
            </mesh>

            {layout.openings
              .filter((o) => inStrip(o.bay, strip))
              .map((o) => {
                const key = `${o.storey}-${o.bay}`;
                switch (o.kind) {
                  case "window":
                    return (
                      <WindowFill
                        key={key}
                        o={o}
                        trimColor={params.trimColor}
                        windowStyle={params.windowStyle}
                      />
                    );
                  case "door":
                    return (
                      <DoorFill
                        key={key}
                        o={o}
                        doorColor={params.doorColor}
                        trimColor={params.trimColor}
                        windowStyle={params.windowStyle}
                      />
                    );
                  case "shopfront":
                    return (
                      <ShopfrontFill
                        key={key}
                        o={o}
                        trimColor={params.trimColor}
                        awning={params.groundFloor.awning}
                      />
                    );
                  case "garage":
                    return <GarageFill key={key} o={o} doorColor={params.doorColor} />;
                  case "passage":
                    return (
                      <PassageFill key={key} o={o} trimColor={params.trimColor} />
                    );
                  default:
                    return null;
                }
              })}

            {/* sills: proud boxes under windows */}
            {layout.sills
              .filter((s) => inStrip(s.bay, strip))
              .map((s, i) => (
                <mesh key={i} position={[s.x + s.w / 2, s.y + 0.04, 0]} castShadow>
                  <boxGeometry args={[s.w, 0.08, 0.2]} />
                  <Trim color={params.trimColor} />
                </mesh>
              ))}

            {/* surrounds: top + side trim around windows (sill covers the bottom) */}
            {layout.surrounds
              .filter((o) => inStrip(o.bay, strip))
              .map((o, i) => (
                <group key={i}>
                  <mesh position={[o.x + o.w / 2, o.y + o.h + 0.07, 0]} castShadow>
                    <boxGeometry args={[o.w + 0.28, 0.14, 0.1]} />
                    <Trim color={params.trimColor} />
                  </mesh>
                  <mesh position={[o.x - 0.07, o.y + o.h / 2, 0]}>
                    <boxGeometry args={[0.14, o.h, 0.1]} />
                    <Trim color={params.trimColor} />
                  </mesh>
                  <mesh position={[o.x + o.w + 0.07, o.y + o.h / 2, 0]}>
                    <boxGeometry args={[0.14, o.h, 0.1]} />
                    <Trim color={params.trimColor} />
                  </mesh>
                </group>
              ))}

            <CorniceSegment
              layout={layout}
              trimColor={params.trimColor}
              x0={bandX0}
              x1={bandX1}
              projectLeft={first}
              projectRight={last}
            />

            {/* parapet: wall-colored extension + thin trim coping */}
            {layout.parapet && (
              <group>
                <mesh
                  position={[
                    (bandX0 + bandX1) / 2,
                    layout.parapet.y + layout.parapet.height / 2,
                    -WALL_THICKNESS / 2,
                  ]}
                  castShadow
                >
                  <boxGeometry
                    args={[bandX1 - bandX0, layout.parapet.height, WALL_THICKNESS]}
                  />
                  <meshStandardMaterial color={params.wallColor} roughness={0.85} />
                </mesh>
                <mesh
                  position={[
                    (bandX0 - copingL + bandX1 + copingR) / 2,
                    layout.parapet.y + layout.parapet.height + 0.04,
                    -WALL_THICKNESS / 2,
                  ]}
                  castShadow
                >
                  <boxGeometry
                    args={[
                      bandX1 - bandX0 + copingL + copingR,
                      0.08,
                      WALL_THICKNESS + 0.1,
                    ]}
                  />
                  <Trim color={params.trimColor} />
                </mesh>
              </group>
            )}

            {/* stoop: stacked overlapping blocks reading as steps */}
            {layout.stoop &&
              inStrip(layout.stoop.bay, strip) &&
              Array.from({ length: layout.stoop.steps }, (_, i) => {
                const st = layout.stoop!;
                const h = st.rise * (i + 1);
                const d = st.run * (st.steps - i);
                return (
                  <mesh
                    key={i}
                    position={[st.x + st.w / 2, h / 2, d / 2]}
                    castShadow
                    receiveShadow
                  >
                    <boxGeometry args={[st.w, h, d]} />
                    <meshStandardMaterial color="#9a938a" roughness={0.9} />
                  </mesh>
                );
              })}
          </group>
        );
      })}

      {/* Roof — one mesh per lot, spanning all sections, capping the mass.
       * Lot-local coords, so it sits in the outer group (not a strip group). */}
      {roofGeo && (
        <mesh geometry={roofGeo} castShadow receiveShadow>
          <meshStandardMaterial
            color={ROOF_COLORS[params.roofColor ?? "slate"]}
            roughness={0.8}
          />
        </mesh>
      )}

      {/* Dormers on the front roof slope (empty unless requested). */}
      {layout.roofDormers.map((d, i) => (
        <DormerMesh
          key={i}
          d={d}
          wallColor={params.wallColor}
          trimColor={params.trimColor}
          roofColor={ROOF_COLORS[params.roofColor ?? "slate"]}
        />
      ))}

      {/* Shaped front gable rising above the eave (null unless chosen). */}
      {layout.gable && (
        <GableMesh
          gable={layout.gable}
          wallColor={params.wallColor}
          trimColor={params.trimColor}
        />
      )}
    </group>
  );
}
