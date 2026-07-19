import { describe, it, expect } from "vitest";
import { rangeAvg, rangeVariation, rangeFromAvg } from "./genControls";

describe("gen avg/variation view", () => {
  it("avg and variation read the midpoint and half-spread", () => {
    expect(rangeAvg({ min: 5, max: 9 })).toBe(7);
    expect(rangeVariation({ min: 5, max: 9 })).toBeCloseTo(2 / 7);
    expect(rangeVariation({ min: 7, max: 7 })).toBe(0);
  });

  it("round-trips: view → range → view", () => {
    const r = rangeFromAvg(7, 0.25, 4, 16);
    expect(rangeAvg(r)).toBeCloseTo(7);
    expect(rangeVariation(r)).toBeCloseTo(0.25);
  });

  it("zero variation collapses the range to the average", () => {
    expect(rangeFromAvg(6, 0, 4, 16)).toEqual({ min: 6, max: 6 });
  });

  it("clamps into the bounds and stays ordered", () => {
    const r = rangeFromAvg(15, 0.5, 4, 16);
    expect(r.min).toBeCloseTo(7.5);
    expect(r.max).toBe(16);
    expect(r.min).toBeLessThanOrEqual(r.max);
  });

  it("integer mode rounds both ends (storeys)", () => {
    expect(rangeFromAvg(3, 0.4, 1, 6, true)).toEqual({ min: 2, max: 4 });
    expect(rangeFromAvg(1.5, 0.4, 1, 6, true)).toEqual({ min: 1, max: 2 });
  });
});
