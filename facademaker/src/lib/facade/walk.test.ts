import { describe, it, expect } from "vitest";
import {
  walkLookAngles,
  walkStep,
  WALK_LOOK_SENSITIVITY,
  WALK_SPEED,
  type WalkKeys,
} from "./walk";

const KEYS: WalkKeys = { forward: false, back: false, left: false, right: false };
const k = (over: Partial<WalkKeys>): WalkKeys => ({ ...KEYS, ...over });

describe("walkStep", () => {
  it("walks forward along the look direction at speed·dt", () => {
    // facing north (-z)
    const out = walkStep([0, 0], [0, -1], k({ forward: true }), 1);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(-WALK_SPEED);
  });

  it("strafes right perpendicular to the look direction", () => {
    // facing north (-z) → right is +x
    const out = walkStep([0, 0], [0, -1], k({ right: true }), 1);
    expect(out[0]).toBeCloseTo(WALK_SPEED);
    expect(out[1]).toBeCloseTo(0);
  });

  it("normalizes diagonal input — never faster than speed", () => {
    const out = walkStep([0, 0], [0, -1], k({ forward: true, right: true }), 1);
    expect(Math.hypot(out[0], out[1])).toBeCloseTo(WALK_SPEED);
  });

  it("opposing keys cancel to no movement", () => {
    const out = walkStep([3, 4], [0, -1], k({ forward: true, back: true }), 1);
    expect(out).toEqual([3, 4]);
  });

  it("a degenerate (vertical-look) forward moves nothing", () => {
    const out = walkStep([3, 4], [0, 0], k({ forward: true }), 1);
    expect(out).toEqual([3, 4]);
  });

  it("normalizes a non-unit forward vector", () => {
    const out = walkStep([0, 0], [10, 0], k({ forward: true }), 1);
    expect(out[0]).toBeCloseTo(WALK_SPEED);
    expect(out[1]).toBeCloseTo(0);
  });

  it("scales with dt and honors a custom speed", () => {
    const out = walkStep([0, 0], [1, 0], k({ forward: true }), 0.5, 4);
    expect(out[0]).toBeCloseTo(2);
  });
});

describe("walkLookAngles", () => {
  it("maps mouse movement to yaw and pitch at pointer-lock sensitivity", () => {
    expect(walkLookAngles(1, 0.5, 10, -20)).toEqual([
      1 - 10 * WALK_LOOK_SENSITIVITY,
      0.5 + 20 * WALK_LOOK_SENSITIVITY,
    ]);
  });

  it("clamps pitch before the camera can flip", () => {
    const [, up] = walkLookAngles(0, 0, 0, -100_000);
    const [, down] = walkLookAngles(0, 0, 0, 100_000);
    expect(up).toBeLessThan(Math.PI / 2);
    expect(down).toBeGreaterThan(-Math.PI / 2);
  });
});
