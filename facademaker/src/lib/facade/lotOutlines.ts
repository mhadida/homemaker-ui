import * as THREE from "three";
import {
  cadastralBoundaryRings,
  type CadastralParcel,
} from "../geo/cadastralParcels";
import { blockFrame, type FacadeBlock } from "./blocks";
import { MASSING_DEPTH_DEFAULT } from "./layout";
import { groundHeightAt, type Ground } from "./terrain";

type Vec2 = [number, number];

/** Long edges need intermediate samples or they cut through a heightfield
 * ridge/valley instead of reading as lines painted onto the terrain. */
const MAX_DRAPE_SEGMENT = 4;
const OUTLINE_LIFT = 0.1;

function pointKey([x, z]: Vec2): string {
  return `${Math.round(x * 10_000)}:${Math.round(z * 10_000)}`;
}

function edgeKey(a: Vec2, b: Vec2): string {
  const ka = pointKey(a);
  const kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** Build one merged line-segment geometry for editable lots and imported BRK
 * cadastral parcels. A single geometry keeps a dense city scene at one draw
 * call per pane instead of mounting thousands of React/Three objects.
 *
 * Editable Facademaker lots use their actual width/depth geometry. Imported
 * parcel geometry comes directly from Kadaster's BRK Kadastrale Kaart; it is
 * cadastral reference geometry, not a building-footprint approximation.
 */
export function buildLotOutlineGeometry(
  blocks: FacadeBlock[],
  cadastralParcels: CadastralParcel[],
  ground: Ground,
): THREE.BufferGeometry {
  const edges = new Map<string, [Vec2, Vec2]>();
  const addEdge = (a: Vec2, b: Vec2) => {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return;
    const key = edgeKey(a, b);
    if (!edges.has(key)) edges.set(key, [a, b]);
  };
  const addLoop = (loop: Vec2[]) => {
    if (loop.length < 3) return;
    for (let i = 0; i < loop.length; i++) {
      addEdge(loop[i], loop[(i + 1) % loop.length]);
    }
  };

  for (const block of blocks) {
    const { origin, dir, normal } = blockFrame(block);
    let along = 0;
    for (const lot of block.lots) {
      const width = lot.params.width;
      const depth = lot.params.massingDepth ?? MASSING_DEPTH_DEFAULT;
      const offset = lot.depthOffset ?? 0;
      const frontA: Vec2 = [
        origin[0] + dir[0] * along + normal[0] * offset,
        origin[1] + dir[1] * along + normal[1] * offset,
      ];
      const frontB: Vec2 = [
        origin[0] + dir[0] * (along + width) + normal[0] * offset,
        origin[1] + dir[1] * (along + width) + normal[1] * offset,
      ];
      const rearB: Vec2 = [
        frontB[0] - normal[0] * depth,
        frontB[1] - normal[1] * depth,
      ];
      const rearA: Vec2 = [
        frontA[0] - normal[0] * depth,
        frontA[1] - normal[1] * depth,
      ];
      addLoop([frontA, frontB, rearB, rearA]);
      along += width;
    }
  }

  for (const ring of cadastralBoundaryRings(cadastralParcels)) addLoop(ring);

  const positions: number[] = [];
  for (const [a, b] of edges.values()) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(length / MAX_DRAPE_SEGMENT));
    for (let i = 0; i < steps; i++) {
      for (const t of [i / steps, (i + 1) / steps]) {
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        positions.push(x, groundHeightAt(x, z, ground) + OUTLINE_LIFT, z);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  return geometry;
}
