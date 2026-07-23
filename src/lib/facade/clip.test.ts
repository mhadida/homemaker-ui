import { describe, it, expect } from "vitest";
import {
  GROUND_HALF,
  WORLD_RADIUS,
  ORBIT_MAX_DISTANCE,
  perspectiveFar,
  PERSPECTIVE_FAR,
} from "./clip";

describe("perspectiveFar", () => {
  it("clears a fully dollied-out camera's distance to the far ground corner", () => {
    // the regression: far=2000 was LESS than this, so the ground was sliced.
    const worstCase = ORBIT_MAX_DISTANCE + WORLD_RADIUS;
    expect(PERSPECTIVE_FAR).toBeGreaterThan(worstCase);
  });

  it("would have caught the old far=2000 as too small", () => {
    const worstCase = ORBIT_MAX_DISTANCE + WORLD_RADIUS;
    expect(2000).toBeLessThan(worstCase); // proves the old value was a bug
  });

  it("WORLD_RADIUS is the ground plane's corner distance", () => {
    expect(WORLD_RADIUS).toBeCloseTo(GROUND_HALF * Math.SQRT2);
  });

  it("scales with a larger world", () => {
    expect(perspectiveFar(600, 5000)).toBeGreaterThan(perspectiveFar(600, 2828));
  });

  it("scales with a longer dolly limit", () => {
    expect(perspectiveFar(1200)).toBeGreaterThan(perspectiveFar(600));
  });
});
