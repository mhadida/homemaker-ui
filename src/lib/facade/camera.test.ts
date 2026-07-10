import { describe, it, expect } from "vitest";
import {
  FACADE_NORMAL,
  fitOrthoZoom,
  elevationCameraPosition,
} from "./camera";

describe("fitOrthoZoom", () => {
  it("fits by the limiting axis (pixels per world unit)", () => {
    // 800×600 view, 10×20 world, margin 1: height limits → 600/20 = 30
    expect(fitOrthoZoom(800, 600, 10, 20, 1)).toBeCloseTo(30, 9);
    // width limits: 400×600 view, 20×10 world → 400/20 = 20
    expect(fitOrthoZoom(400, 600, 20, 10, 1)).toBeCloseTo(20, 9);
  });

  it("applies the default 1.15 margin", () => {
    expect(fitOrthoZoom(800, 600, 10, 20)).toBeCloseTo(600 / (20 * 1.15), 9);
  });

  it("degenerate inputs return 1 instead of Infinity/NaN", () => {
    expect(fitOrthoZoom(800, 600, 0, 20)).toBe(1);
    expect(fitOrthoZoom(0, 600, 10, 20)).toBe(1);
    expect(fitOrthoZoom(800, 600, -5, 20)).toBe(1);
  });

  it("non-finite and non-positive margins return 1", () => {
    expect(fitOrthoZoom(NaN, 600, 10, 20)).toBe(1);
    expect(fitOrthoZoom(800, 600, Infinity, 20)).toBe(1);
    expect(fitOrthoZoom(800, 600, 10, 20, 0)).toBe(1);
  });
});

describe("elevationCameraPosition", () => {
  it("places the camera along the normal at the given distance", () => {
    expect(
      elevationCameraPosition([0, 5, 0], FACADE_NORMAL, 30),
    ).toEqual([0, 5, 30]);
  });

  it("normalizes non-unit normals", () => {
    // normal (0,0,2) → unit (0,0,1) → same as above
    expect(elevationCameraPosition([1, 2, 3], [0, 0, 2], 10)).toEqual([
      1, 2, 13,
    ]);
  });

  it("works for angled normals (sub-project C's case)", () => {
    // 3-4-5 triangle normal in the xz plane
    const [x, y, z] = elevationCameraPosition([0, 0, 0], [0.6, 0, 0.8], 5);
    expect(x).toBeCloseTo(3, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(4, 9);
  });

  it("zero-length normal falls back without NaN", () => {
    const p = elevationCameraPosition([1, 1, 1], [0, 0, 0], 10);
    expect(p.every(Number.isFinite)).toBe(true);
  });
});
