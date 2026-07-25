import { describe, it, expect } from "vitest";
import {
  resolveHeight,
  osmToContextBuildings,
  footprintBase,
  visibleBuildings,
  DEFAULT_BUILDING_HEIGHT,
  type ContextBuilding,
  type OsmElement,
} from "./buildings";
import type { GeoAnchor } from "./project";
import type { Ground } from "@/lib/facade/terrain";

const ANCHOR: GeoAnchor = { lat0: 52.37, lon0: 4.89 };

describe("resolveHeight", () => {
  it("uses the height tag in metres", () => {
    expect(resolveHeight({ height: "12" })).toBe(12);
    expect(resolveHeight({ height: "12.5" })).toBe(12.5);
  });
  it("tolerates a unit suffix and a decimal comma", () => {
    expect(resolveHeight({ height: "12 m" })).toBe(12);
    expect(resolveHeight({ height: "12,5" })).toBe(12.5);
  });
  it("falls back to building:levels x 3", () => {
    expect(resolveHeight({ "building:levels": "4" })).toBe(12);
  });
  it("prefers height over levels", () => {
    expect(resolveHeight({ height: "20", "building:levels": "2" })).toBe(20);
  });
  it("defaults when tags are missing, junk, or non-positive", () => {
    expect(resolveHeight(undefined)).toBe(DEFAULT_BUILDING_HEIGHT);
    expect(resolveHeight({})).toBe(DEFAULT_BUILDING_HEIGHT);
    expect(resolveHeight({ height: "tall" })).toBe(DEFAULT_BUILDING_HEIGHT);
    expect(resolveHeight({ height: "0" })).toBe(DEFAULT_BUILDING_HEIGHT);
    expect(resolveHeight({ height: "-5" })).toBe(DEFAULT_BUILDING_HEIGHT);
  });
  it("falls through a junk height to a valid levels tag", () => {
    expect(resolveHeight({ height: "0", "building:levels": "3" })).toBe(9);
  });
});

const square = (id: number, lat: number, lon: number, tags?: Record<string, string>): OsmElement => ({
  type: "way",
  id,
  tags,
  geometry: [
    { lat, lon },
    { lat, lon: lon + 0.0001 },
    { lat: lat + 0.0001, lon: lon + 0.0001 },
    { lat: lat + 0.0001, lon },
    { lat, lon }, // Overpass repeats the first node on a closed way
  ],
});

describe("osmToContextBuildings", () => {
  it("projects to local metres and drops the repeated closing node", () => {
    const r = osmToContextBuildings([square(1, ANCHOR.lat0, ANCHOR.lon0)], ANCHOR, 100);
    expect(r.buildings).toHaveLength(1);
    expect(r.buildings[0].id).toBe("way/1");
    expect(r.buildings[0].footprint).toHaveLength(4); // 5 nodes - 1 repeat
    // first vertex sits at the anchor => the local origin
    expect(r.buildings[0].footprint[0][0]).toBeCloseTo(0, 6);
    expect(r.buildings[0].footprint[0][1]).toBeCloseTo(0, 6);
  });
  it("skips elements without enough geometry", () => {
    const r = osmToContextBuildings(
      [{ type: "way", id: 2 }, { type: "way", id: 3, geometry: [{ lat: 1, lon: 1 }] }],
      ANCHOR,
      100,
    );
    expect(r.buildings).toHaveLength(0);
    expect(r.total).toBe(0);
  });
  it("caps at maxBuildings and reports truncation with the pre-cap total", () => {
    const els = Array.from({ length: 5 }, (_, i) => square(i + 1, ANCHOR.lat0, ANCHOR.lon0));
    const r = osmToContextBuildings(els, ANCHOR, 3);
    expect(r.buildings).toHaveLength(3);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(5);
  });
  it("reports no truncation under the cap", () => {
    const r = osmToContextBuildings([square(1, ANCHOR.lat0, ANCHOR.lon0)], ANCHOR, 100);
    expect(r.truncated).toBe(false);
    expect(r.total).toBe(1);
  });
  it("resolves each building's height from its tags", () => {
    const r = osmToContextBuildings(
      [square(1, ANCHOR.lat0, ANCHOR.lon0, { "building:levels": "5" })],
      ANCHOR,
      100,
    );
    expect(r.buildings[0].height).toBe(15);
  });
});

describe("footprintBase", () => {
  const FLAT: Ground = { slope: 0, azimuth: 0 };
  it("is 0 on flat ground", () => {
    expect(footprintBase([[0, 0], [10, 0], [10, 10]], FLAT)).toBe(0);
  });
  it("is the lowest vertex height on a slope", () => {
    // uphill = +z at 10%: h(z) = 0.1*z, so the lowest vertex is z = -20 => -2
    const g: Ground = { slope: 0.1, azimuth: 0 };
    expect(footprintBase([[0, 0], [5, -20], [5, 10]], g)).toBeCloseTo(-2, 9);
  });
  it("is 0 for an empty footprint (no vertices to sample)", () => {
    expect(footprintBase([], FLAT)).toBe(0);
  });
});

describe("visibleBuildings", () => {
  const bs: ContextBuilding[] = [
    { id: "way/1", footprint: [[0, 0]], height: 8 },
    { id: "way/2", footprint: [[1, 1]], height: 8 },
  ];
  it("returns everything when nothing is hidden", () => {
    expect(visibleBuildings(bs, new Set())).toEqual(bs);
  });
  it("filters out hidden ids", () => {
    expect(visibleBuildings(bs, new Set(["way/1"]))).toEqual([bs[1]]);
  });
});
