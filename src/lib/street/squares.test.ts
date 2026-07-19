import { describe, it, expect } from "vitest";
import {
  deriveSquares,
  isSquareFrontingBlock,
  pruneSquareMonuments,
} from "./squares";
import type { StreetNetwork, Vec2 } from "./types";

const net = (
  streets: StreetNetwork["streets"],
  squares: StreetNetwork["squares"] = [],
): StreetNetwork => ({ streets, roundabouts: [], squares });

// 60×60 ring, counter-clockwise in plan coords
const CCW: Vec2[] = [[0, 0], [60, 0], [60, 60], [0, 60]];
// same ring, clockwise
const CW: Vec2[] = [...CCW].reverse() as Vec2[];

describe("deriveSquares", () => {
  it("a closed loop yields one square with the right centroid and area", () => {
    const sq = deriveSquares(net([{ id: "ring", type: "street", points: CCW, closed: true }]));
    expect(sq).toHaveLength(1);
    expect(sq[0].streetId).toBe("ring");
    expect(sq[0].area).toBeCloseTo(3600);
    expect(sq[0].centroid[0]).toBeCloseTo(30);
    expect(sq[0].centroid[1]).toBeCloseTo(30);
  });

  it("finds the interior side for BOTH windings", () => {
    const ccw = deriveSquares(net([{ id: "a", type: "street", points: CCW, closed: true }]))[0];
    const cw = deriveSquares(net([{ id: "b", type: "street", points: CW, closed: true }]))[0];
    // CCW first segment runs +x along z=0 with the interior at +z: the LEFT
    // normal of (1,0) is (0,1) → interior is left. CW mirrors to right.
    expect(ccw.interiorSide).toBe("left");
    expect(cw.interiorSide).toBe("right");
  });

  it("open streets yield no squares", () => {
    expect(
      deriveSquares(net([{ id: "s", type: "street", points: CCW }])),
    ).toHaveLength(0);
  });

  it("the void guard rejects a loop too small to enclose anything", () => {
    const tiny: Vec2[] = [[0, 0], [15, 0], [15, 15], [0, 15]]; // 225 < 4·10²
    expect(
      deriveSquares(net([{ id: "t", type: "street", points: tiny, closed: true }])),
    ).toHaveLength(0);
  });
});

describe("isSquareFrontingBlock", () => {
  const squares = deriveSquares(
    net([{ id: "ring", type: "street", points: CCW, closed: true }]),
  );

  it("matches an interior-side source block", () => {
    expect(
      isSquareFrontingBlock(
        { source: { streetId: "ring", side: "left" } },
        squares,
      ),
    ).toBe(true);
  });

  it("rejects the outer side, other streets, and hand-drawn blocks", () => {
    expect(
      isSquareFrontingBlock(
        { source: { streetId: "ring", side: "right" } },
        squares,
      ),
    ).toBe(false);
    expect(
      isSquareFrontingBlock(
        { source: { streetId: "other", side: "left" } },
        squares,
      ),
    ).toBe(false);
    expect(isSquareFrontingBlock({}, squares)).toBe(false);
  });
});

describe("pruneSquareMonuments", () => {
  it("keeps a monument on a live loop, drops one whose loop opened", () => {
    const live = net(
      [{ id: "ring", type: "street", points: CCW, closed: true }],
      [["ring", { kind: "fountain" }]],
    );
    expect(pruneSquareMonuments(live).squares).toHaveLength(1);
    const opened = net(
      [{ id: "ring", type: "street", points: CCW }],
      [["ring", { kind: "fountain" }]],
    );
    expect(pruneSquareMonuments(opened).squares).toHaveLength(0);
  });

  it("no entries → input identity", () => {
    const n = net([{ id: "ring", type: "street", points: CCW, closed: true }]);
    expect(pruneSquareMonuments(n)).toBe(n);
  });
});
