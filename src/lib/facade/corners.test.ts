import { describe, it, expect } from "vitest";
import {
  detectCorners,
  syncCorners,
  cornerChoice,
  miterFor,
  SHELL_FIELDS,
  type CornerChoice,
} from "./corners";
import { DEFAULT_GEN, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE } from "./types";
import { WALL_THICKNESS } from "./layout";

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

const rightAngle = () => {
  const A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
  const B = mkBlock("B", [10, 0], [10, 10], [4, 6]);
  A.lots[1].params = {
    ...A.lots[1].params,
    storeys: 4,
    wallColor: "#111111",
    ornament: { cornice: true, parapet: true, sills: false, surrounds: true },
  };
  return { A, B };
};

describe("cornerChoice", () => {
  it("defaults to two-facades with the wider frontage as primary", () => {
    const { A, B } = rightAngle(); // A end lot 5m, B end lot 4m
    const [c] = detectCorners([A, B], 150);
    expect(cornerChoice(new Map(), c, [A, B])).toEqual({
      mode: "two-facades",
      primary: "a",
    });
  });
});

describe("syncCorners", () => {
  it("copies the shell from the edited side; face fields stay per-side", () => {
    const { A, B } = rightAngle();
    const out = syncCorners([A, B], new Map(), 150, "A");
    const bLot = out[1].lots[0].params;
    expect(bLot.storeys).toBe(4);
    expect(bLot.wallColor).toBe("#111111");
    expect(bLot.ornament).toEqual(A.lots[1].params.ornament);
    // face untouched (two-facades default)
    expect(bLot.bays).toBe(B.lots[0].params.bays);
    expect(bLot.groundFloor).toEqual(B.lots[0].params.groundFloor);
    expect(bLot.width).toBe(4); // width never copied
    // non-corner lots byte-identical
    expect(out[0].lots[0]).toBe(A.lots[0]);
    expect(out[1].lots[1]).toBe(B.lots[1]);
  });

  it("flows from the primary when no edited side is given", () => {
    const { A, B } = rightAngle();
    const out = syncCorners([A, B], new Map(), 150);
    expect(out[1].lots[0].params.storeys).toBe(4); // primary = a (wider)
  });

  it("unified mode mirrors ratios, groundFloor, and bay rhythm (never cellOverrides)", () => {
    const { A, B } = rightAngle();
    const src = A.lots[1].params;
    A.lots[1].params = {
      ...src,
      bays: 2, // 5m / 2 bays = 2.5m rhythm
      windowWidthRatio: 0.61,
      windowHeightRatio: 0.44,
      groundFloor: { treatment: "shopfront", doorBay: 1, stoop: false },
      cellOverrides: [{ storey: 1, bay: 0, kind: "blank" }],
    };
    const [c] = detectCorners([A, B], 150);
    const choices = new Map<string, CornerChoice>([
      [c.key, { mode: "unified", primary: "a" }],
    ]);
    const out = syncCorners([A, B], choices, 150, "A");
    const bLot = out[1].lots[0].params;
    expect(bLot.bays).toBe(2); // round(4 / 2.5) = 2
    expect(bLot.windowWidthRatio).toBe(0.61);
    expect(bLot.groundFloor.treatment).toBe("shopfront");
    expect(bLot.groundFloor.doorBay).toBe(1); // clamped to bays-1 = 1
    expect(bLot.cellOverrides).toEqual(B.lots[0].params.cellOverrides);
  });

  it("zeroes depthOffset on corner lots only; preserves customized flags", () => {
    const { A, B } = rightAngle();
    A.lots[0].depthOffset = 0.05;
    A.lots[1].depthOffset = 0.08;
    B.lots[0].depthOffset = -0.06;
    B.lots[0].customized = true;
    const out = syncCorners([A, B], new Map(), 150, "A");
    expect(out[0].lots[0].depthOffset).toBe(0.05); // non-corner untouched
    expect(out[0].lots[1].depthOffset).toBe(0);
    expect(out[1].lots[0].depthOffset).toBe(0);
    expect(out[1].lots[0].customized).toBe(true); // sync never flips pins
  });

  it("is idempotent and returns the input array identity when nothing changes", () => {
    const { A, B } = rightAngle();
    const once = syncCorners([A, B], new Map(), 150, "A");
    const twice = syncCorners(once, new Map(), 150, "A");
    expect(twice).toBe(once);
  });

  it("no corners -> input identity", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const blocks = [A];
    expect(syncCorners(blocks, new Map(), 150)).toBe(blocks);
  });

  it("SHELL_FIELDS is exactly what syncCorners copies (two-facades mode)", () => {
    const { A, B } = rightAngle();
    const out = syncCorners([A, B], new Map(), 150, "A");
    const src = out[0].lots[1].params;
    const dst = out[1].lots[0].params;
    for (const f of SHELL_FIELDS) {
      expect(dst[f]).toEqual(src[f]);
    }
    // and the face stays independent:
    expect(dst.bays).toBe(B.lots[0].params.bays);
  });

  const chain = () => {
    // D—C—E : C is a single-lot chamfer block bridging two corners.
    const D = mkBlock("D", [0, 0], [10, 0], [10]);
    D.lots[0].params = { ...D.lots[0].params, storeys: 5, wallColor: "#222222" };
    const C = mkBlock("C", [10, 0], [14, 4], [5.65685424949238]);
    const E = mkBlock("E", [14, 4], [14, 14], [10]);
    return { D, C, E };
  };

  it("chains propagate the edited shell through shared blocks", () => {
    const { D, C, E } = chain();
    const out = syncCorners([D, C, E], new Map(), 150, "D");
    expect(out[1].lots[0].params.storeys).toBe(5);
    expect(out[2].lots[0].params.storeys).toBe(5);
    expect(out[2].lots[0].params.wallColor).toBe("#222222");
  });

  it("chains are idempotent with identity return", () => {
    const { D, C, E } = chain();
    const once = syncCorners([D, C, E], new Map(), 150, "D");
    expect(syncCorners(once, new Map(), 150, "D")).toBe(once);
    // and with no edited block:
    const again = syncCorners(once, new Map(), 150);
    expect(syncCorners(again, new Map(), 150)).toBe(again);
  });

  it("no-edit chain sync is deterministic from the first corner's primary", () => {
    const { D, C, E } = chain();
    const r1 = syncCorners([D, C, E], new Map(), 150);
    const r2 = syncCorners([D, C, E], new Map(), 150);
    expect(r1.map((b) => b.lots[0].params.storeys)).toEqual(
      r2.map((b) => b.lots[0].params.storeys),
    );
  });
});

describe("miterFor", () => {
  it("convex right angle: side a extends by tan(45°)·T = T; side b untouched", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [10, 10], [10]);
    const [c] = detectCorners([A, B], 150);
    const m = miterFor(c);
    expect(m.a).toBeCloseTo(WALL_THICKNESS, 9);
    expect(m.b).toBe(0);
  });

  it("concave right angle: side a trims (negative, half depth)", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B2 = mkBlock("B2", [10, 0], [10, -10], [10]);
    const [c] = detectCorners([A, B2], 150);
    const m = miterFor(c);
    // At 90°, tan(45°)·T/2 = 0.175 > 0.12 → capped: CONCAVE_TRIM_MAX
    expect(m.a).toBeCloseTo(-0.12, 9);
    expect(m.b).toBe(0);
  });

  it("concave trims never exceed the opening-safe cap", () => {
    // Sharp concave turn: uncapped trim would be far above 0.12.
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [1, -1], [10]);
    const corners = detectCorners([A, B], 179);
    expect(corners).toHaveLength(1);
    expect(corners[0].convex).toBe(false);
    const m = miterFor(corners[0]);
    expect(m.a).toBeLessThan(0);
    expect(Math.abs(m.a)).toBeLessThanOrEqual(0.12 + 1e-12);
  });

  it("straight through: no correction", () => {
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [20, 0], [10]);
    const [c] = detectCorners([A, B], 150);
    expect(miterFor(c)).toEqual({ a: 0, b: 0 });
  });

  it("clamps at extreme turns", () => {
    // Near-hairpin: B doubles back toward A's start -> turn ≈ 177°,
    // tan(turn/2)·T ≈ 38·T, clamped to 3·T.
    const A = mkBlock("A", [0, 0], [10, 0], [10]);
    const B = mkBlock("B", [10, 0], [0, 0.5], [10]);
    const [c] = detectCorners([A, B], 179);
    expect(c.turn).toBeGreaterThan(170);
    const m = miterFor(c);
    expect(Math.abs(m.a)).toBeCloseTo(3 * WALL_THICKNESS, 9);
  });
});

describe("syncCorners section flattening", () => {
  const withSections = (
    b: FacadeBlock,
    lotIndex: number,
    sections: { bays: number; offset: number }[],
    symmetrical = false,
  ): FacadeBlock => ({
    ...b,
    lots: b.lots.map((l, i) =>
      i === lotIndex
        ? {
            ...l,
            params: {
              ...l.params,
              bays: 3,
              sections,
              sectionsSymmetrical: symmetrical,
            },
          }
        : l,
    ),
  });

  it("zeroes the corner-side end section's offset on both sides", () => {
    let A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
    let B = mkBlock("B", [10, 0], [10, 10], [5, 5]);
    // A's corner lot is index 1, corner at its RIGHT end
    A = withSections(A, 1, [
      { bays: 1, offset: 0.1 },
      { bays: 1, offset: 0 },
      { bays: 1, offset: -0.1 },
    ]);
    // B's corner lot is index 0, corner at its LEFT end
    B = withSections(B, 0, [
      { bays: 1, offset: 0.12 },
      { bays: 2, offset: 0 },
    ]);
    const out = syncCorners([A, B], new Map(), 150);
    const aSecs = out[0].lots[1].params.sections!;
    expect(aSecs.map((s) => s.offset)).toEqual([0.1, 0, 0]); // right end zeroed
    const bSecs = out[1].lots[0].params.sections!;
    expect(bSecs.map((s) => s.offset)).toEqual([0, 0]); // left end zeroed
  });

  it("symmetric corner lot zeroes stored[0] (resolve mirrors it to the far end)", () => {
    let A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
    const B = mkBlock("B", [10, 0], [10, 10], [5, 5]);
    A = withSections(
      A,
      1,
      [
        { bays: 1, offset: 0.1 },
        { bays: 1, offset: -0.1 },
        { bays: 1, offset: 0.1 },
      ],
      true,
    );
    const out = syncCorners([A, B], new Map(), 150);
    const secs = out[0].lots[1].params.sections!;
    expect(secs[0].offset).toBe(0);
    expect(secs[1].offset).toBe(-0.1); // middle relief survives
  });

  it("is idempotent and returns identity when end sections are already flush", () => {
    let A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
    const B = mkBlock("B", [10, 0], [10, 10], [5, 5]);
    A = withSections(A, 1, [
      { bays: 2, offset: 0 },
      { bays: 1, offset: 0 },
    ]);
    const once = syncCorners([A, B], new Map(), 150);
    const twice = syncCorners(once, new Map(), 150);
    expect(twice).toBe(once);
  });

  it("non-corner lots keep their sections untouched", () => {
    let A = mkBlock("A", [0, 0], [10, 0], [5, 5]);
    const B = mkBlock("B", [10, 0], [10, 10], [5, 5]);
    A = withSections(A, 0, [
      { bays: 1, offset: 0.15 },
      { bays: 2, offset: -0.15 },
    ]);
    const before = A.lots[0].params.sections;
    const out = syncCorners([A, B], new Map(), 150);
    expect(out[0].lots[0].params.sections).toBe(before);
  });
});
