import { describe, it, expect } from "vitest";
import { windowInstances, sceneWindowInstances } from "./instancing";
import { computeLayout, type OpeningRect } from "./layout";
import { DEFAULT_FACADE } from "./types";
import { DEFAULT_GEN, type FacadeBlock } from "./blocks";
import type { Ground } from "./terrain";

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

describe("sceneWindowInstances — lot transform × local composition", () => {
  const flat: Ground = { slope: 0, azimuth: 0 };
  const W = DEFAULT_FACADE.width;
  // Vertical line ⇒ dir [0,1] ⇒ rotationY = atan2(-1, 0) = -π/2. Half-length =
  // W/2 each side so the single lot's midpoint lands at world origin [0,0,0].
  const block: FacadeBlock = {
    id: "t1",
    line: { a: [0, -W / 2], b: [0, W / 2] },
    flipped: false,
    gen: DEFAULT_GEN,
    seed: 1,
    lots: [{ params: DEFAULT_FACADE, customized: false }],
  };

  it("places a window's glass at the hand-computed world point", () => {
    const win = computeLayout(DEFAULT_FACADE).openings.find(
      (o) => o.kind === "window",
    )!;
    const cx = win.x + win.w / 2;
    const cy = win.y + win.h / 2;
    // lot origin [0,0,0], yaw -π/2 (cos 0, sin -1); glass local pos is
    // [cx, cy, -GLASS_RECESS-0.02] = [cx, cy, -0.17]. Rotating about Y:
    //   wx = cx·0 + (-0.17)·(-1) = 0.17
    //   wy = cy
    //   wz = -cx·(-1) + (-0.17)·0 = cx
    const glass = sceneWindowInstances([block], flat).filter(
      (i) => i.material === "glass",
    );
    const match = glass.find(
      (g) =>
        Math.abs(g.worldPos[1] - cy) < 1e-6 &&
        Math.abs(g.worldPos[2] - cx) < 1e-6,
    )!;
    expect(match).toBeDefined();
    expect(match.worldPos[0]).toBeCloseTo(0.17, 6);
    expect(match.worldPos[1]).toBeCloseTo(cy, 6);
    expect(match.worldPos[2]).toBeCloseTo(cx, 6);
    expect(match.yaw).toBeCloseTo(-Math.PI / 2, 6);
    expect(match.plane).toBe(true);
  });

  it("emits nonzero glass and trim instances", () => {
    const inst = sceneWindowInstances([block], flat);
    expect(inst.filter((i) => i.material === "glass").length).toBeGreaterThan(0);
    expect(inst.filter((i) => i.material === "trim").length).toBeGreaterThan(0);
  });
});
