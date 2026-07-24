import { describe, it, expect } from "vitest";
import { project, unproject, anchorOf, type GeoAnchor } from "./project";

const AMS: GeoAnchor = { lat0: 52.3676, lon0: 4.9041 };

describe("anchorOf", () => {
  it("is the bbox centre", () => {
    expect(anchorOf({ west: 4, south: 52, east: 6, north: 54 })).toEqual({
      lat0: 53,
      lon0: 5,
    });
  });
});

describe("project", () => {
  it("maps the anchor to the origin", () => {
    const [x, z] = project(AMS.lat0, AMS.lon0, AMS);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("1° north ≈ 111.32 km on +z, east on +x", () => {
    const [, z] = project(AMS.lat0 + 1, AMS.lon0, AMS);
    expect(z).toBeCloseTo(111319, 0);
    const [x] = project(AMS.lat0, AMS.lon0 + 1, AMS);
    expect(x).toBeGreaterThan(0); // east is +x
  });

  it("longitude metres shrink by cos(lat0)", () => {
    const eq: GeoAnchor = { lat0: 0, lon0: 0 };
    const hi: GeoAnchor = { lat0: 60, lon0: 0 };
    const [xEq] = project(0, 1, eq);
    const [xHi] = project(60, 1, hi);
    expect(xHi).toBeCloseTo(xEq * Math.cos((60 * Math.PI) / 180), 3);
  });
});

describe("unproject", () => {
  it("round-trips project", () => {
    const [x, z] = project(52.4, 4.95, AMS);
    const [lat, lon] = unproject(x, z, AMS);
    expect(lat).toBeCloseTo(52.4, 9);
    expect(lon).toBeCloseTo(4.95, 9);
  });
});
