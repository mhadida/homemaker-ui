import { describe, it, expect } from "vitest";
import { windowInstances } from "./instancing";
import type { OpeningRect } from "./layout";

const op = (x: number, y: number, w: number, h: number): OpeningRect => ({
  kind: "window", storey: 0, bay: 0, x, y, w, h,
});

describe("windowInstances — mirrors FacadeMesh.WindowFill", () => {
  it("plain window: 1 glass plane + 4 trim frame members, no bars", () => {
    const inst = windowInstances(op(0, 0, 1, 2), "none");
    expect(inst.filter((i) => i.material === "glass")).toHaveLength(1);
    expect(inst.filter((i) => i.material === "trim")).toHaveLength(4);
    expect(inst[0].plane).toBe(true);
  });

  it("glass centres on the opening, recessed behind the wall face", () => {
    const inst = windowInstances(op(2, 1, 1.2, 1.8), "none");
    const glass = inst.find((i) => i.material === "glass")!;
    expect(glass.pos[0]).toBeCloseTo(2.6, 6); // cx = 2 + 1.2/2
    expect(glass.pos[1]).toBeCloseTo(1.9, 6); // cy = 1 + 1.8/2
    expect(glass.pos[2]).toBeLessThan(0); // recessed
    expect(glass.size).toEqual([1.2, 1.8, 0]);
  });

  it("sash adds a mullion + meeting rail (2 bars); victorian adds 1", () => {
    expect(windowInstances(op(0, 0, 1, 2), "sash").filter((i) => i.material === "trim")).toHaveLength(4 + 2);
    expect(windowInstances(op(0, 0, 1, 2), "victorian").filter((i) => i.material === "trim")).toHaveLength(4 + 1);
  });

  it("georgian: 2 vertical bars + (rows-1) horizontals for a tall pane", () => {
    // w=1,h=2 → rows = max(2, round(2/(1/3))) = 6 → 2 vertical + 5 horizontal = 7 bars
    const bars = windowInstances(op(0, 0, 1, 2), "georgian").filter((i) => i.material === "trim").length - 4;
    expect(bars).toBe(7);
  });
});
