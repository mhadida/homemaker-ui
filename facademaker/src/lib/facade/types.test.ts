import { describe, it, expect } from "vitest";
import {
  DEFAULT_FACADE,
  FACADE_PRESETS,
  FACADE_LIMITS,
} from "./types";

describe("facade types", () => {
  it("default params are within limits", () => {
    expect(DEFAULT_FACADE.width).toBeGreaterThanOrEqual(FACADE_LIMITS.width.min);
    expect(DEFAULT_FACADE.width).toBeLessThanOrEqual(FACADE_LIMITS.width.max);
    expect(DEFAULT_FACADE.storeys).toBeGreaterThanOrEqual(FACADE_LIMITS.storeys.min);
    expect(DEFAULT_FACADE.storeys).toBeLessThanOrEqual(FACADE_LIMITS.storeys.max);
    expect(DEFAULT_FACADE.bays).toBeGreaterThanOrEqual(FACADE_LIMITS.bays.min);
    expect(DEFAULT_FACADE.bays).toBeLessThanOrEqual(FACADE_LIMITS.bays.max);
    expect(DEFAULT_FACADE.groundFloor.doorBay).toBeLessThan(DEFAULT_FACADE.bays);
    expect(DEFAULT_FACADE.storeyHeights).toHaveLength(DEFAULT_FACADE.storeys);
  });

  it("every preset produces valid params when spread over defaults", () => {
    for (const [id, preset] of Object.entries(FACADE_PRESETS)) {
      const p = { ...DEFAULT_FACADE, ...preset.params };
      expect(p.storeys, id).toBeGreaterThanOrEqual(1);
      expect(p.storeys, id).toBeLessThanOrEqual(6);
      expect(p.bays, id).toBeGreaterThanOrEqual(1);
      expect(p.groundFloor.doorBay, id).toBeLessThan(p.bays);
      expect(p.storeyHeights, id).toBeDefined();
      expect(preset.label, id).toBeTruthy();
    }
  });

  it("default and presets carry a valid windowStyle", () => {
    const valid = ["georgian", "sash", "victorian", "none"];
    expect(DEFAULT_FACADE.windowStyle).toBe("sash");
    for (const [id, preset] of Object.entries(FACADE_PRESETS)) {
      const p = { ...DEFAULT_FACADE, ...preset.params };
      expect(valid, id).toContain(p.windowStyle);
    }
    expect(FACADE_PRESETS.georgian.params.windowStyle).toBe("georgian");
    expect(FACADE_PRESETS["victorian-shopfront"].params.windowStyle).toBe("victorian");
    expect(FACADE_PRESETS.modern.params.windowStyle).toBe("none");
  });
});
