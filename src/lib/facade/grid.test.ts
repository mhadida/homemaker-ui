import { describe, it, expect } from "vitest";
import { snapToGrid, GRID_SPACING } from "./grid";

describe("snapToGrid", () => {
  it("rounds to cell corners at angle 0", () => {
    expect(snapToGrid([6.2, -3.9], 0)).toEqual([5, -5]);
    expect(snapToGrid([7.6, 2.4], 0)).toEqual([10, 0]);
  });

  it("is the identity for points already on the grid", () => {
    expect(snapToGrid([15, -10], 0)).toEqual([15, -10]);
  });

  it("snaps in the rotated frame at 45°", () => {
    // the world point (√2·5, 0) lies exactly on the 45° grid one cell out
    const d = Math.SQRT2 * GRID_SPACING;
    const [x, z] = snapToGrid([d + 0.3, 0.2], 45);
    // nearest 45°-grid corner to that point: (d, 0) is 2 cells (5,5)&(5,-5)…
    // verify the snapped point IS a grid corner: rotating back into the grid
    // frame must land on multiples of the spacing.
    const a = Math.PI / 4;
    const gx = x * Math.cos(a) + z * Math.sin(a);
    const gz = -x * Math.sin(a) + z * Math.cos(a);
    expect(gx / GRID_SPACING).toBeCloseTo(Math.round(gx / GRID_SPACING));
    expect(gz / GRID_SPACING).toBeCloseTo(Math.round(gz / GRID_SPACING));
  });

  it("honors a custom spacing", () => {
    expect(snapToGrid([2.4, 2.6], 0, 2.5)).toEqual([2.5, 2.5]);
  });
});
