import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseBuildingsRequest,
  OsmBuildingProvider,
  MAX_BUILDING_SPAN_DEG,
} from "./buildingProvider";

const anchor = { lat0: 52.37, lon0: 4.89 };
const good = { bbox: { west: 4.88, south: 52.36, east: 4.90, north: 52.38 }, anchor };

describe("parseBuildingsRequest", () => {
  it("accepts a normal city bbox", () => {
    expect(parseBuildingsRequest(good)).toEqual(good);
  });
  it("rejects a non-object or missing parts as malformed", () => {
    expect(parseBuildingsRequest("nope")).toEqual({ error: "malformed" });
    expect(parseBuildingsRequest(null)).toEqual({ error: "malformed" });
    expect(parseBuildingsRequest({ anchor })).toEqual({ error: "malformed" });
    expect(parseBuildingsRequest({ bbox: good.bbox })).toEqual({ error: "malformed" });
  });
  it("rejects non-finite coordinates as malformed", () => {
    expect(parseBuildingsRequest({ ...good, bbox: { ...good.bbox, west: NaN } })).toEqual({
      error: "malformed",
    });
  });
  it("rejects an inverted or zero-area bbox as malformed", () => {
    expect(
      parseBuildingsRequest({ ...good, bbox: { west: 5, south: 52.36, east: 4, north: 52.38 } }),
    ).toEqual({ error: "malformed" });
    expect(
      parseBuildingsRequest({ ...good, bbox: { west: 4.9, south: 52.36, east: 4.9, north: 52.38 } }),
    ).toEqual({ error: "malformed" });
  });
  it("rejects a span wider than MAX_BUILDING_SPAN_DEG as 'span', distinct from malformed", () => {
    const wide = { west: 4, south: 52, east: 4 + MAX_BUILDING_SPAN_DEG + 0.01, north: 52.01 };
    expect(parseBuildingsRequest({ ...good, bbox: wide })).toEqual({ error: "span" });
  });
  it("rejects a north-south span wider than MAX_BUILDING_SPAN_DEG as 'span'", () => {
    const tall = { west: 4.88, south: 52, east: 4.90, north: 52 + MAX_BUILDING_SPAN_DEG + 0.01 };
    expect(parseBuildingsRequest({ ...good, bbox: tall })).toEqual({ error: "span" });
  });
});

describe("OsmBuildingProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("queries Overpass and maps the response into local-frame buildings", async () => {
    const body = {
      elements: [
        {
          type: "way",
          id: 42,
          tags: { building: "yes", "building:levels": "3" },
          geometry: [
            { lat: 52.37, lon: 4.89 },
            { lat: 52.37, lon: 4.8901 },
            { lat: 52.3701, lon: 4.8901 },
            { lat: 52.37, lon: 4.89 },
          ],
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const r = await new OsmBuildingProvider().fetchBuildings(good.bbox, anchor);
    expect(fetchMock).toHaveBeenCalledOnce();
    // the query must be a ways-only building query over the bbox
    const [, init] = fetchMock.mock.calls[0];
    expect(String(init.body)).toContain(encodeURIComponent('way["building"]'));
    // ensure bbox coordinates appear in Overpass order (south,west,north,east)
    const { bbox } = good;
    expect(String(init.body)).toContain(
      encodeURIComponent(`(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`),
    );
    // Overpass 406s any request without an identifying User-Agent (verified
    // against the live API) — guard against that regression here since the
    // mocked fetch below can't catch it.
    const headers = init.headers as Record<string, string>;
    const userAgent = headers["user-agent"] ?? headers["User-Agent"];
    expect(userAgent).toBeTruthy();
    expect(r.buildings).toHaveLength(1);
    expect(r.buildings[0].id).toBe("way/42");
    expect(r.buildings[0].height).toBe(9); // 3 levels x 3 m
    expect(r.truncated).toBe(false);
    expect(r.total).toBe(1);
  });

  it("throws a clear error when Overpass rate-limits", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));
    await expect(new OsmBuildingProvider().fetchBuildings(good.bbox, anchor)).rejects.toThrow(/429/);
  });

  it("bounds the Overpass fetch with an AbortSignal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await new OsmBuildingProvider().fetchBuildings(good.bbox, anchor);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("surfaces a clear, actionable error when the Overpass fetch times out", async () => {
    const timeoutError = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError));
    await expect(
      new OsmBuildingProvider().fetchBuildings(good.bbox, anchor),
    ).rejects.toThrow(/timed out/);
  });

  it("rethrows a non-timeout fetch failure unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(
      new OsmBuildingProvider().fetchBuildings(good.bbox, anchor),
    ).rejects.toThrow(/network down/);
  });

  it("returns an empty result when the source has no elements", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    const r = await new OsmBuildingProvider().fetchBuildings(good.bbox, anchor);
    expect(r.buildings).toEqual([]);
    expect(r.total).toBe(0);
  });
});
