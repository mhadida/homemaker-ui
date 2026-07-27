import { describe, it, expect } from "vitest";
import {
  resolveRoof,
  roofTriangles,
  ROOF_HEIGHT_MIN,
  ROOF_HEIGHT_MAX,
  ROOF_HEIGHT_DEFAULT,
  roofDormers,
  DORMER_MAX,
} from "./roof";
import { WALL_THICKNESS } from "./layout";
import { DEFAULT_FACADE, type FacadeParams } from "./types";

const p = (o: Partial<FacadeParams>): FacadeParams => ({ ...DEFAULT_FACADE, ...o });
const WALLTOP = 10;
const DEPTH = 8;

describe("resolveRoof", () => {
  it("flat (or absent) → null", () => {
    expect(resolveRoof(DEFAULT_FACADE, WALLTOP, DEPTH)).toBeNull();
    expect(resolveRoof(p({ roofType: "flat" }), WALLTOP, DEPTH)).toBeNull();
  });

  it("gable parallel: ridge spans the full width along x at cross-center z", () => {
    const r = resolveRoof(
      p({ roofType: "gable", roofOrientation: "parallel", width: 8, roofHeight: 3 }),
      WALLTOP,
      DEPTH,
    )!;
    expect(r.type).toBe("gable");
    expect(r.axis).toBe("x");
    expect(r.eaveY).toBe(WALLTOP);
    expect(r.ridgeY).toBe(WALLTOP + 3);
    expect(r.zFront).toBeCloseTo(-WALL_THICKNESS, 9);
    expect(r.zBack).toBe(-DEPTH);
    const zMid = (-WALL_THICKNESS + -DEPTH) / 2;
    expect(r.ridge.a).toEqual([-4, zMid]);
    expect(r.ridge.b).toEqual([4, zMid]);
  });

  it("gable perpendicular: ridge spans the full depth along z at x center", () => {
    const r = resolveRoof(
      p({ roofType: "gable", roofOrientation: "perpendicular", width: 8, roofHeight: 3 }),
      WALLTOP,
      DEPTH,
    )!;
    expect(r.axis).toBe("z");
    expect(r.ridge.a).toEqual([0, -WALL_THICKNESS]);
    expect(r.ridge.b).toEqual([0, -DEPTH]);
  });

  it("hip parallel: ridge inset by half the footprint cross-span (depth)", () => {
    // footprint depth = massingDepth − WALL_THICKNESS; inset = min(depth/2, W/2)
    const r = resolveRoof(
      p({ roofType: "hip", roofOrientation: "parallel", width: 12, roofHeight: 3 }),
      WALLTOP,
      DEPTH,
    )!;
    const depth = DEPTH - WALL_THICKNESS;
    const inset = Math.min(depth / 2, 12 / 2);
    const zMid = (-WALL_THICKNESS + -DEPTH) / 2;
    expect(r.ridge.a[0]).toBeCloseTo(-6 + inset, 9); // -W/2 + inset
    expect(r.ridge.b[0]).toBeCloseTo(6 - inset, 9);
    expect(r.ridge.a[1]).toBeCloseTo(zMid, 9);
  });

  it("hip degenerates to a pyramid when the cross-span exceeds the length", () => {
    // width 4, depth 8 → parallel inset capped at W/2=2 → ridge collapses to x=0
    const r = resolveRoof(
      p({ roofType: "hip", roofOrientation: "parallel", width: 4, roofHeight: 3 }),
      WALLTOP,
      DEPTH,
    )!;
    expect(r.ridge.a[0]).toBeCloseTo(0, 9);
    expect(r.ridge.b[0]).toBeCloseTo(0, 9);
  });

  it("clamps roofHeight to [MIN, MAX], defaults when absent, sanitizes non-finite", () => {
    const h = (rh: number | undefined) =>
      resolveRoof(p({ roofType: "gable", roofHeight: rh }), WALLTOP, DEPTH)!.ridgeY -
      WALLTOP;
    expect(h(0.1)).toBe(ROOF_HEIGHT_MIN);
    expect(h(99)).toBe(ROOF_HEIGHT_MAX);
    expect(h(undefined)).toBe(ROOF_HEIGHT_DEFAULT);
    expect(h(NaN)).toBe(ROOF_HEIGHT_DEFAULT);
    expect(h(Infinity)).toBe(ROOF_HEIGHT_DEFAULT);
    expect(h(-Infinity)).toBe(ROOF_HEIGHT_DEFAULT);
  });
});

describe("roofTriangles", () => {
  const tri = (o: Partial<FacadeParams>) =>
    roofTriangles(resolveRoof(p(o), WALLTOP, DEPTH)!);

  it("emits 6 triangles (18 verts) for gable and hip, both orientations", () => {
    for (const type of ["gable", "hip"] as const) {
      for (const roofOrientation of ["parallel", "perpendicular"] as const) {
        const t = tri({ roofType: type, roofOrientation, width: 10, roofHeight: 3 });
        expect(t).toHaveLength(18);
      }
    }
  });

  it("every vertex sits between eave and ridge height, ridge verts at ridgeY", () => {
    const plan = resolveRoof(p({ roofType: "hip", roofHeight: 3, width: 10 }), WALLTOP, DEPTH)!;
    const t = roofTriangles(plan);
    const ys = t.map((v) => v[1]);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(plan.eaveY - 1e-9);
      expect(y).toBeLessThanOrEqual(plan.ridgeY + 1e-9);
    }
    // some verts reach the ridge, some sit at the eave
    expect(ys.some((y) => Math.abs(y - plan.ridgeY) < 1e-9)).toBe(true);
    expect(ys.some((y) => Math.abs(y - plan.eaveY) < 1e-9)).toBe(true);
  });

  it("all vertices lie within the footprint x/z bounds", () => {
    const plan = resolveRoof(p({ roofType: "gable", width: 10, roofHeight: 3 }), WALLTOP, DEPTH)!;
    for (const v of roofTriangles(plan)) {
      expect(v[0]).toBeGreaterThanOrEqual(plan.x0 - 1e-9);
      expect(v[0]).toBeLessThanOrEqual(plan.x1 + 1e-9);
      expect(v[2]).toBeLessThanOrEqual(plan.zFront + 1e-9);
      expect(v[2]).toBeGreaterThanOrEqual(plan.zBack - 1e-9);
    }
  });
});

describe("roofDormers", () => {
  const plan = (o: Partial<FacadeParams> = {}) =>
    resolveRoof(p({ roofType: "gable", roofOrientation: "parallel", roofHeight: 3, ...o }), WALLTOP, DEPTH);

  it("none for a flat roof (null plan) or zero count", () => {
    expect(roofDormers(null, 3)).toEqual([]);
    expect(roofDormers(plan(), 0)).toEqual([]);
  });

  it("none on a perpendicular roof (front slope is a hip/gable end)", () => {
    const perp = resolveRoof(
      p({ roofType: "gable", roofOrientation: "perpendicular", roofHeight: 3 }),
      WALLTOP,
      DEPTH,
    );
    expect(roofDormers(perp, 3)).toEqual([]);
  });

  it("places `count` dormers spread across the roof width, within it", () => {
    const pl = plan()!;
    const ds = roofDormers(pl, 3);
    expect(ds).toHaveLength(3);
    for (const d of ds) {
      expect(d.x - d.w / 2).toBeGreaterThanOrEqual(pl.x0 - 1e-9);
      expect(d.x + d.w / 2).toBeLessThanOrEqual(pl.x1 + 1e-9);
      expect(d.headY).toBeGreaterThan(d.sillY);
      expect(d.sillY).toBeGreaterThan(pl.eaveY); // above the eave
      expect(d.headY).toBeLessThan(pl.ridgeY); // under the ridge
    }
    // evenly spaced, ascending
    expect(ds[0].x).toBeLessThan(ds[1].x);
    expect(ds[1].x).toBeLessThan(ds[2].x);
  });

  it("clamps count to DORMER_MAX and floors fractional counts", () => {
    expect(roofDormers(plan(), 99)).toHaveLength(DORMER_MAX);
    expect(roofDormers(plan(), 2.9)).toHaveLength(2);
  });

  it("none when the rise is too shallow for a dormer", () => {
    const shallow = resolveRoof(
      p({ roofType: "gable", roofOrientation: "parallel", roofHeight: 0.5 }),
      WALLTOP,
      DEPTH,
    );
    expect(roofDormers(shallow, 3)).toEqual([]);
  });
});

describe("roofDormers watertight anchoring", () => {
  it("back edges lie on the main roof slope (no gap / poke-through)", () => {
    const pl = resolveRoof(
      p({ roofType: "gable", roofOrientation: "parallel", roofHeight: 3, massingDepth: 8 }),
      WALLTOP,
      DEPTH,
    )!;
    const zMid = (pl.zFront + pl.zBack) / 2;
    const m = (pl.ridgeY - pl.eaveY) / (pl.zFront - zMid);
    const slopeY = (z: number) => pl.eaveY + (pl.zFront - z) * m;
    for (const d of roofDormers(pl, 3)) {
      expect(slopeY(d.zEaveBack)).toBeCloseTo(d.headY, 6); // cheeks meet slope
      expect(slopeY(d.zRidgeBack)).toBeCloseTo(d.peakY, 6); // ridge meets slope
      expect(d.peakY).toBeLessThan(pl.ridgeY); // under the main ridge
      expect(d.zRidgeBack).toBeGreaterThan(pl.zBack); // within the roof depth
    }
  });
});
