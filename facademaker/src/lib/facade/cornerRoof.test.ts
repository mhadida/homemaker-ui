import { describe, it, expect } from "vitest";
import {
  cornerRoofPlan,
  cornerRoofTriangles,
  type CornerRoofInput,
  type Vec2,
  type Vec3,
} from "./cornerRoof";

/** Signed shoelace area of a plan polygon (|area| returned). */
function polyArea(points: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    s += x1 * z2 - x2 * z1;
  }
  return Math.abs(s) / 2;
}

const plan2 = (q: Vec3[]): Vec2[] => q.map((p) => [p[0], p[2]]);

/** Height of the plane through a face's first three vertices at plan (x,z). */
function planeHeight(face: Vec3[], x: number, z: number): number {
  const [a, b, c] = face;
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  // normal = u × v; plane: n·(p − a) = 0 → y
  const nx = u[1] * v[2] - u[2] * v[1];
  const ny = u[2] * v[0] - u[0] * v[2];
  const nz = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(ny) < 1e-12) throw new Error("vertical plane");
  return a[1] - (nx * (x - a[0]) + nz * (z - a[2])) / ny;
}

/** Every vertex of the face lies on the plane of its first three. */
function coplanar(face: Vec3[]): boolean {
  return face.every((p) => Math.abs(planeHeight(face, p[0], p[2]) - p[1]) < 1e-9);
}

/** The spec's worked example: 90° convex corner, D=10, Wa=24, Wb=18.
 * Wing A runs +x with its street north (body extends −z is WRONG — body
 * extends −nA = −z? nA=[0,1] → body z∈[−10,0]); wing B runs +z with street
 * east (body x∈[−10,0]). The bodies touch only at V — the SW elbow
 * [−10,0]×[−10,0] is the void the corner mass fills. */
const CONVEX: CornerRoofInput = {
  V: [0, 0],
  uA: [1, 0],
  uB: [0, 1],
  nA: [0, 1],
  nB: [1, 0],
  D: 10,
  Wa: 24,
  Wb: 18,
  convex: true,
  type: "gable",
  eaveY: 9,
  roofHeight: 3,
};

/** Concave: A as above; B runs −z with its street west (body x∈[0,10],
 * z∈[−18,0]) — the bodies overlap in [0,10]×[−10,0]. */
const CONCAVE: CornerRoofInput = {
  ...CONVEX,
  uB: [0, -1],
  nB: [-1, 0],
  convex: false,
};

describe("cornerRoofPlan — convex 90° (the spec's worked example)", () => {
  const plan = cornerRoofPlan(CONVEX)!;

  it("resolves with P at the centreline crossing and Q at the back corner", () => {
    expect(plan).not.toBeNull();
    expect(plan.P).toEqual([-5, -5]);
    expect(plan.Q).toEqual([-10, -10]);
    expect(plan.ridgeY).toBe(12);
  });

  it("every face is planar", () => {
    for (const f of plan.faces) expect(coplanar(f)).toBe(true);
  });

  it("the four faces tile the 520 m² L exactly (gable)", () => {
    const total = plan.faces.reduce((s, f) => s + polyArea(plan2(f)), 0);
    expect(total).toBeCloseTo(520, 6);
  });

  it("adjacent faces agree along the valley, hip and both ridges", () => {
    const [aFront, aBack, bFront, bBack] = plan.faces;
    const creases: [Vec3[], Vec3[], Vec2, Vec2][] = [
      // valley: front∩front from V to P
      [aFront, bFront, [0, 0], [-5, -5]],
      // hip: back∩back from Q to P
      [aBack, bBack, [-10, -10], [-5, -5]],
      // wing A ridge: front∩back from P to ridgeEndA
      [aFront, aBack, [-5, -5], [24, -5]],
      // wing B ridge
      [bFront, bBack, [-5, -5], [-5, 18]],
    ];
    for (const [f1, f2, from, to] of creases) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const x = from[0] + (to[0] - from[0]) * t;
        const z = from[1] + (to[1] - from[1]) * t;
        expect(planeHeight(f1, x, z)).toBeCloseTo(planeHeight(f2, x, z), 9);
      }
    }
  });

  it("known heights: V and Q at eaveY, P at ridgeY, elbow drains sideways", () => {
    const [aFront, , , bBack] = plan.faces;
    expect(planeHeight(aFront, 0, 0)).toBeCloseTo(9);
    expect(planeHeight(bBack, -10, -10)).toBeCloseTo(9);
    expect(planeHeight(aFront, -5, -5)).toBeCloseTo(12);
    // The spec's anti-tent probe: near the reentrant corner inside the elbow
    // the roof is at RIDGE height minus the B-back fall, NOT wing A's tent.
    // Point (−5, −1): on B-back's plane (x from −10 → −5 is half the run up).
    expect(planeHeight(bBack, -5, -1)).toBeCloseTo(12);
  });

  it("hip ends inset the ridge and slant the party triangle", () => {
    const hip = cornerRoofPlan({ ...CONVEX, type: "hip" })!;
    // ridgeEndA insets by min(D/2, Wa) = 5 → [19, −5]
    expect(hip.faces[0][2]).toEqual([19, 12, -5]);
    // the end triangle spans front → back → inset ridge
    expect(hip.ends[0]).toEqual([
      [24, 9, 0],
      [24, 9, -10],
      [19, 12, -5],
    ]);
    // faces + slanted ends still tile the L
    const total =
      hip.faces.reduce((s, f) => s + polyArea(plan2(f)), 0) +
      hip.ends.reduce((s, f) => s + polyArea(plan2(f)), 0);
    expect(total).toBeCloseTo(520, 6);
  });
});

describe("cornerRoofPlan — concave 90°", () => {
  const plan = cornerRoofPlan(CONCAVE)!;

  it("resolves with Q inside the union (the back notch)", () => {
    expect(plan.P).toEqual([5, -5]);
    expect(plan.Q).toEqual([10, -10]);
  });

  it("every face is planar", () => {
    for (const f of plan.faces) expect(coplanar(f)).toBe(true);
  });

  it("the four faces tile the union area (240 + 180 − 100 = 320)", () => {
    const total = plan.faces.reduce((s, f) => s + polyArea(plan2(f)), 0);
    expect(total).toBeCloseTo(320, 6);
  });

  it("creases agree from both sides (hip now at V, valley at Q)", () => {
    const [aFront, aBack, bFront, bBack] = plan.faces;
    for (const [f1, f2, from, to] of [
      [aFront, bFront, [0, 0], [5, -5]],
      [aBack, bBack, [10, -10], [5, -5]],
    ] as [Vec3[], Vec3[], Vec2, Vec2][]) {
      for (const t of [0, 0.5, 1]) {
        const x = from[0] + (to[0] - from[0]) * t;
        const z = from[1] + (to[1] - from[1]) * t;
        expect(planeHeight(f1, x, z)).toBeCloseTo(planeHeight(f2, x, z), 9);
      }
    }
  });
});

describe("cornerRoofPlan — preconditions and generality", () => {
  it("null for parallel wings (no corner)", () => {
    expect(cornerRoofPlan({ ...CONVEX, uB: [1, 0], nB: [0, 1] })).toBeNull();
  });

  it("null for a concave corner whose wing is too narrow (W ≤ D/2)", () => {
    expect(cornerRoofPlan({ ...CONCAVE, Wb: 5 })).toBeNull();
    expect(cornerRoofPlan({ ...CONCAVE, Wb: 5.01 })).not.toBeNull();
  });

  it("null for non-positive dimensions", () => {
    expect(cornerRoofPlan({ ...CONVEX, D: 0 })).toBeNull();
    expect(cornerRoofPlan({ ...CONVEX, roofHeight: 0 })).toBeNull();
  });

  it("a non-90° turn stays planar and gap-free along the valley", () => {
    // 60° between the wings: uB at 120° from uA still convex vs nA=[0,1]
    const s = Math.sin(Math.PI / 3);
    const c = Math.cos(Math.PI / 3);
    const skew: CornerRoofInput = {
      ...CONVEX,
      uB: [-c, s],
      nB: [s, c],
    };
    const plan = cornerRoofPlan(skew)!;
    expect(plan).not.toBeNull();
    for (const f of plan.faces) expect(coplanar(f)).toBe(true);
    const [aFront, , bFront] = plan.faces;
    for (const t of [0.25, 0.75]) {
      const x = plan.P[0] * t;
      const z = plan.P[1] * t;
      expect(planeHeight(aFront, x, z)).toBeCloseTo(planeHeight(bFront, x, z), 9);
    }
  });
});

describe("cornerRoofTriangles", () => {
  it("emits two triangles per face plus the end triangles", () => {
    const plan = cornerRoofPlan(CONVEX)!;
    const tris = cornerRoofTriangles(plan);
    expect(tris.length).toBe(4 * 6 + 2 * 3);
  });
});
