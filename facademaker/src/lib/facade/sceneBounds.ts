import type { ContextBuilding } from "@/lib/geo/buildings";
import type { StreetNetwork } from "@/lib/street/types";
import type { FacadeBlock } from "./blocks";
import { computeLayout } from "./layout";
import type { Ground } from "./terrain";

export interface SceneBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  height: number;
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  hasContent: boolean;
}

export interface SceneBoundsInput {
  blocks: readonly FacadeBlock[];
  streetNetwork: StreetNetwork;
  contextBuildings: readonly ContextBuilding[];
  ground: Ground;
  padding?: number;
}

const MIN_SPAN = 30;
const DEFAULT_HEIGHT = 12;

/** One world envelope for every camera. It deliberately includes imported
 * terrain, streets and context footprints as peers of editable facade blocks,
 * so a context-only scene is a real scene rather than a 30 m origin fallback. */
export function deriveSceneBounds({
  blocks,
  streetNetwork,
  contextBuildings,
  ground,
  padding = 20,
}: SceneBoundsInput): SceneBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = 0;
  let maxY = DEFAULT_HEIGHT;
  let hasContent = false;

  const includePoint = (x: number, z: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    hasContent = true;
  };

  for (const block of blocks) {
    includePoint(block.line.a[0], block.line.a[1]);
    includePoint(block.line.b[0], block.line.b[1]);
    for (const lot of block.lots) {
      maxY = Math.max(maxY, computeLayout(lot.params).totalHeight);
    }
  }

  for (const street of streetNetwork.streets) {
    for (const [x, z] of street.points) includePoint(x, z);
  }

  let tallestContext = 0;
  for (const building of contextBuildings) {
    tallestContext = Math.max(tallestContext, building.height);
    for (const [x, z] of building.footprint) includePoint(x, z);
  }

  const hf = ground.hf;
  if (hf) {
    includePoint(hf.originX, hf.originZ);
    includePoint(
      hf.originX + hf.spacing * (hf.cols - 1),
      hf.originZ + hf.spacing * (hf.rows - 1),
    );
    if (hf.data.length > 0) {
      let terrainMin = Infinity;
      let terrainMax = -Infinity;
      for (const y of hf.data) {
        if (!Number.isFinite(y)) continue;
        terrainMin = Math.min(terrainMin, y);
        terrainMax = Math.max(terrainMax, y);
      }
      if (Number.isFinite(terrainMin)) minY = Math.min(minY, terrainMin);
      if (Number.isFinite(terrainMax)) {
        maxY = Math.max(maxY, terrainMax + tallestContext);
      }
    }
  } else {
    maxY = Math.max(maxY, tallestContext);
  }

  if (!hasContent) {
    minX = -MIN_SPAN / 2;
    maxX = MIN_SPAN / 2;
    minZ = -MIN_SPAN / 2;
    maxZ = MIN_SPAN / 2;
  } else {
    minX -= padding;
    maxX += padding;
    minZ -= padding;
    maxZ += padding;
  }

  const expandToMinimum = (min: number, max: number): [number, number] => {
    const span = max - min;
    if (span >= MIN_SPAN) return [min, max];
    const centre = (min + max) / 2;
    return [centre - MIN_SPAN / 2, centre + MIN_SPAN / 2];
  };

  [minX, maxX] = expandToMinimum(minX, maxX);
  [minZ, maxZ] = expandToMinimum(minZ, maxZ);

  const width = maxX - minX;
  const depth = maxZ - minZ;
  const height = Math.max(maxY - minY, DEFAULT_HEIGHT);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    width,
    depth,
    height,
    cx,
    cy,
    cz,
    radius: Math.hypot(width, depth, height) / 2,
    hasContent,
  };
}

export interface PerspectiveFit {
  target: [number, number, number];
  position: [number, number, number];
  distance: number;
  far: number;
  maxDistance: number;
}

/** Oblique overview pose that contains the whole scene in the vertical FOV.
 * The diagonal direction preserves plan readability without looking straight
 * down, and the derived far/max distances prevent the first interaction from
 * snapping a large imported city back inside the old 600 m orbit cap. */
export function perspectiveFitFor(
  bounds: SceneBounds,
  fovDegrees = 40,
): PerspectiveFit {
  const halfFov = (fovDegrees * Math.PI) / 360;
  const distance = Math.max(
    18,
    (bounds.radius / Math.max(Math.sin(halfFov), 0.1)) * 1.12,
  );
  const direction = [1, 0.72, 1] as const;
  const directionLength = Math.hypot(...direction);
  const unit = direction.map((v) => v / directionLength) as [
    number,
    number,
    number,
  ];
  const target: [number, number, number] = [bounds.cx, bounds.cy, bounds.cz];
  const position: [number, number, number] = [
    target[0] + unit[0] * distance,
    target[1] + unit[1] * distance,
    target[2] + unit[2] * distance,
  ];

  return {
    target,
    position,
    distance,
    maxDistance: Math.max(600, distance * 1.5),
    far: Math.max(4000, distance + bounds.radius * 2 + 500),
  };
}
