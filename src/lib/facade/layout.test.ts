import { describe, it, expect } from "vitest";
import { computeLayout, resolveGrid, type OpeningRect } from "./layout";
import { DEFAULT_FACADE, type FacadeParams } from "./types";

function p(overrides: Partial<FacadeParams>): FacadeParams {
  return { ...DEFAULT_FACADE, ...overrides };
}

describe("resolveGrid", () => {
  it("upper storeys default to windows", () => {
    const grid = resolveGrid(p({ storeys: 3, bays: 3 }));
    expect(grid).toHaveLength(3);
    expect(grid[1]).toEqual(["window", "window", "window"]);
    expect(grid[2]).toEqual(["window", "window", "window"]);
  });

  it("residential ground row: door at doorBay, windows elsewhere", () => {
    const grid = resolveGrid(
      p({
        bays: 3,
        groundFloor: { treatment: "residential", doorBay: 1, stoop: false },
      }),
    );
    expect(grid[0]).toEqual(["window", "door", "window"]);
  });

  it("shopfront ground row: shopfront everywhere except the door bay", () => {
    const grid = resolveGrid(
      p({
        bays: 3,
        groundFloor: { treatment: "shopfront", doorBay: 0, stoop: false },
      }),
    );
    expect(grid[0]).toEqual(["door", "shopfront", "shopfront"]);
  });

  it("garage ground row: garage at doorBay, windows elsewhere", () => {
    const grid = resolveGrid(
      p({
        bays: 3,
        groundFloor: { treatment: "garage", doorBay: 2, stoop: false },
      }),
    );
    expect(grid[0]).toEqual(["window", "window", "garage"]);
  });

  it("out-of-range doorBay clamps to the last bay", () => {
    const grid = resolveGrid(
      p({
        bays: 2,
        groundFloor: { treatment: "residential", doorBay: 7, stoop: false },
      }),
    );
    expect(grid[0]).toEqual(["window", "door"]);
  });

  it("cellOverrides patch individual cells", () => {
    const grid = resolveGrid(
      p({
        storeys: 2,
        bays: 2,
        cellOverrides: [{ storey: 1, bay: 0, kind: "blank" }],
      }),
    );
    expect(grid[1][0]).toBe("blank");
    expect(grid[1][1]).toBe("window");
  });

  it("out-of-range overrides are ignored", () => {
    const grid = resolveGrid(
      p({
        storeys: 2,
        bays: 2,
        cellOverrides: [
          { storey: 5, bay: 0, kind: "blank" },
          { storey: 0, bay: 9, kind: "blank" },
          { storey: -1, bay: 0, kind: "blank" },
        ],
      }),
    );
    expect(grid.flat()).not.toContain("blank");
  });
});

function rectsOverlap(a: OpeningRect, b: OpeningRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function invariants(params: FacadeParams) {
  const layout = computeLayout(params);
  for (const o of layout.openings) {
    // inside the wall, with tolerance for float noise
    expect(o.x).toBeGreaterThanOrEqual(-layout.width / 2 - 1e-9);
    expect(o.x + o.w).toBeLessThanOrEqual(layout.width / 2 + 1e-9);
    expect(o.y).toBeGreaterThanOrEqual(-1e-9);
    expect(o.y + o.h).toBeLessThanOrEqual(layout.wallTop + 1e-9);
    expect(o.w).toBeGreaterThan(0);
    expect(o.h).toBeGreaterThan(0);
  }
  for (let i = 0; i < layout.openings.length; i++) {
    for (let j = i + 1; j < layout.openings.length; j++) {
      expect(
        rectsOverlap(layout.openings[i], layout.openings[j]),
        `openings ${i} and ${j} overlap`,
      ).toBe(false);
    }
  }
  if (layout.stoop) {
    expect(layout.stoop.x).toBeGreaterThanOrEqual(-layout.width / 2 - 1e-9);
    expect(layout.stoop.x + layout.stoop.w).toBeLessThanOrEqual(
      layout.width / 2 + 1e-9,
    );
  }
  return layout;
}

describe("computeLayout", () => {
  it("default params satisfy all invariants", () => {
    const layout = invariants(DEFAULT_FACADE);
    expect(layout.storeyLevels).toHaveLength(DEFAULT_FACADE.storeys + 1);
    expect(layout.wallTop).toBeCloseTo(
      layout.storeyLevels[DEFAULT_FACADE.storeys],
      9,
    );
  });

  it("the door lands in doorBay", () => {
    const layout = computeLayout(
      p({ bays: 3, groundFloor: { treatment: "residential", doorBay: 2, stoop: false } }),
    );
    const door = layout.openings.find((o) => o.kind === "door");
    expect(door).toBeDefined();
    expect(door!.bay).toBe(2);
    expect(door!.y).toBe(0); // no stoop → threshold at sidewalk level
  });

  it("stoop raises the door threshold by the total rise", () => {
    const layout = computeLayout(
      p({ groundFloor: { treatment: "residential", doorBay: 0, stoop: true } }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    expect(door.y).toBeCloseTo(0.3, 9); // STOOP_RISE 0.15 × STOOP_STEPS 2
    expect(layout.stoop).not.toBeNull();
    expect(layout.stoop!.x).toBeLessThan(door.x);
    expect(layout.stoop!.x + layout.stoop!.w).toBeGreaterThan(door.x + door.w);
  });

  it("a blank override removes that cell's opening", () => {
    const layout = computeLayout(
      p({ cellOverrides: [{ storey: 1, bay: 1, kind: "blank" }] }),
    );
    expect(
      layout.openings.find((o) => o.storey === 1 && o.bay === 1),
    ).toBeUndefined();
  });

  it("extreme narrow bays (width 4, 9 bays) skip degenerate openings but never crash", () => {
    invariants(p({ width: 4, bays: 9 }));
  });

  it("max window ratios keep a pier between adjacent windows", () => {
    const layout = invariants(
      p({ windowWidthRatio: 0.8, windowHeightRatio: 0.8, bays: 4 }),
    );
    const row = layout.openings
      .filter((o) => o.storey === 1)
      .sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].x - (row[i - 1].x + row[i - 1].w);
      expect(gap).toBeGreaterThanOrEqual(0.3 - 1e-9); // MIN_PIER
    }
  });

  it("shopfront glazing fills the bay minus a party-wall pier and fascia", () => {
    const params = p({
      width: 9,
      bays: 3,
      groundFloor: { treatment: "shopfront", doorBay: 1, stoop: false },
    });
    const layout = invariants(params);
    const shops = layout.openings.filter((o) => o.kind === "shopfront");
    expect(shops).toHaveLength(2);
    const left = shops.find((o) => o.bay === 0)!;
    expect(left.x).toBeCloseTo(-4.5 + 0.3, 9); // party edge keeps MIN_PIER
    const storeyH = layout.storeyLevels[1] - layout.storeyLevels[0];
    expect(left.h).toBeCloseTo(storeyH - 0.5, 9); // SHOPFRONT_FASCIA
  });

  it("ornament toggles populate/clear their layout entries", () => {
    const on = computeLayout(
      p({ ornament: { cornice: true, parapet: true, sills: true, surrounds: true } }),
    );
    expect(on.cornice).not.toBeNull();
    expect(on.parapet).not.toBeNull();
    expect(on.sills.length).toBeGreaterThan(0);
    expect(on.surrounds.length).toBeGreaterThan(0);
    expect(on.totalHeight).toBeGreaterThan(on.wallTop);

    const off = computeLayout(
      p({ ornament: { cornice: false, parapet: false, sills: false, surrounds: false } }),
    );
    expect(off.cornice).toBeNull();
    expect(off.parapet).toBeNull();
    expect(off.sills).toHaveLength(0);
    expect(off.surrounds).toHaveLength(0);
    expect(off.totalHeight).toBeCloseTo(off.wallTop, 9);
  });

  it("parapet sits on top of the cornice when both are enabled", () => {
    const layout = computeLayout(
      p({ ornament: { cornice: true, parapet: true, sills: false, surrounds: false } }),
    );
    expect(layout.parapet!.y).toBeCloseTo(
      layout.cornice!.y + layout.cornice!.height,
      9,
    );
  });

  it("short storeys (2.2m) still produce valid windows", () => {
    invariants(p({ storeyHeight: 2.2, storeyHeights: [2.2, 2.2, 2.2] }));
  });

  it("stoop clamps to the wall bounds when the door sits near a party edge", () => {
    const layout = invariants(
      p({
        width: 5,
        bays: 9,
        groundFloor: { treatment: "residential", doorBay: 0, stoop: true },
      }),
    );
    expect(layout.stoop).not.toBeNull();
  });

  it("shopfront piers stay >= MIN_PIER next to a non-shopfront neighbor", () => {
    const params = p({
      width: 5,
      bays: 9,
      groundFloor: { treatment: "shopfront", doorBay: 4, stoop: false },
    });
    const layout = invariants(params);
    const ground = layout.openings.filter((o) => o.storey === 0).sort((a, b) => a.x - b.x);
    const door = ground.find((o) => o.kind === "door")!;
    expect(door).toBeDefined();
    const doorIndex = ground.indexOf(door);
    const leftNeighbor = ground[doorIndex - 1];
    const rightNeighbor = ground[doorIndex + 1];
    if (leftNeighbor) {
      const gap = door.x - (leftNeighbor.x + leftNeighbor.w);
      expect(gap).toBeGreaterThanOrEqual(0.3 - 1e-9); // MIN_PIER
    }
    if (rightNeighbor) {
      const gap = rightNeighbor.x - (door.x + door.w);
      expect(gap).toBeGreaterThanOrEqual(0.3 - 1e-9); // MIN_PIER
    }
  });

  it("garage treatment produces a single garage opening at doorBay", () => {
    const layout = invariants(
      p({ groundFloor: { treatment: "garage", doorBay: 1, stoop: false } }),
    );
    const garages = layout.openings.filter(
      (o) => o.kind === "garage" && o.storey === 0,
    );
    expect(garages).toHaveLength(1);
    const garage = garages[0];
    expect(garage.bay).toBe(1);
    expect(garage.y).toBe(0);
    expect(garage.h).toBeLessThanOrEqual(2.4); // GARAGE_HEIGHT_MAX
    expect(garage.w).toBeLessThanOrEqual(2.6); // GARAGE_WIDTH_MAX
  });

  it("door head aligns to the window head on a tall ground floor, with transom", () => {
    // sh=3.4, ratio 0.55 → windowH=1.87, head=2.77; stoop raises door to y=0.3
    // → door h = 2.77-0.3 = 2.47 ≥ 2.4 → transom 0.37
    const layout = invariants(
      p({ storeyHeight: 3.4, storeyHeights: [3.4, 3.4, 3.4] }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    const win = layout.openings.find((o) => o.kind === "window" && o.storey === 0)!;
    expect(door.y + door.h).toBeCloseTo(win.y + win.h, 9);
    expect(door.h).toBeCloseTo(2.47, 9);
    expect(door.transomH).toBeCloseTo(2.47 - 2.1, 9); // DOOR_LEAF_HEIGHT
  });

  it("no transom below threshold; door never shrinks below the base rule", () => {
    // sh=2.8, ratio 0.45 → windowH=1.26, head=2.16 < base 2.3 → h stays 2.3, no transom
    const layout = invariants(
      p({
        storeyHeight: 2.8,
        storeyHeights: [2.8, 2.8, 2.8],
        windowHeightRatio: 0.45,
        groundFloor: { treatment: "residential", doorBay: 0, stoop: false },
      }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    expect(door.h).toBeCloseTo(2.3, 9); // DOOR_HEIGHT_MAX — unchanged
    expect(door.transomH).toBeUndefined();
  });

  it("shopfront-row door aligns to the glazing head", () => {
    // sh=3.4 → shopfront head = 3.4-0.5 = 2.9 → door h=2.9, transom 0.8
    const layout = invariants(
      p({
        width: 9,
        bays: 3,
        storeyHeight: 3.4,
        storeyHeights: [3.4, 3.4, 3.4],
        groundFloor: { treatment: "shopfront", doorBay: 1, stoop: false },
      }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    const shop = layout.openings.find((o) => o.kind === "shopfront")!;
    expect(door.y + door.h).toBeCloseTo(shop.y + shop.h, 9);
    expect(door.transomH).toBeCloseTo(2.9 - 2.1, 9);
  });

  it("squat storey: door keeps the current rule, no transom", () => {
    // sh=2.2 → window head 1.9 == base min(2.3, 1.9) → h=1.9 (same as v1), no transom
    const layout = invariants(
      p({
        storeyHeight: 2.2,
        storeyHeights: [2.2, 2.2, 2.2],
        groundFloor: { treatment: "residential", doorBay: 0, stoop: false },
      }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    expect(door.h).toBeCloseTo(1.9, 9);
    expect(door.transomH).toBeUndefined();
  });

  it("row with no windows or shopfronts: door keeps the base rule", () => {
    // Ground row overridden to [door, blank, blank] → no alignment target
    const layout = invariants(
      p({
        storeyHeight: 3.4,
        storeyHeights: [3.4, 3.4, 3.4],
        groundFloor: { treatment: "residential", doorBay: 0, stoop: false },
        cellOverrides: [
          { storey: 0, bay: 1, kind: "blank" },
          { storey: 0, bay: 2, kind: "blank" },
        ],
      }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    expect(door.h).toBeCloseTo(2.3, 9);
    expect(door.transomH).toBeUndefined();
  });

  it("stoop + transom: leaf measures from the raised threshold", () => {
    const layout = invariants(
      p({ storeyHeight: 3.4, storeyHeights: [3.4, 3.4, 3.4] }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    expect(door.y).toBeCloseTo(0.3, 9); // STOOP_RISE × STOOP_STEPS
    expect(layout.stoop).not.toBeNull();
    expect(door.transomH).toBeDefined();
    // leaf top (door.y + 2.1) sits below the head by exactly transomH
    expect(door.y + 2.1 + door.transomH!).toBeCloseTo(door.y + door.h, 9);
  });
});
