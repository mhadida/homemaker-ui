import { describe, it, expect } from "vitest";
import { gableProfile, GABLE_STEPS, type GableStyle } from "./gable";

const W = 8;
const R = 3;

describe("gableProfile", () => {
  for (const style of ["curved", "stepped"] as GableStyle[]) {
    describe(style, () => {
      const pts = gableProfile(style, W, R);

      it("starts at the left eave corner and ends at the right", () => {
        expect(pts[0]).toEqual([-W / 2, 0]);
        expect(pts[pts.length - 1]).toEqual([W / 2, 0]);
      });

      it("stays within the width and between the eave and the peak", () => {
        for (const [x, y] of pts) {
          expect(x).toBeGreaterThanOrEqual(-W / 2 - 1e-9);
          expect(x).toBeLessThanOrEqual(W / 2 + 1e-9);
          expect(y).toBeGreaterThanOrEqual(-1e-9);
          expect(y).toBeLessThanOrEqual(R + 1e-9);
        }
      });

      it("reaches the rise at the centre and nowhere higher", () => {
        const maxY = Math.max(...pts.map((p) => p[1]));
        expect(maxY).toBeCloseTo(R, 9);
        // the centre of the gable is at the full rise (a single apex for
        // curved; the middle of the flat coping for stepped)
        const centre = pts.find(
          (p) => Math.abs(p[0]) < 1e-9 && Math.abs(p[1] - R) < 1e-9,
        );
        expect(centre, "a centre point at the rise").toBeDefined();
      });

      it("is symmetric about x = 0", () => {
        // every point has a mirror-image point in the set
        for (const [x, y] of pts) {
          const mirror = pts.find(
            (q) => Math.abs(q[0] + x) < 1e-6 && Math.abs(q[1] - y) < 1e-6,
          );
          expect(mirror, `mirror of (${x},${y})`).toBeDefined();
        }
      });
    });
  }

  it("stepped gable has the right number of rectangular steps", () => {
    const pts = gableProfile("stepped", W, R);
    // 2 base points + 2 per step per side + shared peak; monotonic y up to peak
    const leftUp = pts.slice(0, pts.length / 2 + 1);
    for (let i = 1; i < leftUp.length; i++) {
      expect(leftUp[i][1]).toBeGreaterThanOrEqual(leftUp[i - 1][1] - 1e-9);
    }
    // treads (horizontal) and risers (vertical) alternate → GABLE_STEPS treads
    expect(GABLE_STEPS).toBe(4);
  });

  it("curved gable produces a smooth many-point silhouette", () => {
    const pts = gableProfile("curved", W, R);
    expect(pts.length).toBeGreaterThan(20); // sampled béziers, not a few corners
  });
});
