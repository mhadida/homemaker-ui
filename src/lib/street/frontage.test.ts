import { describe, it, expect } from "vitest";
import { streetFrontages, PAVEMENT_GAP } from "./frontage";
import type { StreetNetwork, Vec2 } from "./types";
import { effectiveWidth } from "./types";
import { closestPointOnSegment } from "./geometry";

const net = (streets: StreetNetwork["streets"]): StreetNetwork => ({ streets, roundabouts: [] });

describe("streetFrontages", () => {
  it("emits a left and a right frontage per drawn segment, offset by ~half width + gap", () => {
    const s = { id: "s1", type: "street" as const, points: [[0, 0], [20, 0]] as Vec2[] };
    const fr = streetFrontages(net([s]));
    expect(fr).toHaveLength(2);
    const half = effectiveWidth(s) / 2;
    // horizontal street → offsets are at ±(half+gap) in z
    const zs = fr.map((f) => f.a[1]).sort((x, y) => x - y);
    expect(Math.abs(zs[0])).toBeGreaterThan(half);
    expect(zs[0]).toBeCloseTo(-zs[1], 6);
  });

  it("faces each frontage at the centreline (normal points inward)", () => {
    const s = { id: "s1", type: "street" as const, points: [[0, 0], [20, 0]] as Vec2[] };
    for (const f of streetFrontages(net([s]))) {
      // block normal (left of a→b, then flipped): recompute the same way blockFrame does
      const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1];
      const L = Math.hypot(dx, dz);
      let nx = -dz / L, nz = dx / L;
      if (f.facingFlipped) { nx = -nx; nz = -nz; }
      const cx = (f.a[0] + f.b[0]) / 2, cz = (f.a[1] + f.b[1]) / 2;
      // centreline point nearest the frontage centre is (cx, 0) for this street
      const toCentre = [0 - 0, 0 - cz]; // centre is z=0
      expect(nx * toCentre[0] + nz * toCentre[1]).toBeGreaterThan(0);
    }
  });

  it("trims a frontage end back at a junction and drops an over-trimmed short segment", () => {
    // Two crossing streets → X at [10,0]; setback large enough to eat a short arm.
    const streets = [
      { id: "h", type: "street" as const, points: [[0, 0], [20, 0]] as Vec2[] },
      { id: "v", type: "street" as const, points: [[10, -8], [10, 8]] as Vec2[] },
    ];
    const trimmed = streetFrontages(net(streets));
    // every frontage still present is at least FRONTAGE_MIN long
    for (const f of trimmed) {
      expect(Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1])).toBeGreaterThanOrEqual(6 - 1e-6);
    }
  });

  it("empty network → no frontages", () => {
    expect(streetFrontages(net([]))).toEqual([]);
  });
});

describe("streetFrontages — corner buildings via offset-edge crossings", () => {
  const crossRoads = (): StreetNetwork["streets"] => [
    { id: "h", type: "road" as const, points: [[-40, 0], [40, 0]] as Vec2[] },
    { id: "v", type: "road" as const, points: [[0, -40], [0, 40]] as Vec2[] },
  ];
  const key = (p: Vec2) => `${p[0]}:${p[1]}`;

  it("two crossing streets share byte-identical corner points at all 4 quadrants", () => {
    const fr = streetFrontages(net(crossRoads()));
    const endsOf = (id: string) =>
      fr.filter((f) => f.streetId === id).flatMap((f) => [f.a, f.b]);
    const hKeys = new Set(endsOf("h").map(key));
    const vKeys = new Set(endsOf("v").map(key));
    // corners: endpoint that is byte-identical between an h frontage and a v one
    const shared = [...hKeys].filter((k) => vKeys.has(k));
    // exactly the 4 quadrant corners are shared (raw ends at ±40 are not)
    expect(shared.length).toBe(4);
    // and every shared corner really is an endpoint of BOTH an h and a v frontage
    for (const k of shared) {
      expect(fr.some((f) => f.streetId === "h" && [f.a, f.b].some((p) => key(p) === k))).toBe(true);
      expect(fr.some((f) => f.streetId === "v" && [f.a, f.b].some((p) => key(p) === k))).toBe(true);
    }
  });

  it("no kept frontage midpoint lies inside another street's carriageway", () => {
    const streets = crossRoads();
    const fr = streetFrontages(net(streets));
    expect(fr.length).toBeGreaterThan(0);
    for (const f of fr) {
      const mid: Vec2 = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];
      for (const s of streets) {
        if (s.id === f.streetId) continue;
        const half = effectiveWidth(s) / 2 + PAVEMENT_GAP;
        for (let j = 0; j < s.points.length - 1; j++) {
          const d = closestPointOnSegment(mid, s.points[j], s.points[j + 1]).dist;
          expect(d).toBeGreaterThanOrEqual(half - 1e-3);
        }
      }
    }
  });
});

describe("streetFrontages — mid-span junction split", () => {
  it("splits a frontage around a mid-span X crossing (gap on both sides, both parts kept)", () => {
    const streets = [
      { id: "h", type: "street" as const, points: [[0, 0], [30, 0]] as Vec2[] },
      { id: "v", type: "street" as const, points: [[15, -10], [15, 10]] as Vec2[] },
    ];
    const fr = streetFrontages(net(streets));
    const hLeft = fr.filter((f) => f.streetId === "h" && f.side === "left");
    expect(hLeft.length).toBe(2); // split into two parts around the X at x=15
    for (const f of hLeft) {
      const xmin = Math.min(f.a[0], f.b[0]);
      const xmax = Math.max(f.a[0], f.b[0]);
      // no part spans the crossing gap [12,18]
      expect(xmin < 12 - 1e-6 && xmax > 18 + 1e-6).toBe(false);
    }
    // parts carry distinct `part` indices
    expect(new Set(hLeft.map((f) => f.part)).size).toBe(2);
  });
});
