import { describe, it, expect } from "vitest";
import { syncStreetBlocks } from "./streetBlocks";
import { DEFAULT_GEN, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE } from "./types";
import type { StreetNetwork, Vec2 } from "../street/types";

const net = (streets: StreetNetwork["streets"]): StreetNetwork => ({ streets, roundabouts: [] });
const S = (id: string, pts: Vec2[]) => ({ id, type: "street" as const, points: pts });
const OPTS = { gen: DEFAULT_GEN, setback: 3, maxCornerAngle: 150, cornerChoices: new Map() };

describe("syncStreetBlocks", () => {
  it("generates source-tagged frontage blocks for a new street (both sides)", () => {
    const out = syncStreetBlocks(net([S("s1", [[0, 0], [30, 0]])]), [], OPTS);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.every((b) => b.source?.streetId === "s1")).toBe(true);
    expect(new Set(out.map((b) => b.source!.side))).toEqual(new Set(["left", "right"]));
    expect(out.every((b) => b.lots.length > 0)).toBe(true);
  });

  it("never touches hand-drawn (source-less) blocks", () => {
    const hand: FacadeBlock = {
      id: "hand-1", line: { a: [0, 50], b: [10, 50] }, flipped: false,
      gen: DEFAULT_GEN, seed: 1, lots: [{ params: { ...DEFAULT_FACADE, width: 10 }, customized: false }],
    };
    const out = syncStreetBlocks(net([S("s1", [[0, 0], [30, 0]])]), [hand], OPTS);
    expect(out.find((b) => b.id === "hand-1")).toEqual(hand);
  });

  it("removes a street's blocks when the street is gone", () => {
    const first = syncStreetBlocks(net([S("s1", [[0, 0], [30, 0]])]), [], OPTS);
    const after = syncStreetBlocks(net([]), first, OPTS);
    expect(after.some((b) => b.source?.streetId === "s1")).toBe(false);
  });

  it("refits a moved street's blocks and PINS a customized lot", () => {
    const first = syncStreetBlocks(net([S("s1", [[0, 0], [30, 0]])]), [], OPTS);
    // pin lot 0 of the first frontage block
    const pinned = first.map((b, k) =>
      k === 0 ? { ...b, lots: b.lots.map((l, i) => (i === 0 ? { ...l, customized: true } : l)) } : b,
    );
    const moved = syncStreetBlocks(net([S("s1", [[0, 0], [24, 0]])]), pinned, OPTS);
    const b0 = moved.find((b) => b.id === first[0].id)!;
    expect(b0.lots.some((l) => l.customized)).toBe(true); // pin survived the refit
  });
});

describe("syncStreetBlocks — refits from the moved end", () => {
  it("an a-side street move preserves a pin at the far (b) end and converges length", () => {
    const first = syncStreetBlocks(net([S("s1", [[0, 0], [30, 0]])]), [], OPTS);
    const id0 = first[0].id;
    // pin the LAST lot (near the b end) of the first frontage block
    const pinned = first.map((b) =>
      b.id === id0
        ? { ...b, lots: b.lots.map((l, i, arr) => (i === arr.length - 1 ? { ...l, customized: true } : l)) }
        : b,
    );
    // move ONLY the street's a-vertex (0 → 6); b fixed at 30
    const moved = syncStreetBlocks(net([S("s1", [[6, 0], [30, 0]])]), pinned, OPTS);
    const b0 = moved.find((b) => b.id === id0)!;
    expect(b0.lots.some((l) => l.customized)).toBe(true); // pin survived the a-side move
    const len = Math.hypot(b0.line.b[0] - b0.line.a[0], b0.line.b[1] - b0.line.a[1]);
    const sum = b0.lots.reduce((s, l) => s + l.params.width, 0);
    expect(sum).toBeCloseTo(len, 4); // refit converged to the new length
  });
});
