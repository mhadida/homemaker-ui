import { describe, it, expect } from "vitest";
import { cornerDatumOverrides } from "./cornerDatum";
import { detectCorners } from "./corners";
import { DEFAULT_GEN, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE } from "./types";

const mk = (id: string, a: [number, number], b: [number, number], widths: number[]): FacadeBlock => ({
  id, line: { a, b }, flipped: false, gen: structuredClone(DEFAULT_GEN), seed: 7,
  lots: widths.map((w) => ({ params: { ...DEFAULT_FACADE, width: w }, customized: false })),
});

// 90° corner at (10,0): A along +x, B along +z. A's corner lot = index 1, B's = 0.
const A = mk("A", [0, 0], [10, 0], [5, 5]);
const B = mk("B", [10, 0], [10, 10], [5, 5]);

describe("cornerDatumOverrides", () => {
  it("levels BOTH welded corner lots to ONE datum on a slope (no tear)", () => {
    const corners = detectCorners([A, B], 150);
    const m = cornerDatumOverrides(corners, new Map(), [A, B], { slope: 0.2, azimuth: 0 });
    const da = m.get("A:1");
    const db = m.get("B:0");
    expect(da).toBeDefined();
    expect(db).toBeDefined();
    expect(da).toBe(db); // shared — the corner can't tear
  });

  it("uses the PRIMARY (wider) side's datum", () => {
    // widen A's corner lot (index 1, at the shared node) so A is primary; the
    // weld stays at (10,0). A's corner lot centre sits on z≈0 → datum ≈ 0.
    const Aw = mk("A", [0, 0], [10, 0], [2, 8]);
    const corners = detectCorners([Aw, B], 150);
    const m = cornerDatumOverrides(corners, new Map(), [Aw, B], { slope: 0.2, azimuth: 0 });
    expect(m.get("A:1")).toBeCloseTo(0, 3);
    expect(m.get("B:0")).toBeCloseTo(0, 3);
  });

  it("is a no-op-valued map on flat ground (all datums 0 → byte-identical)", () => {
    const corners = detectCorners([A, B], 150);
    const m = cornerDatumOverrides(corners, new Map(), [A, B], { slope: 0, azimuth: 0 });
    for (const v of m.values()) expect(v).toBe(0);
  });

  it("empty when there are no corners", () => {
    const m = cornerDatumOverrides([], new Map(), [A], { slope: 0.2, azimuth: 0 });
    expect(m.size).toBe(0);
  });
});
