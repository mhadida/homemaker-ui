import { describe, it, expect } from "vitest";
import {
  blockFrame,
  lotPlacements,
  totalLotsWidth,
  syncLineToLots,
  initialWorld,
  snapPoint,
  DEFAULT_GEN,
  type FacadeBlock,
} from "./blocks";
import { DEFAULT_FACADE } from "./types";

const lot = (width: number) => ({
  params: { ...DEFAULT_FACADE, width },
  customized: false,
});

const block = (over: Partial<FacadeBlock>): FacadeBlock => ({
  id: "t",
  line: { a: [-5, 0], b: [5, 0] },
  flipped: false,
  gen: DEFAULT_GEN,
  seed: 1,
  lots: [lot(10)],
  ...over,
});

describe("blockFrame", () => {
  it("v1 starting line has normal +z (the v1 facade orientation)", () => {
    const f = blockFrame(block({}));
    expect(f.dir[0]).toBeCloseTo(1, 9);
    expect(f.dir[1]).toBeCloseTo(0, 9);
    expect(f.normal[0]).toBeCloseTo(0, 9);
    expect(f.normal[1]).toBeCloseTo(1, 9);
    expect(f.length).toBeCloseTo(10, 9);
    expect(f.origin).toEqual([-5, 0]);
  });

  it("flipped swaps endpoints, reversing dir and normal", () => {
    const f = blockFrame(block({ flipped: true }));
    expect(f.origin).toEqual([5, 0]);
    expect(f.dir[0]).toBeCloseTo(-1, 9);
    expect(f.normal[1]).toBeCloseTo(-1, 9);
  });

  it("diagonal line (3-4-5) has a unit left-perpendicular normal", () => {
    const f = blockFrame(block({ line: { a: [0, 0], b: [3, 4] } }));
    expect(f.length).toBeCloseTo(5, 9);
    expect(f.dir[0]).toBeCloseTo(0.6, 9);
    expect(f.dir[1]).toBeCloseTo(0.8, 9);
    expect(f.normal[0]).toBeCloseTo(-0.8, 9);
    expect(f.normal[1]).toBeCloseTo(0.6, 9);
    // unit + perpendicular
    expect(Math.hypot(f.normal[0], f.normal[1])).toBeCloseTo(1, 9);
    expect(f.dir[0] * f.normal[0] + f.dir[1] * f.normal[1]).toBeCloseTo(0, 9);
  });
});

describe("lotPlacements", () => {
  it("lays lots at their midpoints along the line", () => {
    const b = block({ lots: [lot(4), lot(6)] });
    const p = lotPlacements(b);
    expect(p).toHaveLength(2);
    // origin -5: lot0 mid at -5+2=-3, lot1 mid at -5+4+3=2
    expect(p[0].position[0]).toBeCloseTo(-3, 9);
    expect(p[1].position[0]).toBeCloseTo(2, 9);
    expect(p[0].position[1]).toBe(0);
    expect(p[0].position[2]).toBeCloseTo(0, 9);
    expect(p[0].rotationY).toBeCloseTo(0, 9); // v1 orientation
    expect(p[1].width).toBe(6);
  });

  it("rotationY maps local +z to the frame normal on a diagonal line", () => {
    const b = block({ line: { a: [0, 0], b: [3, 4] }, lots: [lot(5)] });
    const [p] = lotPlacements(b);
    const f = blockFrame(b);
    // local +z under yaw θ maps to (sinθ, cosθ) in (x, z)
    expect(Math.sin(p.rotationY)).toBeCloseTo(f.normal[0], 9);
    expect(Math.cos(p.rotationY)).toBeCloseTo(f.normal[1], 9);
  });
});

describe("syncLineToLots", () => {
  it("extends line.b when lot widths grow", () => {
    const b = syncLineToLots(block({ lots: [lot(4), lot(8)] }));
    expect(totalLotsWidth(b)).toBe(12);
    expect(b.line.a).toEqual([-5, 0]);
    expect(b.line.b[0]).toBeCloseTo(7, 9); // -5 + 12
    expect(b.line.b[1]).toBeCloseTo(0, 9);
  });

  it("respects flipped (effective origin is b)", () => {
    const b = syncLineToLots(block({ flipped: true, lots: [lot(4)] }));
    expect(b.line.b).toEqual([5, 0]); // effective origin preserved
    expect(b.line.a[0]).toBeCloseTo(1, 9); // 5 - 4 along dir (-1,0)
  });
});

describe("initialWorld / snapPoint", () => {
  it("initialWorld is one unpinned lot on a width-matched +z line", () => {
    const w = initialWorld({ ...DEFAULT_FACADE, width: 8 });
    expect(w.lots).toHaveLength(1);
    expect(w.lots[0].customized).toBe(false);
    expect(w.line.a[0]).toBeCloseTo(-4, 9);
    expect(w.line.b[0]).toBeCloseTo(4, 9);
    expect(blockFrame(w).normal[1]).toBeCloseTo(1, 9);
  });

  it("snapPoint snaps to endpoints within the radius, not beyond", () => {
    const blocks = [block({})]; // endpoints (-5,0) and (5,0)
    expect(snapPoint([4.4, 0.5], blocks, 1)).toEqual([5, 0]);
    expect(snapPoint([3, 3], blocks, 1)).toEqual([3, 3]);
  });
});
