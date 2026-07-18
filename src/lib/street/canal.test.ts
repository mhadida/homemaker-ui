import { describe, it, expect } from "vitest";
import { canalOffsets, canalWaterY, CANAL_WATER_DEPTH } from "./canal";
import { STREET_SPECS } from "./types";
import type { Vec2 } from "./types";
import { groundHeightAt } from "@/lib/facade/terrain";

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

describe("canal level water", () => {
  it("sits WATER_DEPTH below grade on flat ground", () => {
    const cl: Vec2[] = [[0, 0], [20, 0]];
    expect(canalWaterY(cl, 14, { slope: 0, azimuth: 0 })).toBeCloseTo(-CANAL_WATER_DEPTH, 6);
  });

  it("is level and below every bank point on a slope (never floods)", () => {
    const cl: Vec2[] = [[0, 0], [40, 0]];
    const g = { slope: 0.1, azimuth: 0 };
    const wY = canalWaterY(cl, 14, g);
    const { bank } = canalOffsets(cl, 14);
    for (const p of [...bank.left, ...bank.right]) {
      expect(groundHeightAt(p[0], p[1], g)).toBeGreaterThanOrEqual(wY - 1e-9);
    }
  });
});
