import type { GeoAnchor, LngLatBBox } from "./project";
import { project, unproject } from "./project";
import type { Heightfield } from "@/lib/facade/terrain";

/** Terrarium PNG RGB → metres. */
export function terrariumToMetres(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** lon/lat → fractional web-mercator tile coords at zoom z. */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Every integer tile covering the bbox at zoom z. */
export function tilesForBBox(b: LngLatBBox, z: number): { z: number; x: number; y: number }[] {
  const tl = lonLatToTile(b.west, b.north, z); // north = smaller tile-y
  const br = lonLatToTile(b.east, b.south, z);
  const x0 = Math.floor(tl.x);
  const x1 = Math.floor(br.x);
  const y0 = Math.floor(tl.y);
  const y1 = Math.floor(br.y);
  const out: { z: number; x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y });
  return out;
}

export interface DecodedTile {
  z: number;
  x: number;
  y: number;
  size: number;
  /** size×size row-major heights (m) */
  heights: number[];
}

/** Bilinear elevation at lon/lat from decoded tiles (nearest tile if the exact
 * one is missing). */
export function elevAtFromTiles(tiles: DecodedTile[], lon: number, lat: number): number {
  if (tiles.length === 0) return 0;
  const z = tiles[0].z;
  const g = lonLatToTile(lon, lat, z);
  const tx = Math.floor(g.x);
  const ty = Math.floor(g.y);
  const tile = tiles.find((t) => t.x === tx && t.y === ty) ?? tiles[0];
  const size = tile.size;
  const fx = (g.x - tx) * (size - 1);
  const fy = (g.y - ty) * (size - 1);
  const clamp = (v: number) => Math.max(0, Math.min(size - 1, v));
  const cx = clamp(fx);
  const cy = clamp(fy);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, size - 1);
  const y1 = Math.min(y0 + 1, size - 1);
  const sx = cx - x0;
  const sy = cy - y0;
  const h = (ix: number, iy: number) => tile.heights[iy * size + ix];
  const top = h(x0, y0) * (1 - sx) + h(x1, y0) * sx;
  const bot = h(x0, y1) * (1 - sx) + h(x1, y1) * sx;
  return top * (1 - sy) + bot * sy;
}

/** Build a local-frame Heightfield by sampling `elevAt(lon,lat)` on a square
 * grid spanning the bbox. Grid step chosen so max(cols,rows) ≤ maxDim. */
export function resampleToGrid(
  bbox: LngLatBBox,
  anchor: GeoAnchor,
  elevAt: (lon: number, lat: number) => number,
  maxDim = 128,
): Heightfield {
  const [xW, zS] = project(bbox.south, bbox.west, anchor);
  const [xE, zN] = project(bbox.north, bbox.east, anchor);
  const width = xE - xW;
  const height = zN - zS;
  const spacing = Math.max(width, height) / (maxDim - 1);
  let cols = Math.max(2, Math.ceil(width / spacing) + 1);
  let rows = Math.max(2, Math.ceil(height / spacing) + 1);
  // Clamp to ensure max(cols, rows) <= maxDim (avoids floating-point precision overflow)
  cols = Math.min(cols, maxDim);
  rows = Math.min(rows, maxDim);
  const data: number[] = new Array(cols * rows);
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const [lat, lon] = unproject(xW + ix * spacing, zS + iz * spacing, anchor);
      data[iz * cols + ix] = elevAt(lon, lat);
    }
  }
  return { originX: xW, originZ: zS, spacing, cols, rows, data };
}
