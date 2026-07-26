import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  parseStreetsRequest,
  OsmStreetProvider,
  __resetStreetCacheForTests,
} from "./streetProvider";
import { MAX_BUILDING_SPAN_DEG } from "./buildingProvider";

const anchor = { lat0: 52.37, lon0: 4.89 };
const good = { bbox: { west: 4.88, south: 52.36, east: 4.9, north: 52.38 }, anchor };

beforeEach(() => __resetStreetCacheForTests());
afterEach(() => vi.unstubAllGlobals());

describe("parseStreetsRequest", () => {
  it("accepts a normal city bbox", () => {
    expect(parseStreetsRequest(good)).toEqual(good);
  });
  it("reports malformed input", () => {
    expect(parseStreetsRequest("nope")).toEqual({ error: "malformed" });
    expect(parseStreetsRequest({ anchor })).toEqual({ error: "malformed" });
    expect(parseStreetsRequest({ ...good, bbox: { ...good.bbox, west: NaN } })).toEqual({ error: "malformed" });
    expect(parseStreetsRequest({ ...good, bbox: { west: 5, south: 52.36, east: 4, north: 52.38 } })).toEqual({ error: "malformed" });
  });
  it("reports an over-span bbox separately from malformed", () => {
    const wide = { west: 4, south: 52, east: 4 + MAX_BUILDING_SPAN_DEG + 0.01, north: 52.01 };
    expect(parseStreetsRequest({ ...good, bbox: wide })).toEqual({ error: "span" });
  });
});

describe("OsmStreetProvider", () => {
  const body = {
    elements: [
      {
        type: "way", id: 42, tags: { highway: "residential", name: "Testlaan" },
        geometry: [{ lat: 52.37, lon: 4.89 }, { lat: 52.3701, lon: 4.8901 }],
      },
      {
        type: "way", id: 43, tags: { waterway: "canal", name: "Testgracht" },
        geometry: [{ lat: 52.372, lon: 4.892 }, { lat: 52.3721, lon: 4.8921 }],
      },
    ],
  };

  it("queries Overpass for highways AND canals over the bbox", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal("fetch", f);
    const r = await new OsmStreetProvider().fetchStreets(good.bbox, anchor);
    const sent = String(f.mock.calls[0][1].body);
    expect(sent).toContain(encodeURIComponent('way["highway"]'));
    expect(sent).toContain(encodeURIComponent('way["waterway"="canal"]'));
    expect(sent).toContain(
      encodeURIComponent(`(${good.bbox.south},${good.bbox.west},${good.bbox.north},${good.bbox.east})`),
    );
    expect(r.streets.map((s) => s.type).sort()).toEqual(["canal", "street"]);
    expect(r.truncated).toBe(false);
    expect(r.total).toBe(2);
  });

  it("serves a repeat request from cache without re-fetching", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal("fetch", f);
    const p = new OsmStreetProvider();
    const a = await p.fetchStreets(good.bbox, anchor);
    const b = await p.fetchStreets(good.bbox, anchor);
    expect(f).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it("propagates a fatal Overpass error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }));
    await expect(new OsmStreetProvider().fetchStreets(good.bbox, anchor)).rejects.toThrow(/400/);
  });
});
