import { describe, it, expect } from "vitest";
import { smoothCentreline } from "./geometry";

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
