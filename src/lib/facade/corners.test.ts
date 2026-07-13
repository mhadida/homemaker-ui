import { describe, it, expect } from "vitest";
import { detectCorners } from "./corners";
import { DEFAULT_GEN, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE } from "./types";

const mkBlock = (
  id: string,
  a: [number, number],
  b: [number, number],
  widths: number[],
  flipped = false,
): FacadeBlock => ({
  id,
  line: { a, b },
  flipped,
  gen: structuredClone(DEFAULT_GEN),
  seed: 7,
  lots: widths.map((w) => ({
    params: { ...DEFAULT_FACADE, width: w },
    customized: false,
  })),
});

describe("detectCorners", () => {
  it("right-angle weld of two blocks is one corner with turn 90", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
    const B = mkBlock("B", [10, 0], [10, 10], [5, 5]);
    const corners = detectCorners([A, B], 150);
    expect(corners).toHaveLength(1);
    const c = corners[0];
    expect(c.turn).toBeCloseTo(90, 6);
    expect(c.node).toEqual([10, 0]);
    // sides sorted by blockId:end — A:b before B:a
    expect(c.a).toEqual({ blockId: "A", end: "b", lotIndex: 1, lotSide: "right" });
    expect(c.b).toEqual({ blockId: "B", end: "a", lotIndex: 0, lotSide: "left" });
    expect(c.key).toBe("A:b|B:a");
  });

  it("respects the max turn threshold (boundary inclusive)", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [10, 10], [10]);
    expect(detectCorners([A, B], 90)).toHaveLength(1);
    expect(detectCorners([A, B], 89.99)).toHaveLength(0);
  });

  it("straight-through weld has turn 0", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [20, 0], [10]);
    const [c] = detectCorners([A, B], 150);
    expect(c.turn).toBeCloseTo(0, 6);
  });

  it("flipped blocks resolve lotIndex/lotSide via the frame, not raw ends", () => {
    // Both flipped: A's frame origin = line.b = (10,0) -> node at ORIGIN,
    // lot 0 / left; B's frame origin = line.b = (10,10) -> node at END,
    // lot 1 / right.
    const A = mkBlock("A", [0, 0], [10, 0], [5, 5], true);
    const B = mkBlock("B", [10, 0], [10, 10], [5, 5], true);
    const [c] = detectCorners([A, B], 150);
    expect(c.a).toEqual({ blockId: "A", end: "b", lotIndex: 0, lotSide: "left" });
    expect(c.b).toEqual({ blockId: "B", end: "a", lotIndex: 1, lotSide: "right" });
  });

  it("convexity: facades wrapping the outer corner are convex; back-to-back are not", () => {
    // A faces +z (normal [0,1]); B along +z from the node faces -x.
    // Streets share the x<10, z>0 quadrant -> convex (outer corner).
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [10, 10], [10]);
    expect(detectCorners([A, B], 150)[0].convex).toBe(true);
    // B2 runs the other way (toward -z): its facade faces +x, away from
    // A's street -> building interiors interpenetrate -> concave.
    const B2 = mkBlock("B2", [10, 0], [10, -10], [10]);
    expect(detectCorners([A, B2], 150)[0].convex).toBe(false);
  });

  it("3-way junctions and free endpoints never merge", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [10, 10], [10]);
    const C = mkBlock("C", [10, 0], [20, 0], [10]);
    expect(detectCorners([A, B, C], 180)).toHaveLength(0);
    expect(detectCorners([A], 180)).toHaveLength(0);
  });

  it("a two-block closed loop yields two corners with distinct keys", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [0, 0], [10]);
    const corners = detectCorners([A, B], 180);
    expect(corners).toHaveLength(2);
    expect(new Set(corners.map((c) => c.key)).size).toBe(2);
  });

  it("key is stable under node drag (same blocks/ends, moved coordinates)", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [10, 10], [10]);
    const k1 = detectCorners([A, B], 150)[0].key;
    const A2 = { ...A, line: { a: [0, 0] as [number, number], b: [11, 2] as [number, number] } };
    const B2 = { ...B, line: { a: [11, 2] as [number, number], b: [10, 10] as [number, number] } };
    const k2 = detectCorners([A2, B2], 150)[0].key;
    expect(k2).toBe(k1);
  });

  it("mixed flip parity (discontinuous frontage) never merges", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [10, 10], [10], true); // flipped
    expect(detectCorners([A, B], 180)).toHaveLength(0);
  });

  it("convexity is invariant under block relabeling", () => {
    const mk = (idA: string, idB: string) => {
      const A = mkBlock(idA, [0, 0], [10, 0], [10]);
      const B = mkBlock(idB, [10, 0], [10, 10], [10]);
      return detectCorners([A, B], 150)[0].convex;
    };
    expect(mk("A", "B")).toBe(mk("Z", "AA")); // sort order swaps sides
  });

  it("both-flipped chains stay continuous and merge", () => {
    // Flipping BOTH blocks keeps parity opposite -> still a corner.
    const A = mkBlock("A", [0, 0], [10, 0], [10], true);
    const B = mkBlock("B", [10, 0], [10, 10], [10], true);
    const corners = detectCorners([A, B], 150);
    expect(corners).toHaveLength(1);
  });
});
