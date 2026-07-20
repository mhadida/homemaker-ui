import { describe, it, expect } from "vitest";
import {
  smoothCentreline,
  streetRibbon,
  roundaboutRing,
  streetAdvisory,
  snapStreetPoint,
  cornerFit,
  filletCentreline,
  closestPointOnSegment,
  nearestPointOnStreets,
} from "./geometry";
import type { Street, StreetNetwork, Vec2 } from "./types";

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

  it("a gently bent street holds its half-width offset (miter never pinches in)", () => {
    const cl = smoothCentreline([[0, 0], [10, 4], [20, 0]], 10);
    const { left, right } = streetRibbon(cl, 6);
    for (let i = 0; i < cl.length; i++) {
      // a mitered joint sits AT the half-width on a straight run and just
      // BEYOND it through a bend — never inside it (that would narrow the road)
      const dl = Math.hypot(left[i][0] - cl[i][0], left[i][1] - cl[i][1]);
      expect(dl).toBeGreaterThanOrEqual(3 - 1e-9);
      expect(dl).toBeLessThan(3.05); // ~3.012 at the sharpest sample of this bend
      const dr = Math.hypot(right[i][0] - cl[i][0], right[i][1] - cl[i][1]);
      expect(dr).toBeGreaterThanOrEqual(3 - 1e-9);
      expect(dr).toBeLessThan(3.05);
    }
  });

  it("a square corner miters square — full width held, corner filled", () => {
    // 90° corner, width 9 ⇒ half 4.5. The offset lines are z=±4.5 (first leg)
    // and x=∓4.5 (second leg); a true miter lands on their intersections, so
    // the paving fills the corner box instead of bevelling it off.
    const { left, right } = streetRibbon([[-50, 0], [0, 0], [0, 50]], 9);
    expect(left[1][0]).toBeCloseTo(-4.5, 9);
    expect(left[1][1]).toBeCloseTo(4.5, 9);
    expect(right[1][0]).toBeCloseTo(4.5, 9);
    expect(right[1][1]).toBeCloseTo(-4.5, 9);
    // …and the road never narrows: the two edges stay 9 m apart across the turn
    expect(Math.hypot(left[1][0] - right[1][0], left[1][1] - right[1][1])).toBeCloseTo(
      9 * Math.SQRT2, // measured along the corner bisector — perpendicular width is 9
      9,
    );
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
  it("degenerate (duplicated) adjacent point → no fillet, not a phantom 90° corner", () => {
    expect(cornerFit([0, 0], [0, 0], [0, 50])).toEqual({ deflection: 0, maxRadius: 0 });
    expect(cornerFit([-50, 0], [0, 0], [0, 0])).toEqual({ deflection: 0, maxRadius: 0 });
  });
  it("near-180° hairpin does not throw or produce non-finite output", () => {
    const out = filletCentreline([[-1000, 0], [0, 0], [-1000, 5]], 120, 8);
    for (const [x, z] of out) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(z)).toBe(true);
    }
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
  it("gentle corner rounds to an arc; a sharp (>=60°) corner stays square", () => {
    // gentle ~37° bend → fillet arc appears (extra samples between the ends)
    const gentle = filletCentreline([[-50, 0], [0, 0], [40, 30]], 20, 8);
    expect(gentle.length).toBeGreaterThan(3);
    // a 90° corner is SHARP → NOT rounded; the raw vertex passes through so the
    // ribbon's miter fills it square (user: "90° corner filled, not rounded").
    expect(filletCentreline([[-50, 0], [0, 0], [0, 50]], 20, 8)).toEqual([
      [-50, 0],
      [0, 0],
      [0, 50],
    ]);
  });
  it("too-tight corner clamps below minRadius without throwing", () => {
    const pts: Vec2[] = [[-2, 0], [0, 0], [0, 2]]; // 2 m segments, boulevard-scale minRadius
    expect(() => filletCentreline(pts, 120, 8)).not.toThrow();
    const out = filletCentreline(pts, 120, 8);
    // applied radius ≤ maxRadius (=1) ⇒ arc stays within ~1 m of the corner
    for (const p of out) expect(distTo(p, [0, 0])).toBeLessThan(2.5);
  });
  it("bigger minRadius pushes the arc farther from the corner (wide sweep)", () => {
    const pts: Vec2[] = [[-100, 0], [0, 0], [90, 40]]; // ~24° bend — gentle, so it rounds
    const near = (r: number) => Math.min(...filletCentreline(pts, r, 8).map((p) => distTo(p, [0, 0])));
    expect(near(40)).toBeGreaterThan(near(5)); // boulevard bows out more than an alley
  });
});

describe("streetAdvisory radius hint", () => {
  it("flags a boulevard corner tighter than its minimum radius", () => {
    const s: Street = { id: "s1", type: "boulevard", points: [[-5, 0], [0, 0], [0, 5]] };
    expect(streetAdvisory(s)).toMatch(/minimum radius/i);
  });
  it("no radius hint for a gentle corner within the type minimum", () => {
    // alley minRadius 6; long shallow bend seats easily
    const s: Street = { id: "s2", type: "alley", points: [[-30, 0], [0, 0], [30, 2]] };
    const msg = streetAdvisory(s);
    expect(msg === null || !/minimum radius/i.test(msg)).toBe(true);
  });
  it("still fires the existing long-straight-run hint when no radius issue", () => {
    const s: Street = { id: "s3", type: "street", points: [[0, 0], [100, 0]] };
    expect(streetAdvisory(s)).toMatch(/straight run/i);
  });
});

describe("closestPointOnSegment", () => {
  it("projects onto the segment interior", () => {
    const r = closestPointOnSegment([5, 3], [0, 0], [10, 0]);
    expect(r.point).toEqual([5, 0]);
    expect(r.t).toBeCloseTo(0.5, 6);
    expect(r.dist).toBeCloseTo(3, 6);
  });
  it("clamps beyond an endpoint", () => {
    const r = closestPointOnSegment([-4, 0], [0, 0], [10, 0]);
    expect(r.point).toEqual([0, 0]);
    expect(r.t).toBe(0);
  });
  it("handles a zero-length segment", () => {
    const r = closestPointOnSegment([3, 4], [1, 1], [1, 1]);
    expect(r.point).toEqual([1, 1]);
    expect(Number.isFinite(r.dist)).toBe(true);
  });
});

describe("snapStreetPoint — segment snapping", () => {
  const net: StreetNetwork = {
    streets: [{ id: "street-1", type: "street", points: [[0, 0], [20, 0]] }],
    roundabouts: [],
  };
  it("snaps a near-segment point onto the segment (T formation)", () => {
    expect(snapStreetPoint([10, 0.5], net, 1)).toEqual([10, 0]);
  });
  it("prefers an existing vertex over a segment when both are in range", () => {
    expect(snapStreetPoint([0.3, 0.3], net, 1)).toEqual([0, 0]); // the vertex, not [0.3,0]
  });
  it("leaves a far point unchanged", () => {
    expect(snapStreetPoint([10, 5], net, 1)).toEqual([10, 5]);
  });
});

describe("filletCentreline / streetRibbon — closed loops", () => {
  it("open behaviour is unchanged when closed is omitted/false", () => {
    const pts: Vec2[] = [[0, 0], [10, 0], [10, 10]];
    expect(filletCentreline(pts, 3)).toEqual(filletCentreline(pts, 3, 8, false));
    const out = filletCentreline(pts, 3);
    expect(out[0]).toEqual([0, 0]); // first pinned
    expect(out[out.length - 1]).toEqual([10, 10]); // last pinned
  });

  it("closed: fillets EVERY gentle corner (incl. the seam) and closes the ring", () => {
    // a 12-gon ring — 30° corners, all gentle, so all of them round
    const ring: Vec2[] = Array.from({ length: 12 }, (_, i): Vec2 => {
      const a = (i / 12) * Math.PI * 2;
      return [Math.cos(a) * 60, Math.sin(a) * 60];
    });
    const out = filletCentreline(ring, 10, 4, true);
    // ring closed: first sample repeated at the end
    expect(out[0][0]).toBeCloseTo(out[out.length - 1][0], 6);
    expect(out[0][1]).toBeCloseTo(out[out.length - 1][1], 6);
    // no raw corner survives (all filleted, including ring[0] at the seam)
    for (const c of ring)
      expect(out.some((p) => p[0] === c[0] && p[1] === c[1])).toBe(false);
  });

  it("closed: a square ring keeps its sharp corners square, and still closes", () => {
    const sq: Vec2[] = [[0, 0], [20, 0], [20, 20], [0, 20]];
    const out = filletCentreline(sq, 3, 8, true);
    // every 90° corner is SHARP → passes through raw for the ribbon to miter
    // square (user: a 90° corner is filled with asphalt, not rounded)
    expect(out).toEqual([[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]);
  });

  it("closed ribbon closes with no seam gap", () => {
    const sq: Vec2[] = [[0, 0], [20, 0], [20, 20], [0, 20]];
    const cl = filletCentreline(sq, 3, 8, true);
    const { left, right } = streetRibbon(cl, 6, true);
    expect(left[0][0]).toBeCloseTo(left[left.length - 1][0], 6);
    expect(left[0][1]).toBeCloseTo(left[left.length - 1][1], 6);
    expect(right[0][0]).toBeCloseTo(right[right.length - 1][0], 6);
    expect(right[0][1]).toBeCloseTo(right[right.length - 1][1], 6);
  });
})

describe("nearestPointOnStreets", () => {
  const net = (streets: Street[]): StreetNetwork => ({
    streets,
    roundabouts: [],
    squares: [],
  });
  // a straight street along +x at z = 0
  const straight: Street = {
    id: "s1",
    type: "street",
    points: [
      [0, 0],
      [100, 0],
    ],
  };

  it("projects a point onto the centreline and reports the offset", () => {
    const r = nearestPointOnStreets([40, 12], net([straight]));
    expect(r).not.toBeNull();
    expect(r!.streetId).toBe("s1");
    expect(r!.point[0]).toBeCloseTo(40);
    expect(r!.point[1]).toBeCloseTo(0);
    expect(r!.dist).toBeCloseTo(12);
  });

  it("is UNBOUNDED — a far-off pick still lands on the street", () => {
    // snapStreetPoint would return the raw point here (outside any radius);
    // this must snap regardless, so a walk start can never be off-street.
    const r = nearestPointOnStreets([50, 5000], net([straight]));
    expect(r!.point[0]).toBeCloseTo(50);
    expect(r!.point[1]).toBeCloseTo(0);
  });

  it("stays mid-segment instead of jumping to a vertex", () => {
    // 6 m from the centreline at x=45 — nearer to the x=100 vertex in
    // snapStreetPoint's vertex-first ordering, but the projection wins here.
    const r = nearestPointOnStreets([45, 6], net([straight]));
    expect(r!.point[0]).toBeCloseTo(45);
  });

  it("reports the unit tangent as the direction of travel", () => {
    const diagonal: Street = {
      id: "d",
      type: "street",
      points: [
        [0, 0],
        [10, 10],
      ],
    };
    const r = nearestPointOnStreets([5, 5], net([diagonal]));
    expect(r!.tangent[0]).toBeCloseTo(Math.SQRT1_2);
    expect(r!.tangent[1]).toBeCloseTo(Math.SQRT1_2);
    expect(Math.hypot(...r!.tangent)).toBeCloseTo(1);
  });

  it("picks the closest street when several compete", () => {
    const far: Street = {
      id: "far",
      type: "street",
      points: [
        [0, 200],
        [100, 200],
      ],
    };
    expect(nearestPointOnStreets([50, 10], net([straight, far]))!.streetId).toBe("s1");
    expect(nearestPointOnStreets([50, 190], net([straight, far]))!.streetId).toBe("far");
  });

  it("covers a closed loop's implicit closing segment", () => {
    const ring: Street = {
      id: "ring",
      type: "street",
      points: [
        [0, 0],
        [60, 0],
        [60, 60],
        [0, 60],
      ],
      closed: true,
    };
    // The x=0 edge exists ONLY as the wrap segment [0,60] → [0,0].
    const r = nearestPointOnStreets([-5, 30], net([ring]));
    expect(r!.point[0]).toBeCloseTo(0);
    expect(r!.point[1]).toBeCloseTo(30);
    expect(r!.dist).toBeCloseTo(5);
  });

  it("does NOT invent a closing segment for an open polyline", () => {
    const open: Street = {
      id: "o",
      type: "street",
      points: [
        [0, 0],
        [60, 0],
        [60, 60],
        [0, 60],
      ],
    };
    // Same probe as the ring test: with no wrap the nearest real point is the
    // [0,0] / [0,60] endpoint, ~30 m away, not a 5 m projection.
    const r = nearestPointOnStreets([-5, 30], net([open]));
    expect(r!.dist).toBeGreaterThan(29);
  });

  it("returns null for an empty network or single-vertex stubs", () => {
    expect(nearestPointOnStreets([0, 0], net([]))).toBeNull();
    expect(
      nearestPointOnStreets([0, 0], net([{ id: "p", type: "street", points: [[5, 5]] }])),
    ).toBeNull();
  });

  it("ignores zero-length segments rather than emitting a NaN tangent", () => {
    const dup: Street = {
      id: "dup",
      type: "street",
      points: [
        [10, 0],
        [10, 0],
        [20, 0],
      ],
    };
    const r = nearestPointOnStreets([15, 3], net([dup]));
    expect(Number.isFinite(r!.tangent[0])).toBe(true);
    expect(Math.hypot(...r!.tangent)).toBeCloseTo(1);
  });
});
