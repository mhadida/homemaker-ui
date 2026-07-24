import { PNG } from "pngjs";
import type { GeoAnchor, LngLatBBox } from "./project";
import type { Heightfield } from "@/lib/facade/terrain";
import {
  tilesForBBox,
  terrariumToMetres,
  elevAtFromTiles,
  resampleToGrid,
  type DecodedTile,
} from "./dem";

/** Source-agnostic terrain lookup: the route is the only caller, and the
 * open AWS Terrain Tiles source below (Esri implements this same interface
 * later) is the only thing that knows where the DEM data comes from. */
export interface TerrainProvider {
  fetchHeightfield(bbox: LngLatBBox, anchor: GeoAnchor): Promise<Heightfield>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validate an untrusted request body. Exported so the route and its test share
 * one definition. */
export function parseTerrainRequest(
  body: unknown,
): { bbox: LngLatBBox; anchor: GeoAnchor } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = (body as { bbox?: unknown }).bbox as Partial<LngLatBBox> | undefined;
  const a = (body as { anchor?: unknown }).anchor as Partial<GeoAnchor> | undefined;
  if (!b || !a) return null;
  if (!isNum(b.west) || !isNum(b.south) || !isNum(b.east) || !isNum(b.north)) return null;
  if (!isNum(a.lat0) || !isNum(a.lon0)) return null;
  return {
    bbox: { west: b.west, south: b.south, east: b.east, north: b.north },
    anchor: { lat0: a.lat0, lon0: a.lon0 },
  };
}

// ≈19 m/px at the equator (Web Mercator resolution is finer at higher
// latitudes, so a mid-latitude city gets more detail, not less) — a few
// tiles cover a city bbox.
const ZOOM = 13;
const TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

async function decodeTile(z: number, x: number, y: number): Promise<DecodedTile> {
  const res = await fetch(TILE_URL(z, x, y));
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const png = PNG.sync.read(buf);
  const size = png.width; // terrarium tiles are square (256)
  // pngjs's decoder always normalises pixels to 4 bytes/px (RGBA) — see
  // node_modules/pngjs/lib/bitmapper.js's dataToBitMap, which allocates
  // width*height*4 and fills a 0xff alpha for every non-alpha colour type —
  // so the o = i*4 stride below is correct even though terrarium tiles are
  // stored as 24-bit RGB with no alpha channel.
  const heights: number[] = new Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4; // RGBA
    heights[i] = terrariumToMetres(png.data[o], png.data[o + 1], png.data[o + 2]);
  }
  return { z, x, y, size, heights };
}

export class OpenTerrainProvider implements TerrainProvider {
  async fetchHeightfield(bbox: LngLatBBox, anchor: GeoAnchor): Promise<Heightfield> {
    const coords = tilesForBBox(bbox, ZOOM);
    const tiles = await Promise.all(coords.map((t) => decodeTile(t.z, t.x, t.y)));
    return resampleToGrid(bbox, anchor, (lon, lat) => elevAtFromTiles(tiles, lon, lat));
  }
}
