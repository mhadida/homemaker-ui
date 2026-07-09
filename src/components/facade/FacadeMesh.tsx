"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  computeLayout,
  WALL_THICKNESS,
  SHOPFRONT_FASCIA,
  type FacadeLayout,
  type OpeningRect,
} from "@/lib/facade/layout";
import type { FacadeParams, WindowStyleId } from "@/lib/facade/types";

const FRAME_T = 0.07; // window frame member thickness
const FRAME_D = 0.06; // frame depth
const GLASS_RECESS = 0.15; // how far frames/glass sit behind the wall face
const GLAZING_BAR = 0.04; // thin internal glazing-bar thickness

/** Wall body: outer rect with punched opening holes, extruded to thickness.
 * ExtrudeGeometry runs +z from the shape plane, so we shift it back so the
 * front face lands at z=0 (the facade plane). */
function buildWallGeometry(layout: FacadeLayout): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-layout.width / 2, 0);
  shape.lineTo(layout.width / 2, 0);
  shape.lineTo(layout.width / 2, layout.wallTop);
  shape.lineTo(-layout.width / 2, layout.wallTop);
  shape.closePath();
  for (const o of layout.openings) {
    const hole = new THREE.Path();
    hole.moveTo(o.x, o.y);
    hole.lineTo(o.x + o.w, o.y);
    hole.lineTo(o.x + o.w, o.y + o.h);
    hole.lineTo(o.x, o.y + o.h);
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

function ShopfrontFill({ o, trimColor }: { o: OpeningRect; trimColor: string }) {
  return (
    <group position={[o.x + o.w / 2, o.y + o.h / 2, -0.1]}>
      <Glass w={o.w} h={o.h} />
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

/** Stepped classical cornice: three stacked boxes with growing projection. */
function Cornice({ layout, trimColor }: { layout: FacadeLayout; trimColor: string }) {
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
      {boxes.map((b, i) => (
        <mesh
          key={i}
          position={[0, b.yCenter, (-WALL_THICKNESS + b.p) / 2]}
          castShadow
        >
          <boxGeometry args={[layout.width + b.p * 2, b.h, WALL_THICKNESS + b.p]} />
          <Trim color={trimColor} />
        </mesh>
      ))}
    </>
  );
}

export default function FacadeMesh({ params }: { params: FacadeParams }) {
  const layout = useMemo(() => computeLayout(params), [params]);
  const wallGeo = useMemo(() => buildWallGeometry(layout), [layout]);
  // R3F does NOT auto-dispose geometry passed via the `geometry` prop —
  // without this, every slider tick leaks a GPU buffer.
  useEffect(() => () => wallGeo.dispose(), [wallGeo]);

  return (
    <group>
      <mesh geometry={wallGeo} castShadow receiveShadow>
        <meshStandardMaterial color={params.wallColor} roughness={0.85} />
      </mesh>

      {layout.openings.map((o) => {
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
            return <ShopfrontFill key={key} o={o} trimColor={params.trimColor} />;
          case "garage":
            return <GarageFill key={key} o={o} doorColor={params.doorColor} />;
          default:
            return null;
        }
      })}

      {/* sills: proud boxes under windows */}
      {layout.sills.map((s, i) => (
        <mesh key={i} position={[s.x + s.w / 2, s.y + 0.04, 0]} castShadow>
          <boxGeometry args={[s.w, 0.08, 0.2]} />
          <Trim color={params.trimColor} />
        </mesh>
      ))}

      {/* surrounds: top + side trim around windows (sill covers the bottom) */}
      {layout.surrounds.map((o, i) => (
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

      <Cornice layout={layout} trimColor={params.trimColor} />

      {/* parapet: wall-colored extension + thin trim coping */}
      {layout.parapet && (
        <group>
          <mesh
            position={[0, layout.parapet.y + layout.parapet.height / 2, -WALL_THICKNESS / 2]}
            castShadow
          >
            <boxGeometry args={[layout.width, layout.parapet.height, WALL_THICKNESS]} />
            <meshStandardMaterial color={params.wallColor} roughness={0.85} />
          </mesh>
          <mesh
            position={[0, layout.parapet.y + layout.parapet.height + 0.04, -WALL_THICKNESS / 2]}
            castShadow
          >
            <boxGeometry args={[layout.width + 0.1, 0.08, WALL_THICKNESS + 0.1]} />
            <Trim color={params.trimColor} />
          </mesh>
        </group>
      )}

      {/* stoop: stacked overlapping blocks reading as steps */}
      {layout.stoop &&
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
}
