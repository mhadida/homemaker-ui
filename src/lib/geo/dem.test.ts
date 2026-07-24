import { describe, it, expect } from "vitest";
import {
  terrariumToMetres,
  lonLatToTile,
  tilesForBBox,
  elevAtFromTiles,
  resampleToGrid,
  type DecodedTile,
} from "./dem";
import { anchorOf } from "./project";

describe("terrariumToMetres", () => {
  it("decodes the RGB elevation encoding", () => {
    expect(terrariumToMetres(128, 0, 0)).toBe(0); // sea level
    expect(terrariumToMetres(129, 0, 0)).toBe(256);
    expect(terrariumToMetres(128, 0, 128)).toBeCloseTo(0.5, 9);
  });
});

describe("lonLatToTile / tilesForBBox", () => {
  it("puts (0,0) at the centre tile boundary at z1", () => {
    const { x, y } = lonLatToTile(0, 0, 1);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(1, 6);
  });
  it("covers a small bbox with at least one tile", () => {
    const tiles = tilesForBBox({ west: 4.9, south: 52.36, east: 4.91, north: 52.37 }, 13);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.every((t) => t.z === 13)).toBe(true);
  });
});

describe("elevAtFromTiles", () => {
  it("bilinearly samples a single tile", () => {
    // one z13 tile covering Amsterdam, 2×2 ramp rising west→east
    const { x, y } = lonLatToTile(4.9, 52.37, 13);
    const tile: DecodedTile = {
      z: 13,
      x: Math.floor(x),
      y: Math.floor(y),
      size: 2,
      heights: [0, 10, 0, 10], // left col 0, right col 10
    };
    // sampling the tile's own west edge ≈ 0, east edge ≈ 10
    const west = elevAtFromTiles([tile], 4.9, 52.37);
    expect(west).toBeGreaterThanOrEqual(0);
    expect(west).toBeLessThan(10);
  });
});

describe("resampleToGrid", () => {
  const bbox = { west: 4.9, south: 52.36, east: 4.92, north: 52.38 };
  const anchor = anchorOf(bbox);

  it("returns a bounded grid with metadata", () => {
    const hf = resampleToGrid(bbox, anchor, () => 7, 128);
    expect(hf.cols).toBeGreaterThanOrEqual(2);
    expect(hf.rows).toBeGreaterThanOrEqual(2);
    expect(Math.max(hf.cols, hf.rows)).toBeLessThanOrEqual(128);
    expect(hf.data.length).toBe(hf.cols * hf.rows);
    expect(hf.data.every((h) => h === 7)).toBe(true); // constant sampler
    expect(hf.spacing).toBeGreaterThan(0);
  });

  it("samples the elevation function across the grid", () => {
    const hf = resampleToGrid(bbox, anchor, (lon) => lon * 1000, 32);
    expect(hf.data[0]).not.toBe(hf.data[hf.cols - 1]); // varies along +x (lon)
  });
});
