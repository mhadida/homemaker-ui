import { describe, it, expect } from "vitest";
import { classifyWay, parseWidth, mergeWays, osmToStreets, type OsmWay } from "./streets";
import type { GeoAnchor } from "./project";

const ANCHOR: GeoAnchor = { lat0: 52.37, lon0: 4.89 };

describe("classifyWay", () => {
  it("maps the arterial classes to boulevard", () => {
    for (const h of ["motorway", "trunk", "primary", "primary_link"]) {
      expect(classifyWay({ highway: h })?.type).toBe("boulevard");
    }
  });
  it("maps secondary/tertiary to road", () => {
    expect(classifyWay({ highway: "secondary" })?.type).toBe("road");
    expect(classifyWay({ highway: "tertiary" })?.type).toBe("road");
  });
  it("maps the local classes to street", () => {
    for (const h of ["residential", "unclassified", "living_street", "busway"]) {
      expect(classifyWay({ highway: h })?.type).toBe("street");
    }
  });
  it("maps service to alley", () => {
    expect(classifyWay({ highway: "service" })?.type).toBe("alley");
  });
  it("maps pedestrian to a car-free street", () => {
    expect(classifyWay({ highway: "pedestrian" })).toEqual({ type: "street", traffic: "peds" });
  });
  it("maps waterway=canal to canal", () => {
    expect(classifyWay({ waterway: "canal" })?.type).toBe("canal");
  });
  it("drops paths, steps and anything unlisted", () => {
    for (const h of ["footway", "cycleway", "steps", "path", "construction", "raceway"]) {
      expect(classifyWay({ highway: h })).toBeNull();
    }
    expect(classifyWay(undefined)).toBeNull();
    expect(classifyWay({})).toBeNull();
  });
});

describe("parseWidth", () => {
  it("reads a plain, suffixed or comma-decimal width", () => {
    expect(parseWidth({ width: "12" })).toBe(12);
    expect(parseWidth({ width: "12.5 m" })).toBe(12.5);
    expect(parseWidth({ width: "12,5" })).toBe(12.5);
  });
  it("is undefined when absent or out of a sane 1..60 m range", () => {
    expect(parseWidth(undefined)).toBeUndefined();
    expect(parseWidth({})).toBeUndefined();
    expect(parseWidth({ width: "wide" })).toBeUndefined();
    expect(parseWidth({ width: "0" })).toBeUndefined();
    expect(parseWidth({ width: "-4" })).toBeUndefined();
    expect(parseWidth({ width: "500" })).toBeUndefined();
  });
});

const way = (id: number, name: string | undefined, coords: [number, number][], highway = "residential"): OsmWay => ({
  type: "way",
  id,
  tags: { highway, ...(name ? { name } : {}) },
  geometry: coords.map(([lat, lon]) => ({ lat, lon })),
});

describe("mergeWays", () => {
  it("chains two ways that share an endpoint", () => {
    const a = way(1, "Herengracht", [[0, 0], [0, 1]]);
    const b = way(2, "Herengracht", [[0, 1], [0, 2]]);
    const groups = mergeWays([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((w) => w.id).sort()).toEqual([1, 2]);
  });
  it("chains a way that is stored reversed", () => {
    const a = way(1, "Herengracht", [[0, 0], [0, 1]]);
    const b = way(2, "Herengracht", [[0, 2], [0, 1]]); // shares its END with a's end
    expect(mergeWays([a, b])).toHaveLength(1);
  });
  it("chains three ways into one run", () => {
    const ws = [
      way(1, "Keizersgracht", [[0, 0], [0, 1]]),
      way(2, "Keizersgracht", [[0, 1], [0, 2]]),
      way(3, "Keizersgracht", [[0, 2], [0, 3]]),
    ];
    const groups = mergeWays(ws);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
  it("never merges unnamed ways", () => {
    const a = way(1, undefined, [[0, 0], [0, 1]]);
    const b = way(2, undefined, [[0, 1], [0, 2]]);
    expect(mergeWays([a, b])).toHaveLength(2);
  });
  it("never merges different names or different types", () => {
    expect(mergeWays([
      way(1, "A", [[0, 0], [0, 1]]),
      way(2, "B", [[0, 1], [0, 2]]),
    ])).toHaveLength(2);
    expect(mergeWays([
      way(1, "A", [[0, 0], [0, 1]], "residential"),
      way(2, "A", [[0, 1], [0, 2]], "primary"),
    ])).toHaveLength(2);
  });
  it("does not merge same-named ways that do not touch", () => {
    expect(mergeWays([
      way(1, "A", [[0, 0], [0, 1]]),
      way(2, "A", [[5, 5], [5, 6]]),
    ])).toHaveLength(2);
  });
  it("is order-independent", () => {
    const ws = [
      way(3, "X", [[0, 2], [0, 3]]),
      way(1, "X", [[0, 0], [0, 1]]),
      way(2, "X", [[0, 1], [0, 2]]),
    ];
    const groups = mergeWays(ws);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
});

describe("osmToStreets", () => {
  it("projects through the anchor and keeps the merged run contiguous", () => {
    const ws = [
      way(1, "Herengracht", [[ANCHOR.lat0, ANCHOR.lon0], [ANCHOR.lat0, ANCHOR.lon0 + 0.001]]),
      way(2, "Herengracht", [[ANCHOR.lat0, ANCHOR.lon0 + 0.001], [ANCHOR.lat0, ANCHOR.lon0 + 0.002]]),
    ];
    const r = osmToStreets(ws, ANCHOR, 100);
    expect(r.streets).toHaveLength(1);
    expect(r.streets[0].points.length).toBe(3);            // 2+2 with the shared node once
    expect(r.streets[0].points[0][0]).toBeCloseTo(0, 6);   // first vertex sits at the anchor
    expect(r.streets[0].points[0][1]).toBeCloseTo(0, 6);
    expect(r.streets[0].id).toMatch(/^street-osm-1m$/);
  });
  it("ids a lone way without the merge suffix", () => {
    const r = osmToStreets([way(7, undefined, [[0, 0], [0, 1]])], ANCHOR, 100);
    expect(r.streets[0].id).toBe("street-osm-7");
  });
  it("drops path classes entirely", () => {
    const r = osmToStreets([
      way(1, "P", [[0, 0], [0, 1]], "footway"),
      way(2, "S", [[0, 0], [0, 1]], "residential"),
    ], ANCHOR, 100);
    expect(r.streets).toHaveLength(1);
    expect(r.streets[0].type).toBe("street");
  });
  it("skips ways with fewer than 2 vertices", () => {
    const r = osmToStreets([{ type: "way", id: 1, tags: { highway: "residential" }, geometry: [{ lat: 0, lon: 0 }] }], ANCHOR, 100);
    expect(r.streets).toHaveLength(0);
  });
  it("caps at maxStreets and reports the pre-cap total", () => {
    const ws = Array.from({ length: 5 }, (_, i) => way(i + 1, undefined, [[i, 0], [i, 1]]));
    const r = osmToStreets(ws, ANCHOR, 3);
    expect(r.streets).toHaveLength(3);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(5);
  });
  it("carries a sane width tag through and omits an insane one", () => {
    const wide = way(1, undefined, [[0, 0], [0, 1]]);
    wide.tags!.width = "18";
    const junk = way(2, undefined, [[1, 0], [1, 1]]);
    junk.tags!.width = "999";
    const r = osmToStreets([wide, junk], ANCHOR, 10);
    expect(r.streets.find((s) => s.id === "street-osm-1")!.width).toBe(18);
    expect(r.streets.find((s) => s.id === "street-osm-2")!.width).toBeUndefined();
  });
});
