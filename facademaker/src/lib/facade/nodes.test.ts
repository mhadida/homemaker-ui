import { describe, it, expect } from "vitest";
import { deriveNodes, moveNode } from "./nodes";
import {
  syncLineToLots,
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

describe("deriveNodes", () => {
  it("clusters exactly-equal endpoints into one node with both refs", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const b2 = mkBlock("b2", [11, 0], [22, 0], [5, 6]);
    const nodes = deriveNodes([b1, b2]);
    expect(nodes).toHaveLength(3);
    const shared = nodes.find((n) => n.pos[0] === 11 && n.pos[1] === 0)!;
    expect(shared.refs).toEqual([
      { blockId: "b1", end: "b" },
      { blockId: "b2", end: "a" },
    ]);
  });

  it("keeps distinct endpoints separate (exact equality, no epsilon)", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const b2 = mkBlock("b2", [11.001, 0], [22, 0], [5, 6]);
    expect(deriveNodes([b1, b2])).toHaveLength(4);
  });
});

describe("moveNode", () => {
  it("moves every welded endpoint and refits both blocks", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const b2 = mkBlock("b2", [11, 0], [22, 0], [5, 6]);
    const out = moveNode([b1, b2], [11, 0], [13, 0])!;
    expect(out[0].line.b).toEqual([13, 0]);
    expect(out[1].line.a).toEqual([13, 0]);
    expect(out[0].lots.map((l) => l.params.width)).toEqual([5, 8]);
    // b2 shrank 11 → 9: head lot 5 − 2 = 3 < min → removed, folds → [9]
    expect(out[1].lots.map((l) => l.params.width)).toEqual([9]);
  });

  it("returns null when any attached block cannot absorb", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const b2 = mkBlock("b2", [11, 0], [22, 0], [5, 6], [true, true]);
    expect(moveNode([b1, b2], [11, 0], [13, 0])).toBeNull();
  });

  it("returns null when no endpoint matches (stale-frame guard)", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    expect(moveNode([b1], [99, 99], [100, 100])).toBeNull();
  });

  it("returns the input array when from equals to", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const blocks = [b1];
    expect(moveNode(blocks, [11, 0], [11, 0])).toBe(blocks);
  });

  it("rejects a move that collapses an attached block to zero length", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const b2 = mkBlock("b2", [11, 0], [22, 0], [5, 6]);
    expect(moveNode([b1, b2], [11, 0], [22, 0])).toBeNull();
  });

  it("width-edit ripple: a syncLineToLots end routed through moveNode refits the neighbor", () => {
    const b1 = mkBlock("b1", [0, 0], [11, 0], [5, 6]);
    const b2 = mkBlock("b2", [11, 0], [22, 0], [5, 6]);
    // Hand-widen b1's lot 1 from 6 to 8 — exactly what page setParams does.
    const lots = b1.lots.map((l, i) =>
      i === 1
        ? { ...l, params: { ...l.params, width: 8 }, customized: true }
        : l,
    );
    const updated = syncLineToLots({ ...b1, lots });
    expect(updated.line.b).toEqual([13, 0]);
    const out = moveNode([updated, b2], [11, 0], updated.line.b)!;
    expect(out[0]).toBe(updated); // edited block untouched by moveNode
    expect(out[1].line.a).toEqual([13, 0]);
    expect(out[1].lots.map((l) => l.params.width)).toEqual([9]);
  });

  it("welds survive around a closed loop; unattached blocks keep identity", () => {
    const b1 = mkBlock("b1", [0, 0], [12, 0], [6, 6]);
    const b2 = mkBlock("b2", [12, 0], [12, 11], [5, 6]);
    const b3 = mkBlock("b3", [12, 11], [0, 0], [8, 8]);
    const out = moveNode([b1, b2, b3], [12, 0], [13, 0])!;
    expect(deriveNodes(out)).toHaveLength(3);
    expect(out[0].line.b).toEqual([13, 0]);
    expect(out[1].line.a).toEqual([13, 0]);
    expect(out[2]).toBe(b3); // not attached — byte-identical
  });
});
