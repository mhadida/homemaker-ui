import { describe, it, expect, afterEach, vi } from "vitest";
import { PNG } from "pngjs";
import { parseTerrainRequest, OpenTerrainProvider } from "./terrainProvider";

describe("parseTerrainRequest", () => {
  const good = {
    bbox: { west: 4.9, south: 52.36, east: 4.92, north: 52.38 },
    anchor: { lat0: 52.37, lon0: 4.91 },
  };
  it("accepts a well-formed body", () => {
    expect(parseTerrainRequest(good)).toEqual(good);
  });
  it("rejects a missing bbox", () => {
    expect(parseTerrainRequest({ anchor: good.anchor })).toBeNull();
  });
  it("rejects non-finite coordinates", () => {
    expect(
      parseTerrainRequest({ ...good, bbox: { ...good.bbox, west: NaN } }),
    ).toBeNull();
  });
  it("rejects a non-object", () => {
    expect(parseTerrainRequest("nope")).toBeNull();
    expect(parseTerrainRequest(null)).toBeNull();
  });
  it("rejects an inverted bbox (west > east)", () => {
    expect(
      parseTerrainRequest({
        ...good,
        bbox: { ...good.bbox, west: good.bbox.east, east: good.bbox.west },
      }),
    ).toBeNull();
  });
  it("rejects an inverted bbox (south > north)", () => {
    expect(
      parseTerrainRequest({
        ...good,
        bbox: { ...good.bbox, south: good.bbox.north, north: good.bbox.south },
      }),
    ).toBeNull();
  });
  it("rejects an oversized-span bbox (5°×5°)", () => {
    expect(
      parseTerrainRequest({
        bbox: { west: 4.9, south: 52.36, east: 9.9, north: 57.36 },
        anchor: good.anchor,
      }),
    ).toBeNull();
  });
  it("accepts a normal city bbox (~0.02° span)", () => {
    // Same shape as `good` — pinned down explicitly so this test keeps
    // failing on its own if a future span/order guard gets too strict.
    expect(good.bbox.east - good.bbox.west).toBeCloseTo(0.02, 6);
    expect(parseTerrainRequest(good)).toEqual(good);
  });
});

/** Encode a uniform size×size terrarium PNG at the given elevation (metres),
 * to hand back from a mocked `fetch` — real bytes through the real decoder,
 * with no network involved. */
function uniformTerrariumPng(size: number, metres: number): ArrayBuffer {
  // terrariumToMetres(r,g,b) = r*256 + g + b/256 - 32768; pick r=128 (the
  // 32768 offset) so metres in [0, 256) map directly onto g with b = 0.
  const r = 128;
  const g = Math.floor(metres);
  const b = Math.round((metres - g) * 256);
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }
  const png = PNG.sync.write({ width: size, height: size, data } as unknown as PNG);
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
}

describe("OpenTerrainProvider (mocked tile source)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const bbox = { west: 4.9, south: 52.36, east: 4.92, north: 52.38 };
  const anchor = { lat0: 52.37, lon0: 4.91 };

  it("fetches, decodes, and resamples every covering tile into a Heightfield", async () => {
    // Every tile requested (regardless of z/x/y) is served the SAME uniform
    // 100 m PNG, so the resampled grid must read exactly 100 m everywhere —
    // this exercises tilesForBBox → fetch → PNG decode → elevAtFromTiles →
    // resampleToGrid end-to-end without depending on which tiles got picked.
    const pngBuffer = uniformTerrariumPng(2, 100);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => pngBuffer,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const hf = await new OpenTerrainProvider().fetchHeightfield(bbox, anchor);

    expect(fetchMock).toHaveBeenCalled();
    expect(hf.cols).toBeGreaterThanOrEqual(2);
    expect(hf.rows).toBeGreaterThanOrEqual(2);
    expect(Math.max(hf.cols, hf.rows)).toBeLessThanOrEqual(128);
    expect(hf.data.length).toBe(hf.cols * hf.rows);
    for (const h of hf.data) expect(h).toBeCloseTo(100, 6);
  });

  it("propagates a tile HTTP failure as a rejected promise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );

    await expect(
      new OpenTerrainProvider().fetchHeightfield(bbox, anchor),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("rejects an over-cap bbox via tilesForBBox's tile-count guard before fetching anything", async () => {
    // Belt-and-suspenders: even though parseTerrainRequest's MAX_SPAN_DEG
    // check is the primary guard, fetchHeightfield must never reach `fetch`
    // for a bbox whose tile count exceeds MAX_TILES.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const huge = { west: -179.9, south: -85, east: 179.9, north: 85 };

    await expect(
      new OpenTerrainProvider().fetchHeightfield(huge, anchor),
    ).rejects.toThrow(/tiles/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
