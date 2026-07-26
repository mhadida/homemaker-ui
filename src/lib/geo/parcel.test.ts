import { describe, it, expect } from "vitest";
import type { Vec2 } from "./parcel";
import { CHAIN_TOLERANCE_DEG, edgeChains, parcelArea, signedArea } from "./parcel";

// A unit square wound CCW by the (x, z) shoelace convention.
const SQUARE: Vec2[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const L_SHAPE: Vec2[] = [
  [0, 0],
  [4, 0],
  [4, 1],
  [2, 1],
  [2, 3],
  [0, 3],
];

describe("parcelArea", () => {
  it("measures a unit square", () => {
    expect(parcelArea(SQUARE)).toBeCloseTo(1, 9);
  });

  it("is winding-independent", () => {
    expect(parcelArea([...SQUARE].reverse())).toBeCloseTo(1, 9);
  });

  it("measures a non-convex L correctly (12 - 4 = 8)", () => {
    expect(parcelArea(L_SHAPE)).toBeCloseTo(8, 9);
  });

  it("is zero for a degenerate outline", () => {
    expect(
      parcelArea([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toBeCloseTo(0, 9);
  });
});

describe("signedArea", () => {
  it("is positive for CCW and negative for CW", () => {
    expect(signedArea(SQUARE)).toBeGreaterThan(0);
    expect(signedArea([...SQUARE].reverse())).toBeLessThan(0);
  });
});

describe("edgeChains", () => {
  it("gives one chain per side of a rectangle", () => {
    expect(edgeChains(SQUARE)).toHaveLength(4);
  });

  it("merges a collinear midpoint back into its side", () => {
    // Same square, but the bottom edge is split by an extra vertex.
    const split: Vec2[] = [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const chains = edgeChains(split);
    expect(chains).toHaveLength(4);
    const bottom = chains.find((c) => c.idx.length === 2);
    expect(bottom).toBeDefined();
    expect(bottom!.a).toEqual([0, 0]);
    expect(bottom!.b).toEqual([1, 0]);
  });

  it("gives six chains for an L-shape", () => {
    expect(edgeChains(L_SHAPE)).toHaveLength(6);
  });

  it("merges just inside the tolerance and splits just outside it", () => {
    const at = (deg: number): Vec2[] => {
      const r = (deg * Math.PI) / 180;
      // Two edges meeting at `deg` of turn, closed by a return leg.
      return [
        [0, 0],
        [10, 0],
        [10 + 10 * Math.cos(r), 10 * Math.sin(r)],
        [5, -8],
      ];
    };
    const inside = edgeChains(at(CHAIN_TOLERANCE_DEG - 1));
    const outside = edgeChains(at(CHAIN_TOLERANCE_DEG + 1));
    expect(outside.length).toBeGreaterThan(inside.length);
  });

  it("gives the same chain count for both windings", () => {
    expect(edgeChains([...L_SHAPE].reverse())).toHaveLength(
      edgeChains(L_SHAPE).length,
    );
  });

  it("returns one chain per edge for a smooth ring with no corner", () => {
    // A 36-gon turns 10 degrees at every vertex — inside the 20 degree
    // tolerance everywhere, so there is no natural break to start from.
    const ring: Vec2[] = Array.from({ length: 36 }, (_, i) => {
      const t = (i / 36) * Math.PI * 2;
      return [Math.cos(t) * 10, Math.sin(t) * 10] as Vec2;
    });
    const chains = edgeChains(ring);
    expect(chains).toHaveLength(36);
    // Critically, none of them is a zero-length wrap-around.
    for (const c of chains) {
      expect(Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1])).toBeGreaterThan(0.1);
    }
  });

  it("returns nothing for fewer than three vertices", () => {
    expect(
      edgeChains([
        [0, 0],
        [1, 0],
      ]),
    ).toEqual([]);
  });
});
