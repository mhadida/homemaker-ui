import { describe, it, expect } from "vitest";
import { canalOffsets, canalWaterY, canalGradeAdvisory, canalHoleOutline, CANAL_WATER_DEPTH, bridgesFor, bridgeArch } from "./canal";
import { STREET_SPECS } from "./types";
import type { Street, Vec2, StreetNetwork } from "./types";
import { groundHeightAt } from "@/lib/facade/terrain";
import { deriveIntersections } from "./intersections";

describe("canal type + offsets", () => {
  it("canal STREET_SPECS: water 14, no cars, gentle radius", () => {
    expect(STREET_SPECS.canal).toEqual({
      width: 14, allowsCars: false, label: "Canal", minRadius: 45,
    });
  });

  it("canalOffsets places water/quay/bank edges at the right half-widths", () => {
    const cl: Vec2[] = [[0, 0], [10, 0]]; // along +x, normal ±z
    const o = canalOffsets(cl, 14);
    expect(Math.abs(o.water.left[0][1])).toBeCloseTo(7, 6);      // 14/2
    expect(Math.abs(o.quayFoot.left[0][1])).toBeCloseTo(7.5, 6); // +0.5
    expect(Math.abs(o.bank.left[0][1])).toBeCloseTo(10.5, 6);    // +3
    expect(Math.sign(o.water.left[0][1])).toBe(-Math.sign(o.water.right[0][1]));
  });
});

describe("canal level water", () => {
  it("sits WATER_DEPTH below grade on flat ground", () => {
    const cl: Vec2[] = [[0, 0], [20, 0]];
    expect(canalWaterY(cl, 14, { slope: 0, azimuth: 0 })).toBeCloseTo(-CANAL_WATER_DEPTH, 6);
  });

  it("is level and below every bank point on a slope (never floods)", () => {
    const cl: Vec2[] = [[0, 0], [40, 0]];
    const g = { slope: 0.1, azimuth: 0 };
    const wY = canalWaterY(cl, 14, g);
    const { bank } = canalOffsets(cl, 14);
    for (const p of [...bank.left, ...bank.right]) {
      expect(groundHeightAt(p[0], p[1], g)).toBeGreaterThanOrEqual(wY - 1e-9);
    }
  });
});

describe("canal bridges", () => {
  it("bridges only a canal↔land junction", () => {
    const net: StreetNetwork = {
      streets: [
        { id: "c", type: "canal", points: [[0, -10], [0, 10]] },
        { id: "s", type: "street", points: [[-10, 0], [10, 0]] },
      ],
      roundabouts: [],
    };
    const b = bridgesFor(net, deriveIntersections(net));
    expect(b).toHaveLength(1);
    expect(b[0].span).toBeCloseTo(15, 6);            // 14 + 2*0.5
    expect(Math.abs(b[0].tangent[0])).toBeLessThan(1e-6); // canal runs along ±z
    expect(b[0].deckWidth).toBeCloseTo(9, 6);        // full width of the crossing street
  });

  it("deck is as wide as the crossing street (widest land street wins)", () => {
    const net: StreetNetwork = {
      streets: [
        { id: "c", type: "canal", points: [[0, -10], [0, 10]] },
        { id: "r", type: "road", points: [[-10, 0], [10, 0]] }, // road width 14
      ],
      roundabouts: [],
    };
    const b = bridgesFor(net, deriveIntersections(net));
    expect(b).toHaveLength(1);
    expect(b[0].deckWidth).toBeCloseTo(14, 6); // road, not the old fixed 3
  });

  it("no bridge at land↔land or canal↔canal", () => {
    const land: StreetNetwork = {
      streets: [
        { id: "a", type: "street", points: [[0, -10], [0, 10]] },
        { id: "b", type: "street", points: [[-10, 0], [10, 0]] },
      ], roundabouts: [],
    };
    expect(bridgesFor(land, deriveIntersections(land))).toHaveLength(0);
    const canals: StreetNetwork = {
      streets: [
        { id: "a", type: "canal", points: [[0, -10], [0, 10]] },
        { id: "b", type: "canal", points: [[-10, 0], [10, 0]] },
      ], roundabouts: [],
    };
    expect(bridgesFor(canals, deriveIntersections(canals))).toHaveLength(0);
  });

  it("bridgeArch: parabolic humpback, apex + parapet, deck width", () => {
    const tris = bridgeArch(15, 1.5, 3, 12);
    expect(tris.length % 3).toBe(0);
    expect(tris.length).toBeGreaterThan(0);
    const ys = tris.map((t) => t[1]);
    expect(Math.max(...ys)).toBeCloseTo(1.5 + 0.5, 6); // apex + parapet height
    const zs = tris.map((t) => t[2]);
    expect(Math.max(...zs)).toBeCloseTo(1.5, 6);        // deckWidth/2
    expect(Math.min(...zs)).toBeCloseTo(-1.5, 6);
  });
});

describe("canalGradeAdvisory", () => {
  const canal = (points: [number, number][]): Street => ({
    id: "c",
    type: "canal",
    points,
  });

  it("null on flat ground", () => {
    expect(
      canalGradeAdvisory(canal([[0, 0], [50, 0]]), { slope: 0, azimuth: 0 }),
    ).toBeNull();
  });

  it("null for a canal along the contour of a slope", () => {
    // azimuth 0 slopes along +z; a canal running along x stays level
    expect(
      canalGradeAdvisory(canal([[0, 0], [80, 0]]), { slope: 0.1, azimuth: 0 }),
    ).toBeNull();
  });

  it("calls out a canal climbing a slope", () => {
    // running along z on a 10% z-slope over 80 m → ~8 m rise
    const msg = canalGradeAdvisory(canal([[0, 0], [0, 80]]), {
      slope: 0.1,
      azimuth: 0,
    });
    expect(msg).toMatch(/climbs/);
  });

  it("ignores non-canals on any slope", () => {
    expect(
      canalGradeAdvisory(
        { id: "s", type: "street", points: [[0, 0], [0, 80]] },
        { slope: 0.1, azimuth: 0 },
      ),
    ).toBeNull();
  });
});

describe("canalHoleOutline", () => {
  it("closes the bank ribbon into one loop (left out, right back)", () => {
    const out = canalHoleOutline([[0, 0], [40, 0]], 14)!;
    expect(out).not.toBeNull();
    const { bank } = canalOffsets([[0, 0], [40, 0]], 14);
    expect(out.length).toBe(bank.left.length + bank.right.length);
    expect(out[0]).toEqual(bank.left[0]);
    expect(out[out.length - 1]).toEqual(bank.right[0]);
    // straight canal: the loop spans the full bank width (14/2 + 0.5 + 3)
    const zs = out.map((p) => p[1]);
    expect(Math.max(...zs)).toBeCloseTo(10.5);
    expect(Math.min(...zs)).toBeCloseTo(-10.5);
  });

  it("null for a degenerate polyline", () => {
    expect(canalHoleOutline([[0, 0]], 14)).toBeNull();
  });
});
