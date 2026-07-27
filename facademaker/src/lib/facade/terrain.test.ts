import { describe, it, expect } from "vitest";
import {
  groundHeightAt,
  levelingFor,
  groundNormal,
  DEFAULT_GROUND,
  type Ground,
} from "./terrain";

describe("groundHeightAt", () => {
  it("is 0 at the origin and everywhere when flat", () => {
    expect(groundHeightAt(0, 0, DEFAULT_GROUND)).toBe(0);
    expect(groundHeightAt(50, -30, { slope: 0, azimuth: 123 })).toBe(0);
  });

  it("rises along the uphill azimuth, falls opposite", () => {
    const g: Ground = { slope: 0.1, azimuth: 0 }; // uphill = +z
    expect(groundHeightAt(0, 10, g)).toBeCloseTo(1, 9);
    expect(groundHeightAt(0, -10, g)).toBeCloseTo(-1, 9);
    expect(groundHeightAt(10, 0, g)).toBeCloseTo(0, 9); // across-slope
  });

  it("azimuth 90 makes +x uphill", () => {
    const g: Ground = { slope: 0.2, azimuth: 90 };
    expect(groundHeightAt(5, 0, g)).toBeCloseTo(1, 9);
    expect(groundHeightAt(0, 5, g)).toBeCloseTo(0, 9);
  });
});

describe("levelingFor", () => {
  it("flat ground → datum 0, drop 0", () => {
    const l = levelingFor(10, -5, 8, 8, 0, DEFAULT_GROUND);
    expect(l.datum).toBe(0);
    expect(l.drop).toBe(0);
  });

  it("datum = front-centre height; drop spans the footprint", () => {
    // uphill +z, slope 0.1; building at (0,0), depth 8, rotationY 0.
    // front-centre (0,0) → datum 0; back corners at z=-8 → h=-0.8; drop 0.8.
    const g: Ground = { slope: 0.1, azimuth: 0 };
    const l = levelingFor(0, 0, 6, 8, 0, g);
    expect(l.datum).toBeCloseTo(0, 9);
    expect(l.drop).toBeCloseTo(0.8, 9);
  });

  it("datum depends only on front-centre, not rotation; drop stays ≥ 0", () => {
    const g: Ground = { slope: 0.15, azimuth: 40 };
    const a = levelingFor(3, -2, 7, 9, 0.7, g);
    const b = levelingFor(3, -2, 7, 9, 2.1, g);
    expect(b.datum).toBeCloseTo(a.datum, 9); // datum = h(3,-2), rotation-free
    expect(a.drop).toBeGreaterThanOrEqual(0);
    expect(b.drop).toBeGreaterThanOrEqual(0);
  });

  it("across-slope building (azimuth ⟂ depth) still levels its width span", () => {
    // uphill +x, so the width span (local x) drops across it.
    const g: Ground = { slope: 0.2, azimuth: 90 };
    const l = levelingFor(0, 0, 10, 6, 0, g);
    // datum at (0,0)=0; left corner x=-5 → h=-1; drop 1.
    expect(l.drop).toBeCloseTo(1, 9);
  });
});

describe("groundNormal", () => {
  it("is +y when flat", () => {
    expect(groundNormal(DEFAULT_GROUND)).toEqual([0, 1, 0]);
  });

  it("is a unit vector tilted toward downhill", () => {
    const n = groundNormal({ slope: 0.1, azimuth: 0 });
    expect(Math.hypot(...n)).toBeCloseTo(1, 9);
    expect(n[1]).toBeGreaterThan(0.9); // mostly up
    expect(n[2]).toBeLessThan(0); // tilts toward −z (downhill, since +z uphill)
  });
});

import {
  sampleHF,
  groundNormalAt,
  type Heightfield,
} from "./terrain";

// 3×3 ramp rising along +x: h = 10·(x/20), flat in z. spacing 10.
const RAMP: Heightfield = {
  originX: 0,
  originZ: 0,
  spacing: 10,
  cols: 3,
  rows: 3,
  data: [0, 10, 20, 0, 10, 20, 0, 10, 20],
};

describe("sampleHF", () => {
  it("is exact at grid nodes", () => {
    expect(sampleHF(RAMP, 0, 0)).toBeCloseTo(0, 9);
    expect(sampleHF(RAMP, 10, 0)).toBeCloseTo(10, 9);
    expect(sampleHF(RAMP, 20, 20)).toBeCloseTo(20, 9);
  });
  it("bilinearly interpolates between nodes", () => {
    expect(sampleHF(RAMP, 5, 0)).toBeCloseTo(5, 9);
    expect(sampleHF(RAMP, 15, 12)).toBeCloseTo(15, 9);
  });
  it("clamps to the edge outside the grid", () => {
    expect(sampleHF(RAMP, -100, 0)).toBeCloseTo(0, 9);
    expect(sampleHF(RAMP, 999, 0)).toBeCloseTo(20, 9);
  });
});

describe("groundHeightAt with a heightfield", () => {
  it("routes to the sampler when hf is present", () => {
    expect(groundHeightAt(5, 0, { slope: 0.2, azimuth: 33, hf: RAMP })).toBeCloseTo(5, 9);
  });
  it("stays plane-identical when hf is absent (byte-identical guard)", () => {
    expect(groundHeightAt(5, 0, { slope: 0, azimuth: 0 })).toBe(0);
    expect(groundHeightAt(0, 10, { slope: 0.1, azimuth: 0 })).toBeCloseTo(1, 9);
  });
});

describe("groundNormalAt", () => {
  it("is +y over a flat heightfield", () => {
    const flat: Heightfield = { ...RAMP, data: [5, 5, 5, 5, 5, 5, 5, 5, 5] };
    expect(groundNormalAt(10, 10, { slope: 0, azimuth: 0, hf: flat })).toEqual([0, 1, 0]);
  });
  it("is a unit vector that tilts toward downhill (−x) on the ramp", () => {
    const n = groundNormalAt(10, 10, { slope: 0, azimuth: 0, hf: RAMP });
    expect(Math.hypot(...n)).toBeCloseTo(1, 9);
    expect(n[0]).toBeLessThan(0); // uphill is +x ⇒ normal leans −x
    expect(n[1]).toBeCloseTo(1 / Math.sqrt(2), 1); // 45-degree slope
  });
  it("falls back to the plane normal when hf is absent", () => {
    expect(groundNormalAt(0, 0, { slope: 0, azimuth: 0 })).toEqual([0, 1, 0]);
  });
});
