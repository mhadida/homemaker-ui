import { describe, it, expect } from "vitest";
import {
  smoothCentreline,
  streetRibbon,
  roundaboutRing,
  streetAdvisory,
  snapStreetPoint,
  cornerFit,
  filletCentreline,
} from "./geometry";
import type { StreetNetwork, Vec2 } from "./types";

describe("smoothCentreline", () => {
  it("passes a 2-point street through unchanged (straight)", () => {
    const pts = smoothCentreline([[0, 0], [10, 0]]);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([10, 0]);
    // collinear input stays collinear
    for (const [, z] of pts) expect(z).toBeCloseTo(0, 9);
  });

  it("samples a bent 3-point polyline into a smooth curve through its vertices", () => {
    const v: [number, number][] = [[0, 0], [10, 6], [20, 0]];
    const pts = smoothCentreline(v, 8);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([20, 0]);
    // the middle vertex is on the curve
    expect(pts.some((p) => Math.abs(p[0] - 10) < 1e-6 && Math.abs(p[1] - 6) < 1e-6)).toBe(true);
    // many samples → smooth
    expect(pts.length).toBeGreaterThan(10);
    // stays within the vertical envelope (no wild overshoot beyond the bend)
    for (const [, z] of pts) expect(z).toBeLessThanOrEqual(6 + 1e-6);
  });
});

describe("streetRibbon", () => {
  it("offsets a straight street to two parallel frontages at ±width/2", () => {
    const cl = smoothCentreline([[0, 0], [10, 0]]); // along +x
    const { left, right } = streetRibbon(cl, 8); // half = 4
    // street runs along +x; normal is ±z → one side z=+4, the other z=-4
    for (const [, z] of left) expect(Math.abs(Math.abs(z) - 4)).toBeLessThan(1e-6);
    for (const [, z] of right) expect(Math.abs(Math.abs(z) - 4)).toBeLessThan(1e-6);
    // left and right are on opposite sides
    expect(Math.sign(left[0][1])).toBe(-Math.sign(right[0][1]));
    expect(left).toHaveLength(cl.length);
    expect(right).toHaveLength(cl.length);
  });

  it("a gently bent street produces non-self-intersecting frontages", () => {
    const cl = smoothCentreline([[0, 0], [10, 4], [20, 0]], 10);
    const { left, right } = streetRibbon(cl, 6);
    // every frontage point is ~3 (half width) from its centreline point
    for (let i = 0; i < cl.length; i++) {
      const dl = Math.hypot(left[i][0] - cl[i][0], left[i][1] - cl[i][1]);
      expect(dl).toBeCloseTo(3, 4);
      const dr = Math.hypot(right[i][0] - cl[i][0], right[i][1] - cl[i][1]);
      expect(dr).toBeCloseTo(3, 4);
    }
  });

  it("keeps a full-width offset at a sharp reversal (no collapse to zero)", () => {
    const { left, right } = streetRibbon([[0, 0], [10, 0], [0.001, 0]], 8); // half = 4
    const dL = Math.hypot(left[1][0] - 10, left[1][1] - 0);
    const dR = Math.hypot(right[1][0] - 10, right[1][1] - 0);
    expect(dL).toBeCloseTo(4, 6);
    expect(dR).toBeCloseTo(4, 6);
  });
});

describe("roundaboutRing", () => {
  it("returns two centred closed loops of the given radii", () => {
    const { outer, island } = roundaboutRing([5, 5], 10, 3);
    expect(outer).toHaveLength(32);
    expect(island).toHaveLength(32);
    for (const p of outer) expect(Math.hypot(p[0] - 5, p[1] - 5)).toBeCloseTo(10, 6);
    for (const p of island) expect(Math.hypot(p[0] - 5, p[1] - 5)).toBeCloseTo(3, 6);
  });
});

describe("snapStreetPoint", () => {
  const net: StreetNetwork = {
    streets: [
      { id: "a", type: "street", points: [[0, 0], [10, 0]] },
      { id: "b", type: "street", points: [[20, 20], [30, 20]] },
    ],
    roundabouts: [],
  };

  it("snaps a point within radius of an existing street vertex to that exact vertex", () => {
    const snapped = snapStreetPoint([10.3, 0.2], net, 1);
    expect(snapped).toEqual([10, 0]);
  });

  it("leaves a point outside radius of every vertex unchanged", () => {
    const p: [number, number] = [5, 5];
    expect(snapStreetPoint(p, net, 1)).toEqual(p);
  });

  it("an empty network leaves the point unchanged (no-op)", () => {
    const p: [number, number] = [3, 4];
    const empty: StreetNetwork = { streets: [], roundabouts: [] };
    expect(snapStreetPoint(p, empty, 1)).toEqual(p);
  });

  it("picks the nearest vertex when multiple are within radius", () => {
    const close: StreetNetwork = {
      streets: [
        { id: "a", type: "street", points: [[0, 0]] },
        { id: "b", type: "street", points: [[0.6, 0]] },
      ],
      roundabouts: [],
    };
    // point closer to [0.6,0] than [0,0], both within radius 1
    expect(snapStreetPoint([0.7, 0], close, 1)).toEqual([0.6, 0]);
  });
});

describe("streetAdvisory", () => {
  it("flags a long straight street and a long uninterrupted boulevard", () => {
    expect(streetAdvisory({ id: "a", type: "street", points: [[0,0],[100,0]] })).toMatch(/curve|long/i);
    expect(streetAdvisory({ id: "b", type: "alley", points: [[0,0],[5,1],[10,0]] })).toBeNull();
  });

  it("flags a boulevard over the length threshold even when gently bent", () => {
    expect(
      streetAdvisory({
        id: "c",
        type: "boulevard",
        points: [[0, 0], [60, 5], [140, 0]],
      }),
    ).toMatch(/curve|long/i);
  });

  it("does not flag a road (no advisory for that type) or a short street", () => {
    expect(streetAdvisory({ id: "d", type: "road", points: [[0, 0], [100, 0]] })).toBeNull();
    expect(streetAdvisory({ id: "e", type: "street", points: [[0, 0], [10, 0]] })).toBeNull();
  });
});

const distTo = (p: Vec2, o: Vec2) => Math.hypot(p[0] - o[0], p[1] - o[1]);

describe("cornerFit", () => {
  it("collinear points → zero deflection and radius", () => {
    const f = cornerFit([0, 0], [5, 0], [10, 0]);
    expect(f.deflection).toBeCloseTo(0, 6);
    expect(f.maxRadius).toBe(0);
  });
  it("right-angle corner → deflection π/2, maxRadius = half-shorter-seg / tan(45°)", () => {
    const f = cornerFit([-10, 0], [0, 0], [0, 10]); // 90° turn, equal 10 m segments
    expect(f.deflection).toBeCloseTo(Math.PI / 2, 5);
    expect(f.maxRadius).toBeCloseTo(5, 5); // tCap = 5, tan(45°)=1
  });
});

describe("filletCentreline", () => {
  it("≤ 2 points → passthrough copy", () => {
    expect(filletCentreline([[0, 0], [10, 0]], 20)).toEqual([[0, 0], [10, 0]]);
  });
  it("keeps the first and last vertex exact (junctions pinned)", () => {
    const pts: Vec2[] = [[0, 0], [10, 0], [10, 10]];
    const out = filletCentreline(pts, 3);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([10, 10]);
  });
  it("collinear interior vertex passes through unchanged", () => {
    const out = filletCentreline([[0, 0], [5, 0], [10, 0]], 20);
    expect(out).toEqual([[0, 0], [5, 0], [10, 0]]);
  });
  it("right-angle corner: every arc sample lies on a circle of the applied radius", () => {
    // long segments so the fillet uses the full minRadius = 2 (maxRadius = 25)
    const pts: Vec2[] = [[-50, 0], [0, 0], [0, 50]];
    const out = filletCentreline(pts, 2, 8);
    // arc centre for a 90° corner turning left: equidistant (2) from both axes → (−2, 2)
    const O: Vec2 = [-2, 2];
    // the samples strictly between the tangent points are the arc
    const arc = out.slice(1, out.length - 1);
    for (const p of arc) expect(distTo(p, O)).toBeCloseTo(2, 4);
  });
  it("too-tight corner clamps below minRadius without throwing", () => {
    const pts: Vec2[] = [[-2, 0], [0, 0], [0, 2]]; // 2 m segments, boulevard-scale minRadius
    expect(() => filletCentreline(pts, 120, 8)).not.toThrow();
    const out = filletCentreline(pts, 120, 8);
    // applied radius ≤ maxRadius (=1) ⇒ arc stays within ~1 m of the corner
    for (const p of out) expect(distTo(p, [0, 0])).toBeLessThan(2.5);
  });
  it("bigger minRadius pushes the arc farther from the corner (wide sweep)", () => {
    const pts: Vec2[] = [[-100, 0], [0, 0], [0, 100]];
    const near = (r: number) => Math.min(...filletCentreline(pts, r, 8).map((p) => distTo(p, [0, 0])));
    expect(near(40)).toBeGreaterThan(near(5)); // boulevard bows out more than an alley
  });
});
