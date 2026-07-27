import { describe, it, expect } from "vitest";
import {
  openFillFor,
  blockFootprint,
  parkPlanting,
  isOpenSpace,
} from "./openBlock";
import { DEFAULT_GEN, type FacadeBlock } from "./blocks";

type Vec2 = [number, number];

const MIN = DEFAULT_GEN.lotWidth.min; // 5 → threshold 2·min = 10

const frame = (length: number) => ({
  origin: [0, 0] as Vec2,
  dir: [1, 0] as Vec2,
  normal: [0, 1] as Vec2, // street +z, massing −z
  length,
});

// even-odd point-in-polygon
function inPoly(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
}

describe("openFillFor", () => {
  it("is null at or above the terrace threshold (2·min)", () => {
    expect(openFillFor(2 * MIN, 1, MIN)).toBeNull();
    expect(openFillFor(2 * MIN + 0.1, 12345, MIN)).toBeNull();
    expect(openFillFor(40, 7, MIN)).toBeNull();
  });

  it("is deterministic — same (length, seed, min) → same result", () => {
    for (const seed of [0, 1, 42, 9999, 123456]) {
      expect(openFillFor(6, seed, MIN)).toEqual(openFillFor(6, seed, MIN));
    }
  });

  it("produces all three outcomes across a seed sweep below the threshold", () => {
    const kinds = new Set<string>();
    for (let seed = 0; seed < 300; seed++) {
      const f = openFillFor(6, seed, MIN);
      kinds.add(f === null ? "building" : f.kind);
    }
    expect(kinds.has("building")).toBe(true);
    expect(kinds.has("plaza")).toBe(true);
    expect(kinds.has("park")).toBe(true);
  });

  it("plaza monument varies across seeds (fountain / obelisk / none all appear)", () => {
    const monuments = new Set<string>();
    for (let seed = 0; seed < 400; seed++) {
      const f = openFillFor(6, seed, MIN);
      if (f?.kind === "plaza") monuments.add(String(f.monument));
    }
    expect(monuments.has("fountain")).toBe(true);
    expect(monuments.has("obelisk")).toBe(true);
    expect(monuments.has("null")).toBe(true);
  });
});

describe("blockFootprint", () => {
  it("is the frontage line extruded back by depth along −normal", () => {
    const fp = blockFootprint(frame(10), 8);
    expect(fp).toHaveLength(4);
    expect(fp[0]).toEqual([0, 0]); // front-left = origin
    expect(fp[1]).toEqual([10, 0]); // front-right = origin + dir·length
    expect(fp[2]).toEqual([10, -8]); // back-right = fr − normal·depth
    expect(fp[3]).toEqual([0, -8]); // back-left = origin − normal·depth
  });

  it("has area length·depth", () => {
    const fp = blockFootprint(frame(12), 6);
    // shoelace
    let a = 0;
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = fp[i];
      const [x2, z2] = fp[(i + 1) % 4];
      a += x1 * z2 - x2 * z1;
    }
    expect(Math.abs(a) / 2).toBeCloseTo(12 * 6);
  });

  it("respects a rotated frame (normal stays perpendicular to dir)", () => {
    const f = {
      origin: [5, 5] as Vec2,
      dir: [0, 1] as Vec2, // along +z
      normal: [-1, 0] as Vec2, // left-perp
      length: 4,
    };
    const fp = blockFootprint(f, 8);
    expect(fp[0]).toEqual([5, 5]);
    expect(fp[1]).toEqual([5, 9]); // + dir·4
    expect(fp[2]).toEqual([13, 9]); // − normal·8 = +x·8
    expect(fp[3]).toEqual([13, 5]);
  });
});

describe("parkPlanting", () => {
  it("scatters trees strictly inside the footprint", () => {
    const fp = blockFootprint(frame(9), 8);
    const trees = parkPlanting(fp, 3);
    expect(trees.length).toBeGreaterThan(0);
    for (const t of trees) expect(inPoly(t.pos, fp)).toBe(true);
  });

  it("is deterministic", () => {
    const fp = blockFootprint(frame(9), 8);
    expect(parkPlanting(fp, 77)).toEqual(parkPlanting(fp, 77));
  });

  it("count grows with area", () => {
    const small = parkPlanting(blockFootprint(frame(9), 8), 5).length;
    const big = parkPlanting(blockFootprint(frame(40), 12), 5).length;
    expect(big).toBeGreaterThan(small);
  });

  it("is empty when the footprint is smaller than one inset cell", () => {
    expect(parkPlanting(blockFootprint(frame(2), 2), 5)).toEqual([]);
  });

  it("gives positive height and radius", () => {
    for (const t of parkPlanting(blockFootprint(frame(20), 10), 9)) {
      expect(t.height).toBeGreaterThan(0);
      expect(t.radius).toBeGreaterThan(0);
    }
  });
});

describe("isOpenSpace", () => {
  const block = (length: number, seed: number): FacadeBlock => ({
    id: "b",
    line: { a: [0, 0], b: [length, 0] },
    flipped: false,
    gen: DEFAULT_GEN,
    seed,
    lots: [],
  });

  it("is false for a block at/above the terrace threshold", () => {
    expect(isOpenSpace(block(30, 1))).toBe(false);
  });

  it("matches openFillFor for short blocks", () => {
    for (let seed = 0; seed < 50; seed++) {
      const b = block(6, seed);
      expect(isOpenSpace(b)).toBe(openFillFor(6, seed, MIN) !== null);
    }
  });

  it("finds at least one open (plaza/park) short block across seeds", () => {
    let anyOpen = false;
    for (let seed = 0; seed < 100; seed++) if (isOpenSpace(block(6, seed))) anyOpen = true;
    expect(anyOpen).toBe(true);
  });
});
