import { describe, it, expect } from "vitest";
import {
  GROUND_HALF,
  WORLD_RADIUS,
  ORBIT_MAX_DISTANCE,
  perspectiveFar,
  PERSPECTIVE_FAR,
  MAX_BUILDING_HEIGHT,
  MAX_TERRAIN_DEPTH,
  PLAN_CAM_Y,
  PLAN_CAM_NEAR,
  PLAN_CAM_FAR,
  WALK_CATCHER_Y,
} from "./clip";

/** The plan pane's top-down ortho camera looks down −Y from PLAN_CAM_Y, so the
 * highest visible point is its NEAR plane. Real-city import (M2) put buildings
 * far above the old hand-drawn ~20 m facades — one Rotterdam bbox alone has
 * buildings at 106 m, 95 m and 75 m — which the old hardcoded camera (y = 60)
 * and Walk catcher (y = 50) both sat below. */
describe("plan-pane heights vs. real building heights", () => {
  const highestVisible = PLAN_CAM_Y - PLAN_CAM_NEAR;

  it("keeps the tallest supported building below the near plane (roofs not clipped)", () => {
    expect(highestVisible).toBeGreaterThan(MAX_BUILDING_HEIGHT);
  });

  it("would have caught the old plan camera at y = 60 as too low", () => {
    // the regression: 60 − 0.1 was BELOW real buildings, so their roofs were
    // clipped away (showing the double-sided wall interior) and they were
    // unclickable — an ortho ray starts at the near plane.
    expect(60 - PLAN_CAM_NEAR).toBeLessThan(MAX_BUILDING_HEIGHT);
  });

  it("floats the Walk catcher above every building", () => {
    expect(WALK_CATCHER_Y).toBeGreaterThan(MAX_BUILDING_HEIGHT);
  });

  it("would have caught the old Walk catcher at y = 50 as too low", () => {
    // 6 buildings in one Rotterdam bbox poke above 50 m; each became the
    // nearer hit, so a click hid a building instead of picking a walk start.
    expect(50).toBeLessThan(MAX_BUILDING_HEIGHT);
  });

  it("keeps the Walk catcher itself inside the camera (below the near plane)", () => {
    // above the near plane the catcher would be clipped and catch nothing,
    // breaking walk-arming entirely.
    expect(WALK_CATCHER_Y).toBeLessThan(highestVisible);
  });

  it("reaches past the lowest ground with the far plane", () => {
    // far is measured from the camera, so it must span the camera height plus
    // however far real terrain dips below the y = 0 datum.
    expect(PLAN_CAM_FAR).toBeGreaterThanOrEqual(PLAN_CAM_Y + MAX_TERRAIN_DEPTH);
  });

  it("would have caught the old far = 200 as too shallow", () => {
    expect(200).toBeLessThan(PLAN_CAM_Y + MAX_TERRAIN_DEPTH);
  });
});

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
