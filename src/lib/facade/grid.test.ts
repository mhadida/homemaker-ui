import { describe, it, expect } from "vitest";
import { snapToGrid, snapToGridAxis, GRID_SPACING, type Vec2 } from "./grid";
import { snapPoint } from "./blocks";
import type { FacadeBlock } from "./blocks";

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

/** Rotate a world point INTO the grid frame — the assertions below check
 * axis-alignment there, which is the only frame where it is meaningful. */
function toGridFrame(p: Vec2, angleDeg: number): Vec2 {
  const a = (angleDeg * Math.PI) / 180;
  return [
    p[0] * Math.cos(a) + p[1] * Math.sin(a),
    -p[0] * Math.sin(a) + p[1] * Math.cos(a),
  ];
}

describe("snapToGridAxis", () => {
  it("with no anchor is exactly snapToGrid (first vertex of a chain)", () => {
    expect(snapToGridAxis([6.2, -3.9], null, 0)).toEqual(snapToGrid([6.2, -3.9], 0));
    expect(snapToGridAxis([7.6, 2.4], null, 30)).toEqual(snapToGrid([7.6, 2.4], 30));
  });

  it("keeps the dominant axis and zeroes the other — horizontal", () => {
    // dx 6.2 dominates dz -3.9, so z must stay on the anchor's row
    expect(snapToGridAxis([6.2, -3.9], [0, 0], 0)).toEqual([5, 0]);
  });

  it("keeps the dominant axis and zeroes the other — vertical", () => {
    expect(snapToGridAxis([3.9, -6.2], [0, 0], 0)).toEqual([0, -5]);
  });

  it("breaks an exact tie toward the grid-x axis", () => {
    expect(snapToGridAxis([6, 6], [0, 0], 0)).toEqual([5, 0]);
  });

  it("measures from an OFF-LATTICE anchor, so the segment stays axis-aligned", () => {
    // a welded vertex need not sit on the lattice; the segment must still be
    // exactly horizontal and a whole number of cells long.
    const anchor: Vec2 = [1.3, 2.7];
    const out = snapToGridAxis([9, 3], anchor, 0);
    expect(out[1]).toBeCloseTo(anchor[1]); // same row → exactly axis-aligned
    const len = Math.hypot(out[0] - anchor[0], out[1] - anchor[1]);
    expect(len / GRID_SPACING).toBeCloseTo(Math.round(len / GRID_SPACING));
    expect(len).toBeGreaterThan(0);
  });

  it("stays axis-aligned in the GRID frame for a rotated grid", () => {
    const angle = 30;
    const anchor: Vec2 = [4, -7]; // deliberately off the rotated lattice
    const out = snapToGridAxis([20, 3], anchor, angle);
    const a = toGridFrame(anchor, angle);
    const o = toGridFrame(out, angle);
    const dx = o[0] - a[0];
    const dz = o[1] - a[1];
    // exactly one grid-frame component moved
    expect(Math.min(Math.abs(dx), Math.abs(dz))).toBeCloseTo(0);
    const moved = Math.max(Math.abs(dx), Math.abs(dz));
    expect(moved / GRID_SPACING).toBeCloseTo(Math.round(moved / GRID_SPACING));
    expect(moved).toBeGreaterThan(0);
  });

  it("collapses onto the anchor within half a cell (callers must guard)", () => {
    const anchor: Vec2 = [10, 10];
    const out = snapToGridAxis([12, 10.1], anchor, 0);
    expect(out[0]).toBeCloseTo(anchor[0]);
    expect(out[1]).toBeCloseTo(anchor[1]);
  });

  it("honors a custom spacing", () => {
    expect(snapToGridAxis([6.2, 1], [0, 0], 0, 2.5)).toEqual([5, 0]);
  });
});

describe("pen pipeline — grid axis lock then weld snap", () => {
  // Mirrors the pens' call sites: the grid runs FIRST, the weld snap runs after
  // and deliberately wins. Joining existing geometry beats the grid, so a weld
  // is allowed to pull a segment off-axis.
  const pipeline = (cursor: Vec2, anchor: Vec2 | null, blocks: FacadeBlock[]) =>
    snapPoint(snapToGridAxis(cursor, anchor, 0), blocks);

  const blockAt = (a: Vec2, b: Vec2): FacadeBlock =>
    ({ id: "b", line: { a, b } }) as unknown as FacadeBlock;

  it("locks to the axis when no node is within weld range", () => {
    const out = pipeline([6.2, -3.9], [0, 0], []);
    expect(out).toEqual([5, 0]); // z zeroed → exactly axis-aligned
  });

  it("lets a nearby existing node override the axis lock", () => {
    // an endpoint 0.4 m off the axis-locked point is inside the 1 m weld radius
    const blocks = [blockAt([5, 0.4], [30, 30])];
    const out = pipeline([6.2, -3.9], [0, 0], blocks);
    expect(out).toEqual([5, 0.4]); // welded, and therefore NOT on the grid axis
  });

  it("ignores an existing node outside the weld radius", () => {
    const blocks = [blockAt([5, 2], [30, 30])];
    expect(pipeline([6.2, -3.9], [0, 0], blocks)).toEqual([5, 0]);
  });
});
