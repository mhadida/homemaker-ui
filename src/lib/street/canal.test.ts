import { describe, it, expect } from "vitest";
import { canalOffsets } from "./canal";
import { STREET_SPECS } from "./types";
import type { Vec2 } from "./types";

describe("canal type + offsets", () => {
  it("canal STREET_SPECS: water 14, no cars, gentle radius", () => {
    expect(STREET_SPECS.canal).toEqual({
      width: 14, allowsCars: false, label: "Canal", minRadius: 45,
    });
  });

  it("canalOffsets places water/quay/bank edges at the right half-widths", () => {
    const cl: Vec2[] = [[0, 0], [10, 0]]; // along +x, normal ±z
    const o = canalOffsets(cl, 14);
    expect(Math.abs(o.water.left[0][1])).toBeCloseTo(7, 6);      // 14/2
    expect(Math.abs(o.quayFoot.left[0][1])).toBeCloseTo(7.5, 6); // +0.5
    expect(Math.abs(o.bank.left[0][1])).toBeCloseTo(10.5, 6);    // +3
    expect(Math.sign(o.water.left[0][1])).toBe(-Math.sign(o.water.right[0][1]));
  });
});
