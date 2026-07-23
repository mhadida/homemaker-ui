import { describe, it, expect } from "vitest";
import { turretWindows, TURRET_RADIUS_MIN, TURRET_RADIUS_MAX, clampTurretRadius } from "./turret";

const levels = [0, 3, 6, 9]; // 3 storeys, wallTop 9

describe("turretWindows", () => {
  it("one row per full storey, count scales with the arc", () => {
    const w = turretWindows({ radius: 2.2, baseY: 0, wallTop: 9, storeyLevels: levels, outwardAngle: 0 });
    const perRow = new Set(w.map((x) => x.cy)).size;
    expect(perRow).toBe(3); // three storeys → three rows
    expect(w.length % 3).toBe(0);
    expect(w.length).toBeGreaterThanOrEqual(3);
  });

  it("all windows lie within the outward arc", () => {
    const outward = 0.7;
    const arcSpan = 1.5 * Math.PI;
    const w = turretWindows({ radius: 3, baseY: 0, wallTop: 9, storeyLevels: levels, outwardAngle: outward, arcSpan });
    for (const win of w) {
      const d = Math.abs(win.angle - outward);
      expect(d).toBeLessThanOrEqual(arcSpan / 2 + 1e-9);
    }
  });

  it("all windows sit between baseY and wallTop", () => {
    const w = turretWindows({ radius: 2.2, baseY: 0, wallTop: 9, storeyLevels: levels, outwardAngle: 0 });
    for (const win of w) {
      expect(win.cy - win.height / 2).toBeGreaterThanOrEqual(0);
      expect(win.cy + win.height / 2).toBeLessThanOrEqual(9);
    }
  });

  it("a corbelled shaft (baseY at floor 1) skips the ground storey", () => {
    const full = turretWindows({ radius: 2.2, baseY: 0, wallTop: 9, storeyLevels: levels, outwardAngle: 0 });
    const corbel = turretWindows({ radius: 2.2, baseY: 3, wallTop: 9, storeyLevels: levels, outwardAngle: 0 });
    expect(new Set(corbel.map((x) => x.cy)).size).toBe(2); // two rows, not three
    expect(corbel.length).toBeLessThan(full.length);
    for (const win of corbel) expect(win.cy - win.height / 2).toBeGreaterThanOrEqual(3);
  });

  it("a wider turret gets more windows per row (capped)", () => {
    const rowCount = (r: number) => {
      const w = turretWindows({ radius: r, baseY: 0, wallTop: 3, storeyLevels: [0, 3], outwardAngle: 0 });
      return w.length; // single storey → one row
    };
    expect(rowCount(4)).toBeGreaterThan(rowCount(1.2));
    expect(rowCount(6)).toBeLessThanOrEqual(6); // cap
  });

  it("is empty for a degenerate shaft", () => {
    expect(turretWindows({ radius: 0, baseY: 0, wallTop: 9, storeyLevels: levels, outwardAngle: 0 })).toEqual([]);
    expect(turretWindows({ radius: 2, baseY: 9, wallTop: 9, storeyLevels: levels, outwardAngle: 0 })).toEqual([]);
  });

  it("is deterministic", () => {
    const a = turretWindows({ radius: 2.5, baseY: 0, wallTop: 9, storeyLevels: levels, outwardAngle: 1 });
    const b = turretWindows({ radius: 2.5, baseY: 0, wallTop: 9, storeyLevels: levels, outwardAngle: 1 });
    expect(a).toEqual(b);
  });
});

describe("clampTurretRadius", () => {
  it("clamps to the allowed range", () => {
    expect(clampTurretRadius(0.2)).toBe(TURRET_RADIUS_MIN);
    expect(clampTurretRadius(99)).toBe(TURRET_RADIUS_MAX);
    expect(clampTurretRadius(3)).toBe(3);
  });
});
