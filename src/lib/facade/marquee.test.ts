import { describe, it, expect } from "vitest";
import {
  normalizeRect,
  hitTest,
  marqueeEmpty,
  affectedBlockIds,
  deleteMarquee,
  translateMarquee,
  type Marquee,
} from "./marquee";
import {
  totalLotsWidth,
  DEFAULT_GEN,
  type FacadeBlock,
} from "./blocks";
import { DEFAULT_FACADE } from "./types";

const mkBlock = (
  id: string,
  a: [number, number],
  b: [number, number],
  widths: number[],
  customized: boolean[] = [],
): FacadeBlock => ({
  id,
  line: { a, b },
  flipped: false,
  gen: structuredClone(DEFAULT_GEN),
  seed: 7,
  lots: widths.map((w, i) => ({
    params: { ...DEFAULT_FACADE, width: w },
    customized: customized[i] ?? false,
  })),
});

describe("normalizeRect", () => {
  it("orders unordered corners into min/max", () => {
    expect(normalizeRect([5, 8], [1, 2])).toEqual({
      x0: 1,
      x1: 5,
      z0: 2,
      z1: 8,
    });
  });
});

describe("marqueeEmpty", () => {
  it("is true only when all three sets are empty", () => {
    expect(marqueeEmpty({ blocks: [], lots: [], nodes: [] })).toBe(true);
    expect(marqueeEmpty({ blocks: ["b"], lots: [], nodes: [] })).toBe(false);
    expect(marqueeEmpty({ blocks: [], lots: ["b:0"], nodes: [] })).toBe(false);
    expect(marqueeEmpty({ blocks: [], lots: [], nodes: [[0, 0]] })).toBe(false);
  });
});

describe("hitTest — enclosure rule", () => {
  it("selects a fully-enclosed block and does NOT double-list its lots/nodes", () => {
    const b = mkBlock("b", [0, 0], [15, 0], [5, 5, 5]);
    const m = hitTest([b], normalizeRect([-1, -1], [16, 1]));
    expect(m.blocks).toEqual(["b"]);
    expect(m.lots).toEqual([]);
    expect(m.nodes).toEqual([]);
  });

  it("selects only the lots whose centers lie inside a partial block", () => {
    const b = mkBlock("b", [0, 0], [15, 0], [5, 5, 5]);
    // Centers at x = 2.5, 7.5, 12.5. Rect covers only the middle center and
    // neither endpoint (0, 15) nor an isolated node.
    const m = hitTest([b], normalizeRect([4, -1], [11, 1]));
    expect(m.blocks).toEqual([]);
    expect(m.lots).toEqual(["b:1"]);
    expect(m.nodes).toEqual([]);
  });

  it("selects a shared node inside a partial junction", () => {
    const b1 = mkBlock("b1", [0, 0], [10, 0], [5, 5]);
    const b2 = mkBlock("b2", [10, 0], [20, 0], [5, 5]);
    const m = hitTest([b1, b2], normalizeRect([8, -1], [12, 1]));
    expect(m.blocks).toEqual([]);
    expect(m.lots).toEqual([]);
    expect(m.nodes).toEqual([[10, 0]]);
  });

  it("a fully-enclosed block subsumes a weld it shares with a partial neighbor", () => {
    const b1 = mkBlock("b1", [0, 0], [10, 0], [5, 5]);
    const b2 = mkBlock("b2", [10, 0], [30, 0], [10, 10]);
    // Encloses b1 fully; reaches just past the shared [10,0] node but no b2
    // lot center (15, 25). The shared node touches enclosed b1 → subsumed.
    const m = hitTest([b1, b2], normalizeRect([-1, -1], [12, 1]));
    expect(m.blocks).toEqual(["b1"]);
    expect(m.lots).toEqual([]);
    expect(m.nodes).toEqual([]);
  });

  it("returns an empty marquee for a rect that catches nothing", () => {
    const b = mkBlock("b", [0, 0], [15, 0], [5, 5, 5]);
    const m = hitTest([b], normalizeRect([100, 100], [110, 110]));
    expect(marqueeEmpty(m)).toBe(true);
  });
});

describe("affectedBlockIds", () => {
  it("unions enclosed blocks, lot blocks, and node-touching blocks", () => {
    const enclosed = mkBlock("e", [0, 0], [10, 0], [5, 5]);
    const partial = mkBlock("p", [0, 20], [20, 20], [10, 10]);
    // A welded junction at [30,0] shared by n1 and n2.
    const n1 = mkBlock("n1", [20, 0], [30, 0], [10]);
    const n2 = mkBlock("n2", [30, 0], [40, 0], [10]);
    const m: Marquee = {
      blocks: ["e"],
      lots: ["p:1"],
      nodes: [[30, 0]],
    };
    const ids = affectedBlockIds(m, [enclosed, partial, n1, n2]);
    expect(ids).toEqual(new Set(["e", "p", "n1", "n2"]));
  });
});

describe("deleteMarquee", () => {
  it("removes a fully-enclosed block", () => {
    const b1 = mkBlock("b1", [0, 0], [10, 0], [5, 5]);
    const b2 = mkBlock("b2", [20, 0], [30, 0], [5, 5]);
    const out = deleteMarquee(
      [b1, b2],
      { blocks: ["b1"], lots: [], nodes: [] },
    );
    expect(out.map((b) => b.id)).toEqual(["b2"]);
  });

  it("removes multiple partial-block lots, keeping indices valid (no split)", () => {
    const b = mkBlock("b", [0, 0], [20, 0], [5, 5, 5, 5]);
    const out = deleteMarquee(
      [b],
      { blocks: [], lots: ["b:1", "b:2"], nodes: [] },
    );
    expect(out).toHaveLength(1);
    // Deleting lots 1 & 2 leaves lots 0 & 3, each absorbing 5 → [10, 10].
    expect(out[0].lots.map((l) => l.params.width)).toEqual([10, 10]);
    expect(totalLotsWidth(out[0])).toBe(20);
  });

  it("keeps a customized survivor exactly when a mid-delete split re-indexes lots", () => {
    // Keep is customized (never resized/deleted); Del1/Del2 are marked. The
    // first deletion splits (9+9 ≥ 14), inserting a fresh lot — a precomputed
    // index would then delete the wrong lot; the marker survives the split.
    const b = mkBlock("b", [0, 0], [24, 0], [6, 9, 9], [true, false, false]);
    const out = deleteMarquee(
      [b],
      { blocks: [], lots: ["b:1", "b:2"], nodes: [] },
    );
    expect(out).toHaveLength(1);
    const keep = out[0].lots.filter(
      (l) => l.customized && l.params.width === 6,
    );
    expect(keep).toHaveLength(1); // the customized lot survived untouched
    expect(totalLotsWidth(out[0])).toBeCloseTo(24, 6); // street length held
  });

  it("drops a block whose every lot is selected", () => {
    const b = mkBlock("b", [0, 0], [10, 0], [5, 5]);
    const out = deleteMarquee(
      [b],
      { blocks: [], lots: ["b:0", "b:1"], nodes: [] },
    );
    expect(out).toEqual([]);
  });

  it("drops a single-lot partial block whose lot is selected", () => {
    const b = mkBlock("b", [0, 0], [30, 0], [30]);
    const out = deleteMarquee(
      [b],
      { blocks: [], lots: ["b:0"], nodes: [] },
    );
    expect(out).toEqual([]);
  });
});

describe("translateMarquee", () => {
  it("returns the input array when the delta is zero", () => {
    const b = mkBlock("b", [0, 0], [10, 0], [5, 5]);
    const blocks = [b];
    expect(translateMarquee(blocks, { blocks: ["b"], lots: [], nodes: [] }, 0, 0)).toBe(
      blocks,
    );
  });

  it("rigidly shifts a fully-enclosed block, preserving length and lots", () => {
    const b = mkBlock("b", [0, 0], [10, 0], [5, 5]);
    const out = translateMarquee(
      [b],
      { blocks: ["b"], lots: [], nodes: [] },
      3,
      4,
    );
    expect(out[0].line.a).toEqual([3, 4]);
    expect(out[0].line.b).toEqual([13, 4]);
    expect(totalLotsWidth(out[0])).toBe(10); // length unchanged (no refit)
    expect(out[0].lots).toBe(b.lots); // lots untouched (rigid translation)
  });

  it("shifts a loose node's endpoint and refits its blocks", () => {
    const b1 = mkBlock("b1", [0, 0], [10, 0], [5, 5]);
    const b2 = mkBlock("b2", [10, 0], [20, 0], [5, 5]);
    const out = translateMarquee(
      [b1, b2],
      { blocks: [], lots: [], nodes: [[10, 0]] },
      2,
      0,
    );
    expect(out[0].line.b).toEqual([12, 0]);
    expect(out[1].line.a).toEqual([12, 0]);
  });
});
